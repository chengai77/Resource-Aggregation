/** MinecraftMaps 适配器：英文地图站，Cloudflare 保护，需浏览器模式 */
import * as cheerio from 'cheerio';
import { Fetcher, HttpError } from '../util/http.js';
import { browserFetch, isBrowserAvailable, looksLikeChallengePage } from '../util/browser.js';
import { makeItem, SourceAdapter } from './base.js';
import { clampText } from '../util/text.js';
import { pickGameplay, stripHtml } from '../util/richtext.js';
import { getSettings } from '../config.js';
import { log } from '../util/log.js';

const BASE = 'https://www.minecraftmaps.com';

/** 已验证的分类入口 */
const CATEGORIES = [
  { path: '/latest-maps', label: '最新' },
  { path: '/adventure', label: '冒险' },
  { path: '/parkour', label: '跑酷' },
  { path: '/survival', label: '生存' },
  { path: '/puzzle', label: '解谜' },
  { path: '/horror', label: '恐怖' },
  { path: '/mini-game', label: '小游戏' },
  { path: '/creation', label: '建筑' },
  { path: '/popular-maps', label: '热门' },
  { path: '/hall-of-fame', label: '名人堂' },
];

/** 展开后续列表的按钮 */
const MORE_BUTTON = 'button:has-text("Load More Maps")';

/** 从 Next.js 图片代理地址还原真实图片 */
export function decodeImageSrc(src = '') {
  if (!src) return '';
  const raw = /[?&]url=([^&]+)/.exec(src);
  if (!raw) return src.startsWith('http') ? src : `${BASE}${src.startsWith('/') ? '' : '/'}${src}`;
  try {
    return decodeURIComponent(raw[1]);
  } catch {
    return '';
  }
}

const num = (v) => Number(String(v).replace(/[^\d.]/g, '')) || 0;

