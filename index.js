class WeakLRUCache extends Map  {
	constructor(entries, options) {
		super(entries)
		this.expirer = (options ? options.expirer === false ? new NoLRUStrategy() : options.expirer : null) || defaultExpirer
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
			entry.key = key
			entry.value = value
			entry.cache = this
		} else if (value === undefined)
			return
		else
			entry = { key, value, cache: this }
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
*  < is-in-lru 1 bit > < mask/or bits 3 bits > <lru index 2 bits > <generation - bits> < position in cache - 16 bits >
*/
class LRFUStrategy {
	constructor() {
		this.clear()
	}
	delete(entry) {
		if (entry.position < NOT_IN_LRU) {
			this.lrfu[(entry.position >> 24) & 3][entry.position & 0xffff] = null
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
		} else {
			if (originalPosition >= 0)
				expirationPriority = (originalPosition >> 26) & 7
			else
				expirationPriority = 0
		}
		orMask = expirationPriority < 1 ? 0 : expirationPriority < 3 ? 1 : expirationPriority < 7 ? 3 : expirationPriority < 15 ? 7 : expirationPriority < 31 ? 15 : expirationPriority < 63 ? 31 : expirationPriority < 127 ? 63 : 127
		
		let nextLrfu
		let lrfuPosition
		let lrfuIndex
		if (originalPosition < NOT_IN_LRU) {
			let lrfuIndex = (originalPosition >> 24) & 3
			if (lrfuIndex >= 3)
				return // can't get any higher than this, don't do anything
			let lrfu = this.lrfu[lrfuIndex]
			// check to see if it is in the same generation
			if ((originalPosition & 0xff0000) === (lrfu.position & 0xff0000))
				return // still in same generation, don't move
			lrfu[originalPosition & 0xffff] = null // remove it, we are going to move it
			nextLrfu = this.lrfu[++lrfuIndex]
		} else
			nextLrfu = this.lrfu[lrfuIndex = 0]

		do {
			// put it in the next lrfu
			let lrfuPosition = nextLrfu.position = (nextLrfu.position + 1) | orMask
			let previousEntry = nextLrfu[lrfuPosition & 0xffff]
			nextLrfu[lrfuPosition & 0xffff] = entry
			entry.position = lrfuPosition
			if ((lrfuPosition & 0xfff) === 0xfff) {
				// next generation
				lrfuPosition += 0x10001
				if (lrfuPosition & 0x400000)
					lrfuPosition &= 0x7f000000 // reset the generations
				if (lrfuPosition & 0x2000)
					lrfuPosition &= 0x7fff0000 // reset the inner position
				nextLrfu.position = lrfuPosition
			}
			entry = previousEntry
			if (entry) {
				nextLrfu = this.lrfu[--lrfuIndex]
				orMask = 0 // TODO: Preserve from position
			}
		} while (entry && nextLrfu)
		if (entry) {// this one was removed
			entry.position |= NOT_IN_LRU
			entry.cache.onRemove(entry)
		}
	}
	clear() {
		this.lrfu = []
		for (let i = 0; i < 4; i++) {
			this.lrfu[i] = new Array(0x2000)
			this.lrfu[i].position = i << 24
		}
		this.index = 0
	}
}
class NoLRUStrategy {
	used(entry) {
		entry.cache.onRemove(entry)
	}
}

const defaultExpirer = new LRFUStrategy()
exports.WeakLRUCache = WeakLRUCache
exports.LRFUStrategy = LRFUStrategy