/** robots.txt 解析：仅取 User-agent / Disallow / Allow / Crawl-delay */
import { log } from './log.js';

const MAX_ORIGINS = 64;

/** 解析为分组列表 */
function parseRobots(txt) {
  const groups = [];
  let current = null;
  let expectingAgent = false;
  for (const rawLine of String(txt || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!expectingAgent || !current) {
        current = { agents: [], disallow: [], allow: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      expectingAgent = true;
      continue;
    }
    expectingAgent = false;
    if (!current) continue;
    if (field === 'disallow') current.disallow.push(value);
    else if (field === 'allow') current.allow.push(value);
    else if (field === 'crawl-delay') current.delay = Number(value) || null;
  }
  return groups;
}

/** 前缀匹配，Allow 更长时优先 */
function pathAllowed(rule, pathname) {
  let best = null;
  for (const p of rule.disallow) {
    if (p && pathname.startsWith(p) && (!best || p.length > best.len)) best = { allow: false, len: p.length };
  }
  for (const p of rule.allow) {
    if (p && pathname.startsWith(p) && (!best || p.length > best.len)) best = { allow: true, len: p.length };
  }
  return best ? best.allow : true;
}

/**
 * robots 守卫：缓存各站点规则
 * rawText 为不做 robots 检查的原始抓取函数，避免递归
 */
export class RobotsGuard {
  constructor({ rawText, uaToken = 'mcresourcehub', enabled = true } = {}) {
    this.rawText = rawText;
    this.uaToken = String(uaToken).toLowerCase();
    this.enabled = enabled;
    this.rules = new Map();
  }

  async ruleFor(origin) {
    if (this.rules.has(origin)) return this.rules.get(origin);
    let rule = { allow: [], disallow: [], delay: null, missing: true };
    try {
      const txt = await this.rawText(`${origin}/robots.txt`);
      const groups = parseRobots(txt);
      const exact = groups.find((g) => g.agents.some((a) => a !== '*' && this.uaToken.includes(a)));
      const star = groups.find((g) => g.agents.includes('*'));
      if (exact || star) rule = { ...(exact || star), missing: false };
    } catch (err) {
      log.warn('robots', `${origin} robots.txt 不可用（视为允许）：${err.message}`);
    }
    if (this.rules.size >= MAX_ORIGINS) this.rules.delete(this.rules.keys().next().value);
    this.rules.set(origin, rule);
    return rule;
  }

  /** 是否允许抓取该 URL */
  async isAllowed(url) {
    if (!this.enabled) return true;
    try {
      const u = new URL(url);
      const rule = await this.ruleFor(u.origin);
      return pathAllowed(rule, u.pathname || '/');
    } catch {
      return true;
    }
  }

  /** 站点声明的抓取间隔（秒），无声明返回 0 */
  async crawlDelay(url) {
    if (!this.enabled) return 0;
    try {
      const u = new URL(url);
      const rule = await this.ruleFor(u.origin);
      return rule.delay || 0;
    } catch {
      return 0;
    }
  }
}