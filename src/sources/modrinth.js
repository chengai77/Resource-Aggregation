/** Modrinth 适配器：官方开放 API，无需密钥 */
import { Fetcher, buildUrl } from '../util/http.js';
import { makeItem, SourceAdapter } from './base.js';
import { pickGameplay } from '../util/richtext.js';
import { log } from '../util/log.js';

const API = 'https://api.modrinth.com/v2';

/** 本工具类型 → Modrinth 项目类型 */
const TYPE_MAP = { datapack: 'datapack', modpack: 'modpack', resourcepack: 'resourcepack', mod: 'mod' };

/** URL 路径段 */
const PATH_SEGMENT = {
  datapack: 'datapack',
  modpack: 'modpack',
  resourcepack: 'resourcepack',
  mod: 'mod',
  plugin: 'plugin',
  shader: 'shader',
};

/** 分类名实为加载器/平台，归入 loaders */
const LOADER_NAMES = new Set([
  'bukkit', 'folia', 'fabric', 'forge', 'neoforge', 'paper', 'purpur', 'quilt', 'spigot',
  'velocity', 'bungeecord', 'waterfall', 'datapack', 'iris', 'optifine', 'canvas', 'rift',
]);

/** 本工具排序 → Modrinth 索引 */
const SORT_MAP = { downloads: 'downloads', follows: 'follows', latest: 'newest', updated: 'updated' };

class ModrinthAdapter extends SourceAdapter {
  constructor() {
    super({
      id: 'modrinth',
      label: 'Modrinth',
      site: 'https://modrinth.com',
      types: ['datapack', 'modpack', 'resourcepack'],
      notes: '官方 API，无需密钥，数据最全最快',
    });
    this.http = new Fetcher({ scope: 'modrinth', minInterval: 1200, cacheTtl: 600000, retries: 3 });
  }

  /** 搜索结果 → 标准条目 */
  toItem(hit, type) {
    const slug = hit.slug || hit.project_id;
    const segment = PATH_SEGMENT[hit.project_type] || 'project';
    const categories = hit.display_categories || hit.categories || [];
    // 多类型项目（如同时是 mod/datapack）按查询类型归类
    const allTypes = Array.isArray(hit.all_project_types) ? hit.all_project_types : [];
    const resolvedType = allTypes.length === 0 || allTypes.includes(type) ? type : TYPE_MAP[hit.project_type] || type;
    return makeItem({
      source: this.id,
      sourceId: slug,
      type: resolvedType,
      title: hit.title,
      summary: hit.description,
      cover: hit.featured_gallery || hit.icon_url || (hit.gallery || [])[0] || '',
      gallery: Array.isArray(hit.gallery) ? hit.gallery.filter((g) => typeof g === 'string') : [],
      url: `${this.site}/${segment}/${slug}`,
      author: hit.author,
      categories: categories.filter((c) => !LOADER_NAMES.has(c)),
      tags: categories,
      loaders: categories.filter((c) => LOADER_NAMES.has(c)),
      versions: hit.versions || [],
      license: hit.license,
      stats: { downloads: hit.downloads, follows: hit.follows },
      publishedAt: hit.date_created,
      updatedAt: hit.date_modified,
      extra: { projectType: hit.project_type, slug },
    });
  }

