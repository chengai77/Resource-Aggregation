/** 前端状态与事件总线 */
const listeners = new Map();

export const state = {
  q: '',
  sort: 'collected',
  filters: { type: new Set(), source: new Set(), category: new Set(), version: new Set() },
  toggles: { favorite: false, edited: false, dupOnly: false },
  page: 1,
  limit: 24,
  data: { items: [], total: 0, pages: 1 },
  facets: { types: [], sources: [], categories: [], versions: [] },
  sources: [],
  storing: null,
};

/** 订阅事件 */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
}

/** 触发事件 */
export function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[${event}]`, err);
    }
  }
}

/** 组装查询参数 */
export function toQueryParams() {
  const params = {
    q: state.q,
    sort: state.sort,
    page: String(state.page),
    limit: String(state.limit),
    dup: state.toggles.dupOnly ? 'only' : 'hide',
  };
  if (state.filters.type.size) params.type = [...state.filters.type].join(',');
  if (state.filters.source.size) params.source = [...state.filters.source].join(',');
  if (state.filters.category.size) params.category = [...state.filters.category].join(',');
  if (state.filters.version.size) params.version = [...state.filters.version].join(',');
  if (state.toggles.favorite) params.favorite = 'true';
  if (state.toggles.edited) params.edited = 'true';
  return params;
}

/** 切换集合型筛选项 */
export function toggleFilter(facet, value) {
  const set = state.filters[facet];
  if (!set) return;
  if (set.has(value)) set.delete(value);
  else set.add(value);
  state.page = 1;
  emit('filters-changed');
}

/** 切换开关型筛选 */
export function toggleSwitch(key) {
  if (!(key in state.toggles)) return;
  state.toggles[key] = !state.toggles[key];
  state.page = 1;
  emit('filters-changed');
}

/** 清空全部筛选 */
export function resetFilters() {
  for (const set of Object.values(state.filters)) set.clear();
  state.toggles = { favorite: false, edited: false, dupOnly: false };
  state.q = '';
  state.page = 1;
}