//import { ExpirationStrategy } from './ExpirationStrategy'

class WeakLRUCache extends Map  {
	constructor(entries, options) {
		super(entries)
		this.expirer = (options ? options.expirer === false ? new NoLRUStrategy() : options.expirer : null) || defaultExpirer
		this.registry = new FinalizationRegistry(key => {
			let entry = super.get(key)
			if (entry && entry.deref && entry.deref() === undefined)
				super.delete(key)
		})
		this.expirer.onRemove = entry => {
			let target = entry.deref && entry.deref()
			if (target) {
				// remove strong reference, so only a weak reference, wait until it is finalized to remove
				entry.value = undefined
			} else if (entry.key) {
				let currentEntry = super.get(entry.key)
				if (currentEntry === entry)
					super.delete(entry.key)
			}
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

	setValue(key, value) {
		let entry
		if (value && typeof value == 'object') {
			entry = new WeakRef(value)
			entry.value = value
		}
		else if (value === undefined)
			return
		else
			entry = { key, value }
		this.set(key, entry)
	}
	set(key, entry) {
		let oldEntry = this.get(key)
		if (oldEntry)
			this.expirer.delete(oldEntry)
		return this.insert(key, entry)
	}
	insert(key, entry) {
		if (entry) {
			let target = entry.deref && entry.deref()
			if (target)
				this.registry.register(target, key)
			if (entry.value !== undefined)
				this.expirer.add(entry)
		}
		return super.set(key, entry)
	}
	setManually(key, entry){
		super.set(key, entry)
	}
	delete(key) {
		let oldEntry = this.get(key)
		if (oldEntry) {
			this.expirer.delete(oldEntry)
		}
		return super.delete(key)
	}
	used(entry) {
		this.expirer.used(entry)
	}
	clear() {
		this.expirer.clear()
		super.clear()
	}
}

class LRUStrategy {
	constructor() {
		this.cache = []
		this.index = 0
	}
	add(entry, map, key, value) {
		let previous = this.cache[this.index]
		entry.index = this.index
		if (previous && previous.value !== undefined)
			previous.value = undefined
		this.cache[this.index++] = entry
		if (this.index == 0x1000)
			this.index = 0
	}
	delete(entry) {
		entry.position = -1
	}
	used() {

	}
}

class LRFUStrategy {
	constructor() {
		this.clear()
	}
	add(entry) {
		this.used(entry)
	}
	delete(entry) {
		if (entry.position > -1) {
			this.lrfu[entry.position >> 24][entry.position & 0xffff] = null
		}
		entry.position = -1
	}
	used(entry) {
		let originalPosition = entry.position
		let nextLrfu
		let lrfuPosition
		let lrfuIndex
		if (originalPosition > -1) {
			let lrfuIndex = originalPosition >> 24
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
			let lrfuPosition = nextLrfu.position++
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
			nextLrfu = this.lrfu[--lrfuIndex]
		} while (entry && nextLrfu)
		if (entry) {// this one was removed
			entry.position = -1
			if (entry.deref) {
				Object.defineProperty(entry,'value',{ get(){}, set(){throw new Error('no change')}})
				//entry.value === undefined // clear out the self value so the weak reference can be collected (and then removed from the map)
			}
			else
				this.onRemove(entry)
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
	add(entry) {
		this.onRemove(entry)
	}
	used(entry) {
		this.onRemove(entry)
	}
}
class MapSweepExpirationStrategy {
	constructor() {
		this.entryUseCount = 0
		this.instances = []
	}
	register(map) {
		this.instances.push(new WeakRef(map))
	}
	add(entry) {
		entry.usage = 0x10000
		if (this.entryUseCount++ > 2000)  {
			if (!this.cleanTimer) {
				this.cleanTimer = setImmediate(() => this.clean)
			} else if (this.entryUseCount > 3000) {
				this.clean()
			}
		}
	}
	used(entry) {
		entry.usage |= 0x10000 // | entryUseCount
		if (entry.value === undefined && entry.deref) {
			entry.value = entry.deref() // make it a strong reference again
		}
	}
	clean() {
		this.entryUseCount = 0
		clearImmediate(this.cleanTimer)
		this.cleanTimer = null
		let instances = this.instances
		for (let i = 0, l = instances.length; i < l; i++) {
			let map = instances[i].deref()
			if (map) {
				for (let [key, entry] of map) {
					let usage = entry.usage
					if (entry.value === undefined) {
						// strong reference has been removed, check to see if still has weak reference before removing
						 if (!entry.deref || entry.deref() === undefined)
							map.delete(key)
					} else if (usage < 20000) {
						// expire it, (leaving it with only a weak reference, if any)
						entry.value = undefined
					}
					entry.usage = (usage >> 2) + ((usage & 0xffff) >> 1)
				}
			} else
				instances.splice(i--, 1)
		}
	}
}
const defaultExpirer = new LRFUStrategy()
exports.WeakLRUCache = WeakLRUCache