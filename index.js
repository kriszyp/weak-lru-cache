//import { ExpirationStrategy } from './ExpirationStrategy'
const defaultExpirer = new ExpirationStrategy()

export class WeakCache extends Map  {
	constructor(entries, expirer) {
		super(entries)
		this.expirer = expirer || defaultExpirer
		expirer.register(this)
	}
	getValue(id) {
		let entry = this.get(id)
		if (entry) {
			this.expirer.used(entry)
			let value = entry.value
			return value === undefined ? entry.deref() : value
		}
	}
	setValue(id, value) {
		let entry
		if (value && typeof value == 'object') {
			entry = new WeakRef(value)
			entry.value = value
		}
		else 
			entry = { value }
		this.expirer.add(entry)
		return this.set(id, entry)
	}
	used(entry) {
		this.expirer.used(entry)
	}
}

class ExpirationStrategy {
	constructor() {
		this.entryUseCount = 0
		this.instances = []
	}
	register(map) {
		this.instances.push(new WeakRef(this))
	}
	add(entry) {
		entry.usage = 0x10000
		if (this.entryUseCount++ > 1000)  {
			if (!this.cleanTimer) {
				cleanTimer = setImmediate(clean)
			} else if (uses > 2000) {
				clearImmediate(cleanTimer)
				this.clean()
			}
		}
	}
	use(entry) {
		entry.usage |= 0x10000
		if (entry.value === undefined && entry.deref) {
			entry.value = entry.deref() // make it a strong reference again
		}
	}
	clean() {
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
