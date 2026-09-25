/** 列表查询：筛选、排序、分页 */
import { store } from '../store/store.js';

const MAX_LIMIT = 120;
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

/** 多值参数：支持逗号分隔或数组 */
function list(v) {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 解析列表查询参数 */
export function parseQuery(raw = {}) {
  return {
    q: String(raw.q || '').trim(),
    words: String(raw.q || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6),
    types: list(raw.type),
    sources: list(raw.source),
    categories: list(raw.category),
    versions: list(raw.version),
    tags: list(raw.tag),
    dup: ['hide', 'only', 'all'].includes(String(raw.dup)) ? String(raw.dup) : 'hide',
    favorite: String(raw.favorite) === 'true',
    edited: String(raw.edited) === 'true',
    sort: String(raw.sort || 'relevance'),
    page: clamp(Number(raw.page) || 1, 1, 10000),
    limit: clamp(Number(raw.limit) || 24, 1, MAX_LIMIT),
  };
}

/** 关键词命中判断，多词需全部命中 */
function matchWords(view, words) {
  if (!words.length) return true;
  const haystack = [
    view.title,
    view.summary,
    view.gameplay,
    view.author,
    view.note,
    ...(view.tags || []),
    ...(view.categories || []),
  ]
    .join(' ')
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

function hasAny(itemValues, filters) {
  if (!filters.length) return true;
  const set = new Set((itemValues || []).map((v) => String(v).toLowerCase()));
  return filters.some((f) => set.has(f.toLowerCase()));
}

/** 排序比较器 */
function comparator(sort) {
  switch (sort) {
    case 'downloads':
      return (a, b) => (b.stats?.downloads || 0) - (a.stats?.downloads || 0);
    case 'follows':
      return (a, b) => (b.stats?.follows || 0) - (a.stats?.follows || 0);
    case 'latest':
      return (a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
    case 'updated':
      return (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    case 'collected':
      return (a, b) => (b.collectedAt || 0) - (a.collectedAt || 0);
    case 'title':
      return (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN');
    default:
      // 相关度：收藏 > 已编辑 > 下载量
      return (a, b) =>
        (b.edited?.favorite ? 1 : 0) - (a.edited?.favorite ? 1 : 0) ||
        (b.edited ? 1 : 0) - (a.edited ? 1 : 0) ||
        (b.stats?.downloads || 0) - (a.stats?.downloads || 0);
  }
}

/** 执行查询，返回分页结果 */
export function queryItems(params) {
  const all = store.rawAll();
  const filtered = [];

  for (const item of all) {
    if (params.types.length && !params.types.includes(item.type)) continue;
    if (params.sources.length && !params.sources.includes(item.source)) continue;
    if (params.favorite && !item.edited?.favorite) continue;
    if (params.edited && !item.edited) continue;
    if (params.dup === 'hide' && item.dupOf) continue;
    if (params.dup === 'only' && !item.dupOf) continue;
    if (params.versions.length && !hasAny(item.versions, params.versions)) continue;
    const view = item.edited ? store.toView(item) : item;
    if (params.categories.length && !hasAny([...(view.categories || []), ...(view.tags || [])], params.categories)) continue;
    if (params.tags.length && !hasAny(view.tags, params.tags)) continue;
    if (!matchWords(view, params.words)) continue;
    filtered.push(view);
  }

  filtered.sort(comparator(params.sort));
  const total = filtered.length;
  const start = (params.page - 1) * params.limit;
  const items = filtered.slice(start, start + params.limit).map((v) => shape(v));
  return {
    total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(total / params.limit)),
    items,
  };
}

/** 精简列表字段，减小响应体积 */
function shape(view) {
  return {
    uid: view.uid,
    source: view.source,
    sourceId: view.sourceId,
    type: view.type,
    title: view.title,
    summary: view.summary,
    cover: view.cover,
    url: view.url,
    author: view.author,
    categories: (view.categories || []).slice(0, 8),
    tags: (view.tags || []).slice(0, 10),
    versions: (view.versions || []).slice(-6),
    stats: view.stats || {},
    publishedAt: view.publishedAt,
    updatedAt: view.updatedAt,
    collectedAt: view.collectedAt,
    favorite: Boolean(view.edited?.favorite),
    edited: Boolean(view.edited),
    dupOf: view.dupOf || null,
    dupGroup: view.dupGroup || null,
    note: view.note || '',
  };
}

/** 汇总筛选项计数 */
export function queryFacets() {
  const types = new Map();
  const sources = new Map();
  const categories = new Map();
  const versions = new Map();
  for (const item of store.rawAll()) {
    if (item.dupOf) continue;
    types.set(item.type, (types.get(item.type) || 0) + 1);
    sources.set(item.source, (sources.get(item.source) || 0) + 1);
    for (const c of item.categories || []) categories.set(c, (categories.get(c) || 0) + 1);
    for (const v of item.versions || []) versions.set(v, (versions.get(v) || 0) + 1);
  }
  const top = (map, limit) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count }));
  return {
    types: top(types, 20),
    sources: top(sources, 20),
    categories: top(categories, 40),
    versions: top(versions, 40),
  };
}