/** HTTP 抓取器：限速 + 重试 + 缓存 + robots 遵守 */
import { log } from './log.js';
import { TtlCache } from './cache.js';
import { RobotsGuard } from './robots.js';

export const USER_AGENT =
  'MCResourceHub/0.1 (personal resource aggregator; contact: local user; respects robots.txt)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 拼接查询参数，跳过空值 */
export function buildUrl(base, params = {}) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export class HttpError extends Error {
  constructor(status, url, body = '', headers = null) {
    super(`HTTP ${status} ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = String(body).slice(0, 300);
    this.headers = headers;
  }
}

/** 最小间隔限速器，同步占位保证并发时依次排队 */
export class RateLimiter {
  constructor(minInterval = 1000) {
    this.minInterval = Math.max(0, Number(minInterval) || 0);
    this.nextAt = 0;
  }

  async acquire() {
    const now = Date.now();
    const at = Math.max(now, this.nextAt);
    this.nextAt = at + this.minInterval;
    const wait = at - now;
    if (wait > 0) await sleep(wait);
  }

  /** 站点 robots 要求更慢时上调间隔 */
  raiseTo(minInterval) {
    if (minInterval > this.minInterval) this.minInterval = minInterval;
  }
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * 通用抓取器，每个数据源实例化一个，间隔与缓存按站点隔离
 */
export class Fetcher {
  constructor({
    scope,
    minInterval = 1200,
    timeout = 20000,
    retries = 2,
    cacheTtl = 300000,
    cacheMax = 1500,
    headers = {},
    respectRobots = true,
  } = {}) {
    this.scope = scope || 'http';
    this.timeout = timeout;
    this.retries = Math.max(0, retries);
    this.headers = headers;
    this.limiter = new RateLimiter(minInterval);
    this.cache = new TtlCache({ ttl: cacheTtl, max: cacheMax });
    this.robots = new RobotsGuard({
      rawText: (url) => this.rawText(url),
      uaToken: USER_AGENT.split(' ')[0].toLowerCase(),
      enabled: respectRobots,
    });
  }

  /** 原始请求，不经过 robots 校验 */
  async rawText(url, { timeout = this.timeout } = {}) {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', ...this.headers },
    });
    const body = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, body, res.headers);
    return body;
  }

  /** 带缓存、限速、重试与 robots 检查的请求 */
  async request(url, { ttl, accept = 'text/html,application/json;q=0.9,*/*;q=0.8' } = {}) {
    const cacheKey = `${accept}|${url}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    if (!(await this.robots.isAllowed(url))) {
      throw new HttpError(403, url, 'robots.txt 禁止抓取该路径');
    }
    const delaySec = await this.robots.crawlDelay(url);
    if (delaySec > 0) this.limiter.raiseTo(delaySec * 1000);

    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this.limiter.acquire();
      try {
        const text = await this.rawText(url);
        this.cache.set(cacheKey, text, ttl);
        return text;
      } catch (err) {
        lastErr = err;
        const status = err.status ?? 0;
        const retryable = err.name === 'TimeoutError' || status === 0 || RETRY_STATUS.has(status);
        if (!retryable || attempt === this.retries) break;
        // 429 优先遵从 Retry-After
        const retryAfter = Number(err.headers?.get?.('retry-after')) || 0;
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 700 * 2 ** attempt + Math.random() * 300;
        log.warn(this.scope, `请求失败 ${status || err.name}，${Math.round(backoff)}ms 后重试：${url.slice(0, 90)}`);
        await sleep(backoff);
      }
    }
    throw lastErr;
  }

  async text(url, opts = {}) {
    return this.request(url, { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', ...opts });
  }

  async json(url, opts = {}) {
    const raw = await this.request(url, { accept: 'application/json', ...opts });
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`JSON 解析失败：${url.slice(0, 120)}`);
    }
  }
}