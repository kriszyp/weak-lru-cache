import { WeakLRUCache } from '../index.js'
import chai from 'chai'
const assert = chai.assert
let cache = new WeakLRUCache()

suite('WeakLRUCache basic tests', function(){
	test('add entries', function(){
		let entry = cache.getValue(2)
		assert.equal(entry, undefined)
		let obj = {}
		cache.setValue(2, obj)
		assert.equal(cache.getValue(2), obj)
		debugger
		if (cache.expirer.clean)
			cache.expirer.clean()
		assert.equal(cache.getValue(2), obj)
	})
	for (let priority of [0, 1, 2, 5]) {
		test(`frequently used entry with expiration priority ${priority} is promoted, not expired`, function() {
			let cache = new WeakLRUCache({ cacheSize: 4096 })
			let hot = {}
			cache.setValue('hot', hot, priority)
			let keep = []
			for (let i = 0; i < 20000; i++) {
				let value = {}
				keep.push(value) // keep values strongly reachable so only the LRFU state decides expiration
				cache.setValue('k' + i, value, priority)
				// read the raw entry: get() would revive an expired entry from its WeakRef
				assert.equal(Map.prototype.get.call(cache, 'hot').value, hot, `hot entry expired after ${i} inserts`)
				cache.getValue('hot')
			}
		})
	}
})