  /** 构造 facets 过滤条件 */
  #facets({ type, categories = [], versions = [] }) {
    const facets = [];
    const pt = TYPE_MAP[type];
    if (pt) facets.push([`project_type:${pt}`]);
    if (categories.length) facets.push(categories.map((c) => `categories:${c}`));
    if (versions.length) facets.push(versions.map((v) => `versions:${v}`));
    return facets;
  }

  async search({ query = '', type = 'datapack', sort = 'hot', categories = [], versions = [], page = 1, limit = 20 } = {}) {
    if (type === 'map') {
      return { items: [], total: 0, hasMore: false, note: 'Modrinth 无地图类型，请使用 Planet Minecraft 源' };
    }
    const offset = Math.max(0, (Math.max(1, page) - 1) * limit);
    const index = sort === 'hot' ? (query ? 'relevance' : 'follows') : SORT_MAP[sort] || 'relevance';
    const facets = this.#facets({ type, categories, versions });
    const url = buildUrl(`${API}/search`, {
      query,
      index,
      limit: Math.min(Math.max(1, limit), 100),
      offset,
      facets: facets.length ? JSON.stringify(facets) : '',
    });
    const data = await this.http.json(url, { ttl: 300000 });
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const items = hits.map((h) => this.toItem(h, type));
    return { items, total: Number(data.total_hits) || items.length, hasMore: offset + items.length < (data.total_hits || 0) };
  }

  /** 详情 → 标准条目（含正文） */
  async details(slug, preferredType = '') {
    const hit = await this.http.json(`${API}/project/${encodeURIComponent(slug)}`, { ttl: 600000 });
    const segment = PATH_SEGMENT[hit.project_type] || 'project';
    const body = hit.body || '';
    const allTypes = Array.isArray(hit.all_project_types) ? hit.all_project_types : [];
    const resolvedType = preferredType || (allTypes.includes('datapack') ? 'datapack' : TYPE_MAP[hit.project_type] || 'datapack');
    const item = makeItem({
      source: this.id,
      sourceId: hit.slug || hit.id,
      type: resolvedType,
      title: hit.title,
      summary: hit.description,
      gameplay: pickGameplay(body),
      cover: hit.icon_url || (hit.gallery || [])[0]?.url || '',
      gallery: (hit.gallery || []).map((g) => (typeof g === 'string' ? g : g.url)).filter(Boolean),
      url: `${this.site}/${segment}/${hit.slug}`,
      author: '',
      categories: (hit.categories || []).filter((c) => !LOADER_NAMES.has(c)),
      tags: [...(hit.categories || []), ...(hit.additional_categories || [])],
      loaders: hit.loaders || [],
      versions: hit.game_versions || [],
      license: hit.license?.name || hit.license?.id || '',
      stats: { downloads: hit.downloads, follows: hit.followers },
      publishedAt: hit.published,
      updatedAt: hit.updated,
      extra: {
        projectType: hit.project_type,
        slug: hit.slug,
        sourceUrl: hit.source_url || '',
        issuesUrl: hit.issues_url || '',
        wikiUrl: hit.wiki_url || '',
        discordUrl: hit.discord_url || '',
        bodyLength: body.length,
      },
    });
    return item;
  }

  /** 批量补全正文与标签，降低请求数 */
  async enrich(items) {
    const targets = items.filter((it) => it.source === this.id && it.sourceId);
    if (!targets.length) return new Map();
    const out = new Map();
    const chunkSize = 40;
    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      const url = buildUrl(`${API}/projects`, { ids: JSON.stringify(chunk.map((it) => it.sourceId)) });
      try {
        const list = await this.http.json(url, { ttl: 600000 });
        for (const p of list) {
          const key = p.slug || p.id;
          const target = chunk.find((it) => it.sourceId === key || it.sourceId === p.id);
          if (!target) continue;
          const patch = {
            gameplay: pickGameplay(p.body || ''),
            gallery: (p.gallery || []).map((g) => (typeof g === 'string' ? g : g.url)).filter(Boolean),
            loaders: p.loaders || [],
            versions: p.game_versions || [],
            license: p.license?.name || '',
            author: target.author,
          };
          if (p.description) patch.summary = p.description;
          out.set(target.uid, patch);
        }
      } catch (err) {
        log.warn(this.id, `批量补全失败（跳过本次）：${err.message}`);
      }
    }
    return out;
  }

  /** 常见玩法分类清单 */
  async taxonomy() {
    const tags = await this.http.json(`${API}/tag/category`, { ttl: 86400000 });
    const names = tags
      .filter((t) => ['mod', 'modpack'].includes(String(t.project_type)))
      .map((t) => t.name)
      .filter((n) => !LOADER_NAMES.has(n));
    return [...new Set(names)].sort();
  }
}

export const modrinthAdapter = new ModrinthAdapter();