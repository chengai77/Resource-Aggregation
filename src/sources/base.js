/** 资源条目模型与源适配器抽象 */

/** 统一资源类型 */
export const TYPE_LABELS = {
  map: '地图',
  datapack: '数据包',
  modpack: '整合包',
  resourcepack: '资源包',
  mod: '模组',
};

const ARRAY_FIELDS = ['gallery', 'categories', 'tags', 'versions', 'loaders'];
const STAT_FIELDS = ['downloads', 'likes', 'follows', 'views'];

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** 构造标准条目，补齐默认值并做基础清洗 */
export function makeItem(partial = {}) {
  const source = str(partial.source);
  const sourceId = str(partial.sourceId);
  const item = {
    uid: partial.uid || `${source}:${sourceId}`,
    source,
    sourceId,
    type: TYPE_LABELS[partial.type] ? partial.type : 'datapack',
    title: str(partial.title),
    summary: str(partial.summary),
    gameplay: str(partial.gameplay),
    cover: str(partial.cover),
    gallery: [],
    url: str(partial.url),
    author: str(partial.author),
    authorUrl: str(partial.authorUrl),
    categories: [],
    tags: [],
    versions: [],
    loaders: [],
    license: str(partial.license),
    stats: {},
    publishedAt: partial.publishedAt || null,
    updatedAt: partial.updatedAt || null,
    fetchedAt: Date.now(),
    extra: partial.extra && typeof partial.extra === 'object' ? partial.extra : {},
  };
  for (const f of ARRAY_FIELDS) {
    const v = Array.isArray(partial[f]) ? partial[f] : [];
    item[f] = [...new Set(v.map(str).filter(Boolean))].slice(0, 40);
  }
  const stats = partial.stats || {};
  for (const f of STAT_FIELDS) {
    const n = Number(stats[f]);
    if (Number.isFinite(n) && n !== 0) item.stats[f] = Math.round(n);
  }
  return item;
}

/**
 * 源适配器基类：子类只需实现 search/details
 * 采集器统一通过该接口取数据，业务层不感知站点差异
 */
export class SourceAdapter {
  /**
   * @param {object} meta
   * @param {string} meta.id 源标识
   * @param {string} meta.label 展示名
   * @param {string} meta.site 站点主页
   * @param {string[]} meta.types 支持的资源类型
   * @param {string} [meta.notes] 使用说明
   */
  constructor({ id, label, site, types = [], notes = '', requiresBrowser = false, requiresKey = false }) {
    this.id = id;
    this.label = label;
    this.site = site;
    this.types = types;
    this.notes = notes;
    this.requiresBrowser = requiresBrowser;
    this.requiresKey = requiresKey;
  }

  /** 依赖与凭据是否就绪 */
  async checkReady() {
    return { ready: true, reason: '' };
  }

  /**
   * 搜索资源
   * @param {object} params
   * @param {string} [params.query] 关键词
   * @param {string} [params.type] 资源类型
   * @param {string} [params.sort] 排序方式
   * @param {string[]} [params.categories] 分类过滤
   * @param {number} [params.page] 页码，从 1 开始
   * @param {number} [params.limit] 每页数量
   * @returns {Promise<{items: object[], total: number, hasMore: boolean}>}
   */
  async search() {
    throw new Error(`${this.id} 未实现 search`);
  }

  /** 拉取单条详情，返回标准条目 */
  async details() {
    throw new Error(`${this.id} 未实现 details`);
  }

  /** 可选实现：批量增强已抓条目（补正文、标签等） */
  async enrich() {
    return null;
  }

  /** 可选实现：分类清单供前端筛选 */
  async taxonomy() {
    return [];
  }

  /** 供前端展示的元信息 */
  describe(state = {}) {
    return {
      id: this.id,
      label: this.label,
      site: this.site,
      types: this.types,
      notes: this.notes,
      requiresBrowser: this.requiresBrowser,
      requiresKey: this.requiresKey,
      ...state,
    };
  }
}

/** 合并多个源的分类统计 */
export function mergeFacet(target, key, values) {
  if (!target[key]) target[key] = new Map();
  for (const v of values || []) {
    const k = str(v);
    if (k) target[key].set(k, (target[key].get(k) || 0) + 1);
  }
}