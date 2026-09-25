/** Planet Minecraft 适配器：地图与数据包主力源 */
import * as cheerio from 'cheerio';
import { Fetcher, HttpError } from '../util/http.js';
import { makeItem, SourceAdapter } from './base.js';
import { browserFetch, isBrowserAvailable, looksLikeChallengePage } from '../util/browser.js';
import { getSettings } from '../config.js';
import { clampText } from '../util/text.js';
import { stripHtml, pickGameplay } from '../util/richtext.js';
import { log } from '../util/log.js';

const BASE = 'https://www.planetminecraft.com';

/** 类型 → 站点路径 */
const PATHS = { map: 'maps', datapack: 'data-packs' };

/** 本工具排序 → 站点参数 */
const SORTS = { hot: 'order_hot', downloads: 'order_downloads', latest: 'order_latest', updated: 'order_updated' };

/** 非内容图片 */
const IMG_SKIP = /avatar|icon|badge|spinner|noimage|logo\./i;

/** PMC 提供的下载排序等参数分页 */
function listUrl(type, sort, page) {
  const path = PATHS[type];
  if (!path) return '';
  const params = new URLSearchParams();
  const order = SORTS[sort];
  if (order) params.set('order', order);
  if (page > 1) params.set('p', String(page));
  const query = params.toString();
  return `${BASE}/${path}/${query ? `?${query}` : ''}`;
}

const shortNum = (text) => {
  const m = String(text).trim().match(/^([\d.]+)\s*([kKmM]?)$/);
  if (!m) return 0;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = m[2].toLowerCase();
  return Math.round(value * (unit === 'm' ? 1e6 : unit === 'k' ? 1e3 : 1));
};

class PlanetMinecraftAdapter extends SourceAdapter {
  constructor() {
    super({
      id: 'planetminecraft',
      label: 'Planet Minecraft',
      site: BASE,
      types: ['map', 'datapack'],
      notes: '地图资源最全；站点带人机验证，需在设置中启用浏览器模式',
    });
    this.http = new Fetcher({ scope: 'planetminecraft', minInterval: 2500, cacheTtl: 300000, retries: 1 });
  }

  async checkReady() {
    if (!getSettings().browserMode) {
      return { ready: true, reason: '直连可能被人机验证拦截，建议启用浏览器模式' };
    }
    const ok = await isBrowserAvailable();
    return ok ? { ready: true } : { ready: false, reason: '浏览器模式已开启但 playwright 不可用' };
  }

