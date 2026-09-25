/** 采集编排：抓取 → 入库 → 补全 → 去重 */
import { allAdapters, getAdapter } from './sources/index.js';
import { store } from './store/store.js';
import { runDedupe } from './store/dedupe.js';
import { log } from './util/log.js';

const MAX_PAGES = 10;
const MAX_LIMIT = 100;

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const toArray = (v) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);

/** 用补全结果覆盖条目可空字段 */
function applyPatch(item, patch) {
  if (!patch) return item;
  const merged = { ...item };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) merged[key] = value;
    } else if (typeof value === 'string') {
      if (value.trim()) merged[key] = value;
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/** 归一化请求参数 */
function normalize(raw = {}) {
  const sources = toArray(raw.sources);
  return {
    sources: sources.length ? sources : allAdapters().map((a) => a.id),
    type: String(raw.type || 'datapack'),
    query: String(raw.query || '').trim(),
    sort: String(raw.sort || 'hot'),
    categories: toArray(raw.categories),
    versions: toArray(raw.versions),
    pages: clamp(Number(raw.pages) || 1, 1, MAX_PAGES),
    limit: clamp(Number(raw.limit) || 30, 1, MAX_LIMIT),
    enrich: raw.enrich !== false,
    dedupe: raw.dedupe !== false,
  };
}

/** 单任务串行采集器 */
class Collector {
  constructor() {
    this.running = false;
    this.task = null;
  }

  /** 当前或最近一次任务状态 */
  status() {
    if (!this.task) return { running: false, steps: [], summary: null, error: null, startedAt: 0, finishedAt: 0 };
    return { running: this.running, ...this.task };
  }

  async run(raw = {}) {
    if (this.running) {
      const err = new Error('已有采集任务在运行，请稍候');
      err.code = 409;
      throw err;
    }
    const params = normalize(raw);
    const task = { id: `t${Date.now()}`, params, startedAt: Date.now(), finishedAt: 0, steps: [], summary: null, error: null };
    this.running = true;
    this.task = task;
    log.info('collector', `开始采集：类型=${params.type} 关键词=${params.query || '(空)'} 源=${params.sources.join(',')}`);

    try {
      for (const sourceId of params.sources) {
        const adapter = getAdapter(sourceId);
        const step = { source: sourceId, label: adapter?.label || sourceId, state: 'pending', fetched: 0, inserted: 0, updated: 0, message: '', note: '' };
        task.steps.push(step);
        if (!adapter) {
          step.state = 'error';
          step.message = '未知数据源';
          continue;
        }
        const ready = await adapter.checkReady();
        if (!ready.ready) {
          step.state = 'skipped';
          step.message = ready.reason || '数据源不可用';
          continue;
        }
        if (params.type && adapter.types.length && !adapter.types.includes(params.type)) {
          step.state = 'skipped';
          step.message = `该源不支持「${params.type}」类型`;
          continue;
        }
        step.state = 'running';
        for (let page = 1; page <= params.pages; page++) {
          try {
            const res = await adapter.search({ ...params, page });
            let items = Array.isArray(res.items) ? res.items : [];
            if (res.note) step.note = res.note;
            if (params.enrich && items.length && typeof adapter.enrich === 'function') {
              const patches = await adapter.enrich(items);
              if (patches && patches.size) items = items.map((it) => applyPatch(it, patches.get(it.uid)));
            }
            const counts = store.upsertMany(items);
            step.fetched += items.length;
            step.inserted += counts.inserted;
            step.updated += counts.updated;
            if (!items.length || !res.hasMore) break;
          } catch (err) {
            step.state = 'error';
            step.message = err.message;
            log.error('collector', `${adapter.label} 第 ${page} 页失败：${err.message}`);
            break;
          }
        }
        if (step.state === 'running') step.state = 'done';
      }
      if (params.dedupe && store.items.size > 1) {
        task.summary = { dedupe: runDedupe(store) };
      }
    } catch (err) {
      task.error = err.message;
      log.error('collector', `采集中断：${err.message}`);
    } finally {
      this.running = false;
      task.finishedAt = Date.now();
      store.flushNow();
      const total = task.steps.reduce((sum, s) => sum + s.inserted + s.updated, 0);
      log.info('collector', `采集结束：处理 ${total} 条，库存 ${store.items.size} 条`);
    }
    return this.status();
  }
}

export const collector = new Collector();