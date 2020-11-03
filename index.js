class WeakLRUCache extends Map  {
	constructor(entries, options) {
		super(entries)
		this.expirer = (options ? options.expirer === false ? new NoLRUStrategy() : options.expirer : null) || defaultExpirer
		this.deferRegister = Boolean(options && options.deferRegister)
		if (options && options.cacheSize) {
			this.expirer.lruSize = options.cacheSize >> 2
			this.expirer.clear()
		}
		let registry = this.registry = new FinalizationRegistry(key => {
			let entry = super.get(key)
			if (entry && entry.deref && entry.deref() === undefined)
				super.delete(key)
		})
	}
	onRemove(entry) {
		let target = entry.deref && entry.deref()
		if (target) {
			// remove strong reference, so only a weak reference, wait until it is finalized to remove
			this.registry.register(target, entry.key)
			entry.value = undefined
		} else if (entry.key) {
			let currentEntry = super.get(entry.key)
			if (currentEntry === entry)
				super.delete(entry.key)
		}
	}
	get(key, mode) {
		let entry = super.get(key)
		let value
		if (entry) {
			value = entry.value
			if (value === undefined) {
				value = entry.deref && entry.deref()
				if (value === undefined)
					super.delete(key)
				else {
					entry.value = value
					if (mode !== 1)
						this.expirer.used(entry)
					return mode === 2 ? value : entry
				}
			}
			else {
				if (mode !== 1)
					this.expirer.used(entry)
				return mode === 2 ? value : entry
			}
		}
	}
	getValue(key) {
		return this.get(key, 2)
	}

	setValue(key, value, expirationPriority) {
		let entry
		if (value && typeof value == 'object') {
			entry = new WeakRef(value)
			entry.value = value
			if (this.deferRegister) {
				entry.key = key
				entry.cache = this
			} else
				this.registry.register(value, key)
		} else if (value === undefined)
			return
		else
			entry = { value, key, cache: this }
		this.set(key, entry, expirationPriority)
		return entry
	}
	set(key, entry, expirationPriority) {
		let oldEntry = super.get(key)
		if (oldEntry)
			this.expirer.delete(oldEntry)
		return this.insert(key, entry, expirationPriority)
	}
	insert(key, entry, expirationPriority) {
		if (entry) {
			this.expirer.used(entry, expirationPriority)
		}
		return super.set(key, entry)
	}
	delete(key) {
		let oldEntry = this.get(key)
		if (oldEntry) {
			this.expirer.delete(oldEntry)
		}
		return super.delete(key)
	}
	used(entry, expirationPriority) {
		this.expirer.used(entry, expirationPriority)
	}
	clear() {
		this.expirer.clear()
		super.clear()
	}
}

const PINNED_IN_MEMORY = 0x7fffffff
const NOT_IN_LRU = 0x40000000
/* bit pattern:
*  < is-in-lru 1 bit > ...< mask/or bits 4 bits > <lru index 4 bits > < position in cache - 16 bits >
*/
class LRFUStrategy {
	constructor() {
		this.lruSize = 0x2000
		this.clear()
	}
	delete(entry) {
		if (entry.position < NOT_IN_LRU) {
			this.lru[(entry.position >> 16) & 15][entry.position & 0xffff] = null
		}
		entry.position |= NOT_IN_LRU
	}
	used(entry, expirationPriority) {
		let originalPosition = entry.position
		let orMask
		if (expirationPriority < 0) {
			entry.position = PINNED_IN_MEMORY
			return
		} else if (entry.position == PINNED_IN_MEMORY && expirationPriority == undefined) {
			return
		} else if (expirationPriority >= 0) {
			let bits = 0
			if (expirationPriority > (this.lruSize >> 1))
				expirationPriority = this.lruSize >> 1
			while (expirationPriority > 0) {
				expirationPriority = expirationPriority >> 1
				bits++
			}
			expirationPriority = bits
		} else {
			if (originalPosition >= 0)
				expirationPriority = (originalPosition >> 20) & 15
			else
				expirationPriority = 0
		}
		orMask = 0xffff >> (16 - expirationPriority)
		
		let nextLru
		let lruPosition
		let lruIndex
		if (originalPosition < NOT_IN_LRU) {
			lruIndex = (originalPosition >> 16) & 15
			if (lruIndex >= 3)
				return // can't get any higher than this, don't do anything
			let lru = this.lru[lruIndex]
			// check to see if it is in the same generation
			lruPosition = lru.position
			if ((originalPosition > lruPosition ? lruPosition + this.lruSize : lruPosition) - originalPosition < (this.lruSize >> 3))
				return // only recently added, don't promote
			lru[originalPosition & 0xffff] = null // remove it, we are going to move/promote it
			nextLru = this.lru[++lruIndex]
		} else
			nextLru = this.lru[lruIndex = 0]

		do {
			// put it in the next lru
			lruPosition = nextLru.position | orMask
			let previousEntry = nextLru[lruPosition & 0xffff]
			nextLru[lruPosition & 0xffff] = entry
			entry.position = lruPosition | (expirationPriority << 20)
			nextLru.position = ++lruPosition
			if ((lruPosition & 0xffff) >= this.lruSize) {
				// reset at the beginning of the lru cache
				lruPosition &= 0x7fff0000
				nextLru.position = lruPosition
				nextLru.cycles++
			}
			entry = previousEntry
			if (entry) {
				nextLru = this.lru[--lruIndex]
				expirationPriority = ((entry.position || 0) >> 20) & 15
				orMask = 0xffff >> (16 - expirationPriority)
			}
		} while (entry && nextLru)
		if (entry) {// this one was removed
			entry.position |= NOT_IN_LRU
			if (entry.cache)
				entry.cache.onRemove(entry)
			else if (entry.deref) // if we have already registered the entry in the finalization registry, just clear it
				entry.value = undefined
		}
	}
	clear() {
	/*	if (this.lru) {
			for (let i = 0; i < 4; i++) {
				for (let j = 0, l = this.lru.length; j < l; j++) {
					let entry =	this.lru[i][j]
					if (entry) {// this one was removed
						entry.position |= NOT_IN_LRU
						if (entry.cache)
							entry.cache.onRemove(entry)
						else if (entry.deref) // if we have already registered the entry in the finalization registry, just clear it
							entry.value = undefined
					}
				}
			}
		}*/
		this.lru = []
		for (let i = 0; i < 4; i++) {
			this.lru[i] = new Array(this.lruSize)
			this.lru[i].position = i << 16
			this.lru[i].cycles = 0
		}
	}
}
class NoLRUStrategy {
	used(entry) {
		if (entry.cache)
			entry.cache.onRemove(entry)
		else if (entry.deref) // if we have already registered the entry in the finalization registry, just clear it
			entry.value = undefined
	}
}

const defaultExpirer = new LRFUStrategy()
exports.WeakLRUCache = WeakLRUCache
exports.LRFUStrategy = LRFUStrategy