/** 解析列表页，卡片结构：article.map-card */
export function parseListing(html, category = {}) {
  const $ = cheerio.load(html);
  const items = [];
  $('article.map-card').each((_, node) => {
    const card = $(node);
    const href = card.closest('a').attr('href') || card.parent('a').attr('href') || '';
    const id = (/^\/(\d+)-/.exec(href) || [])[1];
    if (!id) return;

    const title = (card.find('h3').first().text() || card.find('img').first().attr('alt') || '').trim();
    if (!title) return;

    // 徽章位：版次（Bedrock/Java Edition）或游戏版本
    const badge = card.find('h3').first().next('span').text().trim();
    const edition = /edition/i.test(badge) ? badge : '';
    const version = !edition && /^[\d.]/.test(badge) ? badge : '';

    // 作者嵌在 "by" 标签内部
    const byNode = card.find('span').filter((_, el) => $(el).text().trim().startsWith('by ')).first();
    const author = (byNode.find('span').first().text() || card.find('span.font-semibold').first().text()).trim();

    let likes = 0;
    let rating = 0;
    let age = '';
    card.find('span').each((_, el) => {
      const t = $(el).text().trim();
      if (!likes && /▼/.test(t)) likes = num(t);
      else if (!rating && /^★/.test(t)) rating = num(t);
      else if (!age && /^(today|yesterday|\d+\s*[dhm]\s*ago|just now)/i.test(t)) age = t;
    });

    items.push(makeItem({
      source: 'minecraftmaps',
      sourceId: id,
      type: 'map',
      title,
      cover: decodeImageSrc(card.find('img').first().attr('src') || ''),
      url: `${BASE}${href}`,
      author,
      categories: [category.label].filter(Boolean),
      versions: version ? [version] : [],
      tags: [edition].filter(Boolean),
      stats: { likes },
      extra: {
        slug: href.replace(/^\//, ''),
        edition,
        rating: rating || undefined,
        age: age || undefined,
        isNew: card.find('span').filter((_, el) => $(el).text().trim() === 'New').length > 0,
      },
    }));
  });
  return items;
}

class MinecraftMapsAdapter extends SourceAdapter {
  constructor() {
    super({
      id: 'minecraftmaps',
      label: 'MinecraftMaps',
      site: BASE,
      types: ['map'],
      notes: '受 Cloudflare 严格防护，需开启浏览器模式并保持低频；触发拦截后该源暂停十分钟',
      requiresBrowser: true,
    });
    this.http = new Fetcher({ scope: 'minecraftmaps', minInterval: 4000, cacheTtl: 600000, retries: 1 });
    this._blockedUntil = 0;
  }

  async checkReady() {
    if (!getSettings().browserMode) {
      return { ready: true, reason: '直连通常被 Cloudflare 拦截，建议启用浏览器模式' };
    }
    const ok = await isBrowserAvailable();
    return ok ? { ready: true } : { ready: false, reason: '浏览器模式已开启但 playwright 不可用' };
  }

  /**
   * 直连优先，被拦截时切换可见浏览器。
   * 站点可能对 IP 硬封禁（Error 1006），此时冷却十分钟并跳过本轮采集。
   */
  async #html(url, opts = {}) {
    if (Date.now() < this._blockedUntil) throw new Error('站点正在拒绝访问，已暂停采集该源');
    try {
      const html = await this.http.text(url, { ttl: 600000 });
      if (!looksLikeChallengePage(html)) return html;
    } catch (err) {
      const blocked = err instanceof HttpError && [403, 429, 503].includes(err.status);
      if (!blocked && !/挑战页面|challenge/i.test(err.message || '')) throw err;
    }
    if (!getSettings().browserMode) {
      throw new Error('站点返回 Cloudflare 拦截，未启用浏览器模式；请在设置中开启可见浏览器模式后重试');
    }
    if (!(await isBrowserAvailable())) {
      throw new Error('浏览器模式已启用，但 playwright 不可用；请先安装浏览器运行时');
    }
    log.info(this.id, '检测到 Cloudflare 拦截，改用可见浏览器等待人工完成（不绕过验证）');
    try {
      return await browserFetch(url, { timeout: 120000, ...opts });
    } catch (err) {
      if (/拒绝访问|校验未通过/.test(err.message)) this._blockedUntil = Date.now() + 600000;
      throw err;
    }
  }

  async search({ type = 'map', page = 1, limit = 40 } = {}) {
    if (type && type !== 'map') return { items: [], total: 0, hasMore: false };
    const pageNo = Math.max(1, Math.min(5, page));
    const collected = [];
    let fatal = null;
    for (const category of CATEGORIES) {
      if (collected.length >= limit || fatal) break;
      try {
        const html = await this.#html(`${BASE}${category.path}`, {
          clickSelector: MORE_BUTTON,
          clickTimes: pageNo - 1,
        });
        collected.push(...parseListing(html, category));
      } catch (err) {
        log.warn(this.id, `分类 ${category.label} 抓取失败：${err.message}`);
        // 站点级拦截时其余分类必然同样失败，标记后中止
        if (/拒绝访问|未启用浏览器模式|playwright 不可用/.test(err.message)) fatal = err;
      }
    }
    // 一条都没抓到且属于站点级拦截时上报失败，避免前端显示为成功
    if (!collected.length && fatal) throw fatal;
    // 跨分类去重后按点赞排序，避免同一地图重复占位
    const seen = new Set();
    const items = collected
      .filter((it) => (seen.has(it.uid) ? false : seen.add(it.uid)))
      .sort((a, b) => (b.stats.likes || 0) - (a.stats.likes || 0))
      .slice(0, limit);
    return { items, total: items.length, hasMore: collected.length > limit };
  }

  /**
   * 详情：取站点提供的描述元信息与图集
   * 正文容器选择器尚未在真实页面校准，当前以 meta description 为概述
   */
  async details(slug) {
    const path = String(slug).replace(/^\//, '').replace(/^https?:\/\/[^/]+\//, '');
    const id = (/^(\d+)-/.exec(path) || [])[1] || '';
    const url = `${BASE}/${path}`;
    const html = await this.#html(url);
    const $ = cheerio.load(html);

    const metaDesc = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();
    const usable = metaDesc.length >= 40 && !/minecraftmaps\.com is the|largest collection/i.test(metaDesc);
    const summary = usable ? clampText(stripHtml(metaDesc), 300) : '';

    const gallery = [];
    $('img').each((_, img) => {
      const src = decodeImageSrc($(img).attr('src') || $(img).attr('data-src') || '');
      if (!/images\.minecraftmaps\.com/.test(src)) return;
      if (id && !src.includes(`-${id}-`) && !src.includes(`/${id}-`)) return;
      if (!gallery.includes(src)) gallery.push(src);
    });

    return makeItem({
      source: this.id,
      sourceId: id || path,
      type: 'map',
      title: ($('meta[property="og:title"]').attr('content') || $('h1').first().text() || '').trim(),
      summary,
      gameplay: summary ? pickGameplay(summary) : '',
      cover: gallery[0] || '',
      gallery: gallery.slice(0, 8),
      url,
      extra: { slug: path, detailPending: !summary },
    });
  }

  /** 分类清单 */
  async taxonomy() {
    return CATEGORIES.map((c) => c.label);
  }

  /** 批量补全概述：列表页无简介，仅少量补齐以降低触发防护的风险 */
  async enrich(items) {
    const patches = new Map();
    for (const it of items.slice(0, 6)) {
      if (it.source !== this.id) continue;
      try {
        const detail = await this.details(it.sourceId);
        if (!detail.summary) continue;
        patches.set(it.uid, {
          summary: detail.summary,
          gameplay: detail.gameplay,
          gallery: detail.gallery,
        });
      } catch (err) {
        log.warn(this.id, `补全 ${it.sourceId} 失败：${err.message}`);
        // 站点开始拦截时立即停止，避免加重防护
        break;
      }
    }
    return patches;
  }
}

export const minecraftMapsAdapter = new MinecraftMapsAdapter();