  /**
   * 直连优先，被拦截或返回挑战 HTML 时切换到可见浏览器。
   * 不复制 cf_clearance，也不伪造挑战请求；浏览器模式只复用本地人工完成的会话状态。
   */
  async #html(url) {
    try {
      const html = await this.http.text(url, { ttl: 300000 });
      if (!looksLikeChallengePage(html)) return html;
      throw new Error('检测到 Cloudflare 挑战页面（HTTP 200）');
    } catch (err) {
      const blocked = err instanceof HttpError && [403, 429, 503].includes(err.status);
      const challenge = blocked || /挑战页面|challenge/i.test(err.message || '');
      if (!challenge) throw err;
      if (!getSettings().browserMode) {
        throw new Error('站点返回 Cloudflare 人机验证，未启用浏览器模式；请使用公开 API、人工来源跳转，或在设置中开启可见浏览器模式');
      }
      if (!(await isBrowserAvailable())) {
        throw new Error('浏览器模式已启用，但 playwright 不可用；请先安装浏览器运行时');
      }
      log.info(this.id, '检测到 Cloudflare 验证，改用可见浏览器等待人工完成（不绕过验证）');
      return browserFetch(url, { timeout: 120000 });
    }
  }

  /** 从卡片容器提取字段 */
  #parseList(html, type) {
    const $ = cheerio.load(html);
    const prefix = type === 'map' ? '/map/' : '/data-pack/';
    const items = [];
    const seen = new Set();

    $('a[href]').each((_, node) => {
      const rawHref = $(node).attr('href') || '';
      let path = rawHref;
      if (/^https?:/i.test(rawHref)) {
        try {
          path = new URL(rawHref).pathname;
        } catch {
          return;
        }
      }
      if (!path.startsWith(prefix)) return;
      const slug = path.replace(/\/+$/, '').split('/').pop();
      if (!slug || seen.has(slug)) return;
      // 向上寻找同时含图片与文本的卡片容器
      let container = $(node);
      for (let i = 0; i < 6; i++) {
        const parent = container.parent();
        if (!parent.length) break;
        container = parent;
        if (container.find('img').length && container.text().replace(/\s+/g, ' ').length > 60) break;
      }
      const titleLink = container.find(`a[href*="${prefix}"]`).filter((__, a) => ($(a).text() || '').trim().length > 1).first();
      const title = ($(node).text() || '').trim().length > 1
        ? $(node).text().trim()
        : (titleLink.text() || '').trim() || $(node).attr('title') || '';
      if (!title || title.length < 2) return;
      seen.add(slug);

      const images = container
        .find('img')
        .map((__, img) => $(img).attr('src') || $(img).attr('data-src') || '')
        .get()
        .filter((u) => u && !IMG_SKIP.test(u));
      const text = container.text().replace(/\s+/g, ' ');
      const versionMatch = text.match(/Minecraft\s+([\d.]+\s*-\s*[\d.]+|[\d.]+)/i);
      const categoryMatch = text.match(/([A-Z][A-Za-z ]{2,24}?)\s+(?:Data Pack|Map)\b/);
      const author = container.find('a[href*="/member/"]').first().text().trim();
      const numbers = (text.match(/\b\d+(?:\.\d+)?[kKmM]?\b/g) || [])
        .map(shortNum)
        .filter((n) => n > 0);

      items.push(makeItem({
        source: this.id,
        sourceId: slug,
        type,
        title,
        summary: '',
        cover: images[0] || '',
        gallery: images.slice(1, 7),
        url: `${BASE}${prefix}${slug}/`,
        author,
        categories: categoryMatch ? [categoryMatch[1].trim()] : [type === 'map' ? 'Map' : 'Data Pack'],
        versions: versionMatch ? versionMatch[1].split('-').map((v) => v.trim()) : [],
        stats: { downloads: numbers[0] || 0, likes: numbers[1] || 0 },
        extra: { slug, listing: text.slice(0, 300) },
      }));
    });
    return items;
  }

  async search({ type = 'datapack', sort = 'hot', page = 1, limit = 25 } = {}) {
    const url = listUrl(type, sort, Math.max(1, page));
    if (!url) return { items: [], total: 0, hasMore: false, note: `不支持类型：${type}` };
    const html = await this.#html(url);
    const items = this.#parseList(html, type).slice(0, limit);
    const $ = cheerio.load(html);
    const totalText = $('body').text().match(/([\d,]+)\s*(?:results|projects|data packs|maps)/i)?.[1];
    return {
      items,
      total: Number(String(totalText || '').replace(/,/g, '')) || items.length,
      hasMore: items.length >= Math.min(limit, 10),
      note: items.length ? '' : '未解析到条目，页面结构可能变化',
    };
  }

  /** 详情：读取简介与图集 */
  async details(slug, preferredType = 'datapack') {
    const prefix = preferredType === 'map' ? '/map/' : '/data-pack/';
    const html = await this.#html(`${BASE}${prefix}${slug}/`);
    const $ = cheerio.load(html);
    const title = ($('meta[property="og:title"]').attr('content') || $('h1').first().text() || slug).trim();
    const cover = $('meta[property="og:image"]').attr('content') || '';
    const bodyNode = $('#rsc-introduction, .rsc-introduction, #content, .rsc-content').first();
    const text = clampText(stripHtml(bodyNode.html() || ''), 2000);
    const images = (bodyNode.find('img').map((_, img) => $(img).attr('src') || $(img).attr('data-src') || '').get())
      .filter((u) => u && !IMG_SKIP.test(u));
    const pageText = $('body').text().replace(/\s+/g, ' ');
    const versionMatch = pageText.match(/Minecraft\s+([\d.]+\s*-\s*[\d.]+|[\d.]+)/i);
    return makeItem({
      source: this.id,
      sourceId: slug,
      type: preferredType,
      title,
      summary: clampText(text, 220),
      gameplay: pickGameplay(text),
      cover: cover || images[0] || '',
      gallery: [cover, ...images].filter(Boolean).slice(0, 8),
      url: `${BASE}${prefix}${slug}/`,
      author: $('a[href*="/member/"]').first().text().trim(),
      categories: [],
      versions: versionMatch ? versionMatch[1].split('-').map((v) => v.trim()) : [],
      extra: { slug },
    });
  }

  async taxonomy() {
    return ['Map', 'Data Pack'];
  }

  /** 批量补全概述与玩法：列表页信息有限，单批最多 20 条 */
  async enrich(items) {
    const patches = new Map();
    for (const it of items.slice(0, 20)) {
      if (it.source !== this.id) continue;
      try {
        const detail = await this.details(it.sourceId, it.type);
        patches.set(it.uid, {
          summary: detail.summary,
          gameplay: detail.gameplay,
          cover: detail.cover,
          gallery: detail.gallery,
          versions: detail.versions,
        });
      } catch (err) {
        log.warn(this.id, `补全 ${it.sourceId} 失败：${err.message}`);
      }
    }
    return patches;
  }
}

export const planetMinecraftAdapter = new PlanetMinecraftAdapter();