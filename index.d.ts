interface LRFUExpirerOptions {
  lruSize?: number;
  cleanupInterval?: number;
}

export class LRFUExpirer {
  constructor(options?: LRFUExpirerOptions);
}

interface WeakLRUCacheOptions {
  cacheSize?: number;
  expirer?: LRFUExpirer | false;
  deferRegister?: boolean;
}

export class WeakLRUCache<K, V> extends Map<K, V> {
  constructor(options?: WeakLRUCacheOptions);

  getValue(key: K, expirationPriority?: number): V | undefined;
  setValue(key: K, value: V, expirationPriority?: number): void;
}
