/** CurseForge 适配器：官方 API，需免费密钥（预留源） */
import { Fetcher, buildUrl } from '../util/http.js';
import { makeItem, SourceAdapter } from './base.js';
import { getSettings } from '../config.js';
import { pickGameplay, stripHtml } from '../util/richtext.js';

const API = 'https://api.curseforge.com/v1';
const GAME_ID = 432; // Minecraft

/** 类型 → CurseForge 分类 id，若站点调整可在设置中覆盖 */
const CLASS_IDS = { map: 17, datapack: 6945, modpack: 4471, resourcepack: 12 };

/** 本工具排序 → CurseForge 排序字段 */
const SORT_MAP = { hot: 1, downloads: 2, latest: 3, updated: 3 };

class CurseForgeAdapter extends SourceAdapter {
  constructor() {
    super({
      id: 'curseforge',
      label: 'CurseForge',
      site: 'https://www.curseforge.com',
      types: ['map', 'datapack', 'modpack', 'resourcepack'],
      notes: '需在设置中填写免费 API Key，未配置时自动跳过',
      requiresKey: true,
    });
    this._key = null;
    this._http = null;
  }

  /** 密钥变化时重建带鉴权的抓取器 */
  #http() {
    const key = getSettings().curseforgeApiKey;
    if (!this._http || this._key !== key) {
      this._key = key;
      this._http = new Fetcher({
        scope: 'curseforge',
        minInterval: 1500,
        cacheTtl: 300000,
        headers: { 'x-api-key': key },
      });
    }
    return this._http;
  }

  async checkReady() {
    const key = getSettings().curseforgeApiKey;
    if (!key) return { ready: false, reason: '未配置 API Key（设置中填写后启用）' };
    return { ready: true };
  }

  /** 接口对象 → 标准条目 */
  toItem(data, type) {
    const screenshots = (data.screenshots || []).map((s) => s.url).filter(Boolean);
    return makeItem({
      source: this.id,
      sourceId: String(data.id),
      type,
      title: data.name,
      summary: data.summary,
      cover: screenshots[0] || data.logo?.thumbnailUrl || '',
      gallery: screenshots.slice(0, 8),
      url: data.links?.websiteUrl || `${this.site}/minecraft/${type === 'map' ? 'worlds' : 'mc-mods'}`,
      author: (data.authors || [])[0]?.name || '',
      categories: (data.categories || []).map((c) => c.name),
      versions: (data.latestFiles || []).flatMap((f) => f.gameVersions || []).slice(0, 12),
      stats: { downloads: data.downloadCount },
      publishedAt: data.dateCreated,
      updatedAt: data.dateModified,
      extra: { classId: data.classId, slug: data.slug },
    });
  }

  async search({ type = 'map', query = '', sort = 'hot', page = 1, limit = 20 } = {}) {
    const classId = CLASS_IDS[type];
    if (!classId) return { items: [], total: 0, hasMore: false, note: `不支持类型：${type}` };
    const index = Math.max(0, (Math.max(1, page) - 1) * limit);
    const url = buildUrl(`${API}/mods/search`, {
      gameId: GAME_ID,
      classId,
      searchFilter: query,
      sortField: SORT_MAP[sort] || 1,
      sortOrder: 'desc',
      index,
      pageSize: Math.min(Math.max(1, limit), 50),
    });
    const data = await this.#http().json(url, { ttl: 300000 });
    const items = (data.data || []).map((row) => this.toItem(row, type));
    const total = Number(data.pagination?.totalCount) || items.length;
    return {
      items,
      total,
      hasMore: index + items.length < total,
      note: items.length ? '' : '未返回数据，分类编号可能已调整',
    };
  }

  async details(id, preferredType = 'map') {
    const http = this.#http();
    const data = await http.json(`${API}/mods/${encodeURIComponent(id)}`, { ttl: 600000 });
    const row = data.data || {};
    const item = this.toItem(row, preferredType);
    try {
      const desc = await http.json(`${API}/mods/${encodeURIComponent(id)}/description`, { ttl: 600000 });
      const text = stripHtml(desc.data || '');
      item.gameplay = pickGameplay(text);
      if (!item.summary) item.summary = text.slice(0, 200);
    } catch {
      // 描述拉取失败不影响主体数据
    }
    return item;
  }
}

export const curseForgeAdapter = new CurseForgeAdapter();