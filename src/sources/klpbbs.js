/** 苦力怕论坛（Discuz）适配器：国内地图与附加包 */
import * as cheerio from 'cheerio';
import { Fetcher } from '../util/http.js';
import { makeItem, SourceAdapter } from './base.js';
import { clampText } from '../util/text.js';
import { stripHtml, pickGameplay } from '../util/richtext.js';
import { log } from '../util/log.js';

const BASE = 'https://klpbbs.com';

/** 可抓板块：fid → 类型 */
const FORUMS = [
  { fid: 139, label: 'JE地图', type: 'map' },
  { fid: 51, label: 'BE地图', type: 'map' },
  { fid: 52, label: 'BE附加包', type: 'datapack' },
];

/** 从标题提取游戏版本，如【1.21.3】 */
function extractVersions(title) {
  const found = String(title).match(/\d+\.\d+(?:\.\d+)?/g) || [];
  return [...new Set(found)].slice(0, 6);
}

/** 提取方括号内的玩法标签 */
function extractTags(title) {
  const tags = [];
  for (const m of String(title).matchAll(/[【\[]([^】\]]{2,20})[】\]]/g)) {
    const value = m[1].trim();
    if (value && !/^\d/.test(value)) tags.push(value);
  }
  return tags.slice(0, 5);
}

const num = (v) => Number(String(v || '').replace(/[^\d]/g, '')) || 0;

class KlpBbsAdapter extends SourceAdapter {
  constructor() {
    super({
      id: 'klpbbs',
      label: '苦力怕论坛',
      site: BASE,
      types: ['map', 'datapack'],
      notes: '国内论坛，直连可抓；搜索需登录，仅支持按板块分页浏览',
    });
    this.http = new Fetcher({ scope: 'klpbbs', minInterval: 2000, cacheTtl: 300000, retries: 2 });
  }

  /** 解析列表页 */
  #parseList(html, forum) {
    const $ = cheerio.load(html);
    const items = [];
    $('tbody[id^="normalthread_"]').each((_, node) => {
      const row = $(node);
      const link = row.find('a.s.xst').first();
      const title = link.text().trim();
      const tid = String(node.attribs?.id || '').replace('normalthread_', '');
      if (!tid || !title) return;
      const author = row.find('.acgifby1 a').first().text().trim();
      const hasImage = row.find('img[alt="attach_img"]').length > 0;
      items.push(makeItem({
        source: this.id,
        sourceId: tid,
        type: forum.type,
        title,
        summary: '',
        cover: '',
        url: `${BASE}/thread-${tid}-1-1.html`,
        author,
        categories: [forum.label],
        tags: extractTags(title),
        versions: extractVersions(title),
        extra: { fid: forum.fid, forum: forum.label, tid, hasImage },
      }));
    });
    return items;
  }

  async search({ type = 'map', page = 1, limit = 30 } = {}) {
    const targets = FORUMS.filter((f) => !type || f.type === type);
    if (!targets.length) return { items: [], total: 0, hasMore: false };
    const pageNo = Math.max(1, page);
    // 按板块均分配额，避免后置板块被整体截断
    const quota = Math.max(1, Math.ceil(limit / targets.length));
    const collected = [];
    for (const forum of targets) {
      try {
        const html = await this.http.text(`${BASE}/forum-${forum.fid}-${pageNo}.html`, { ttl: 300000 });
        collected.push(...this.#parseList(html, forum).slice(0, quota));
      } catch (err) {
        log.warn(this.id, `板块 ${forum.label} 第 ${pageNo} 页失败：${err.message}`);
      }
    }
    const items = collected.slice(0, limit);
    return { items, total: items.length, hasMore: collected.length > 0 };
  }

  /** 帖子详情：正文与首图 */
  async details(tid, preferredType = 'map') {
    const html = await this.http.text(`${BASE}/thread-${tid}-1-1.html`, { ttl: 600000 });
    const $ = cheerio.load(html);
    const title = ($('#thread_subject').text() || $('title').text().split(' - ')[0] || '').trim();
    const post = $('td.t_f').first();
    post.find('i.pstatus').remove(); // 去掉编辑记录
    const body = stripHtml(post.html() || '').replace(/本帖最后由[^\n]{0,40}?编辑/g, ' ');
    const text = clampText(body, 1200);
    const images = [];
    post.find('img').each((_, img) => {
      const raw = $(img).attr('file') || $(img).attr('zoomfile') || $(img).attr('src') || '';
      if (!raw || /static\/image|noavatar|nopic/.test(raw)) return;
      images.push(raw.startsWith('http') ? raw : `${BASE}/${raw.replace(/^\.?\//, '')}`);
    });
    return makeItem({
      source: this.id,
      sourceId: tid,
      type: preferredType,
      title,
      summary: clampText(text, 200),
      gameplay: pickGameplay(text),
      cover: images[0] || '',
      gallery: images.slice(0, 8),
      url: `${BASE}/thread-${tid}-1-1.html`,
      versions: extractVersions(title),
      tags: extractTags(title),
      extra: { tid },
    });
  }

  /** 批量补全概述/玩法/封面：列表页无正文，需逐条进详情 */
  async enrich(items) {
    const patches = new Map();
    for (const it of items) {
      if (it.source !== this.id) continue;
      try {
        const detail = await this.details(it.sourceId, it.type);
        patches.set(it.uid, {
          summary: detail.summary,
          gameplay: detail.gameplay,
          cover: detail.cover,
          gallery: detail.gallery,
        });
      } catch (err) {
        log.warn(this.id, `补全 ${it.sourceId} 失败：${err.message}`);
      }
    }
    return patches;
  }

  /** 板块清单 */
  async taxonomy() {
    return FORUMS.map((f) => f.label);
  }
}

export const klpbbsAdapter = new KlpBbsAdapter();