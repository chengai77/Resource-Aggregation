/** 带容量上限的内存 TTL 缓存，自动清理过期项 */
export class TtlCache {
  /**
   * @param {object} [opts]
   * @param {number} [opts.ttl] 默认存活毫秒
   * @param {number} [opts.max] 最大条目数
   */
  constructor({ ttl = 300000, max = 2000 } = {}) {
    this.ttl = ttl;
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expire <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // 命中后前移，形成近似 LRU
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value, ttl = this.ttl) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expire: Date.now() + ttl });
    this.sweep();
  }

  /** 清理过期项并控制容量 */
  sweep() {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.expire <= now) this.map.delete(k);
    }
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}