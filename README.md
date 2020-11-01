# weak-lru-cache

The weak-lru-cache package provides a powerful cache that works in harmony with the JS garbage collection (GC) and least-recently used (LRU) and least-freqently used (LFU) expiration strategy to help cache data with highly optimized cache retention. It uses LRU/LFU (LRFU) expiration to retain referenced data, and then once data has been inactive, it uses weak references (finalization registry) to allow GC to remove the cached data as part of the normal GC cycles, but still continue to provide cached access to the data as long as it still resides in memory and hasn't been collected. This provides the best of modern expiration strategies combined with optimal GC interaction.

## Setup

Install with:

```
npm i weak-lru-cache
```
And `import` or `require` it to access the constructor:
```
const { WeakLRUCache } = require('weak-lru-cache');

let myCache = new WeakLRUCache();
myValue.setValue('key', { greeting: 'hello world' });
myValue.getValue('key') -> return the object above as long as it is still cached
```

## Basic Usage

The `WeakLRUCache` class extends the native `Map` class, and consequently, all the standard Map methods are available. As a Map, all the values are cache entries, which are typically `WeakRef` objects that hold a reference to the cached value, along with retention information.

In addition to the standard Map methods, the following methods are available:

### getValue(key)
Gets the value referenced by the given key. If the value is no longer cached, will return undefined. This differs from `get(key)` in that `get(key)` returns the cache entry, which references the value, rather than the value itself.

### setValue(key, value)
Sets or inserts the value into the cache, with the given key. This will create a new cache entry to reference your provided value.

The key can be any JS value.

If you provide a primitive value, this can not be weakly referenced, so the value will still be stored in the LRFU cache, but once it expires, it will immediately be removed, rather than waiting for GC.


## License

MIT
