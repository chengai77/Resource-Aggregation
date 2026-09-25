/** REST 接口路由 */
import express from 'express';
import { store } from '../store/store.js';
import { collector } from '../collector.js';
import { adapterStates, getAdapter } from '../sources/index.js';
import { runDedupe } from '../store/dedupe.js';
import { log } from '../util/log.js';
import { maskedSettings, saveSettings } from '../config.js';
import { parseQuery, queryFacets, queryItems } from './query.js';
import { toCsv, toMarkdown } from './export.js';

/** 异步处理包装，异常交给统一错误中间件 */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createRouter() {
  const router = express.Router();
  let facetCache = { at: 0, value: null };

  router.get('/health', (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()), items: store.items.size, collecting: collector.running });
  });

  router.get('/sources', wrap(async (req, res) => {
    const states = await adapterStates();
    res.json({ sources: states, storing: store.stats() });
  }));

  router.get('/facets', (req, res) => {
    if (!facetCache.value || Date.now() - facetCache.at > 5000) {
      facetCache = { at: Date.now(), value: queryFacets() };
    }
    res.json(facetCache.value);
  });

  router.get('/items', (req, res) => {
    res.json(queryItems(parseQuery(req.query)));
  });

  router.get('/items/:uid', (req, res) => {
    const item = store.get(decodeURIComponent(req.params.uid));
    if (!item) return res.status(404).json({ error: '条目不存在' });
    const duplicate = item.dupOf ? store.get(item.dupOf) : null;
    const sameGroup = item.dupGroup
      ? store.rawAll().filter((it) => it.dupGroup === item.dupGroup && it.uid !== item.uid).map((it) => store.toView(it))
      : [];
    return res.json({ item, duplicatePrimary: duplicate, sameGroup });
  });

  router.patch('/items/:uid', (req, res) => {
    const updated = store.patch(decodeURIComponent(req.params.uid), req.body || {});
    if (!updated) return res.status(404).json({ error: '条目不存在' });
    facetCache.value = null;
    return res.json({ item: updated });
  });

  router.post('/items/:uid/reset', (req, res) => {
    const updated = store.resetEdit(decodeURIComponent(req.params.uid));
    if (!updated) return res.status(404).json({ error: '条目不存在' });
    return res.json({ item: updated });
  });

  router.delete('/items/:uid', (req, res) => {
    const ok = store.remove(decodeURIComponent(req.params.uid));
    facetCache.value = null;
    res.json({ ok });
  });

  /** 从源站重新拉取单条详情 */
  router.post('/items/:uid/refresh', wrap(async (req, res) => {
    const uid = decodeURIComponent(req.params.uid);
    const current = store.items.get(uid);
    if (!current) return res.status(404).json({ error: '条目不存在' });
    const adapter = getAdapter(current.source);
    if (!adapter) return res.status(400).json({ error: '该来源不支持刷新' });
    const fresh = await adapter.details(current.sourceId, current.type);
    store.upsertMany([fresh]);
    res.json({ item: store.get(uid) });
  }));

  router.post('/collect', wrap(async (req, res) => {
    if (collector.running) return res.status(409).json({ error: '已有采集任务在运行' });
    facetCache.value = null;
    // 后台执行，前端轮询进度
    collector.run(req.body || {}).catch((err) => log.error('collector', err.message));
    return res.status(202).json({ ok: true, started: true });
  }));

  router.get('/collect/status', (req, res) => {
    res.json(collector.status());
  });

  router.post('/dedupe', (req, res) => {
    const threshold = Number(req.body?.threshold) || 0.86;
    const result = runDedupe(store, { threshold });
    facetCache.value = null;
    store.flushNow();
    res.json(result);
  });

  router.get('/logs', (req, res) => {
    res.json({ logs: log.recent(Number(req.query.limit) || 120) });
  });

  router.get('/settings', (req, res) => {
    res.json(maskedSettings());
  });

  router.post('/settings', (req, res) => {
    const patch = { ...(req.body || {}) };
    if (patch.curseforgeApiKey === '已配置' || patch.curseforgeApiKey === '未配置' || patch.curseforgeApiKey === '') {
      delete patch.curseforgeApiKey; // 空值与展示占位值均表示保留原密钥
    }
    saveSettings(patch);
    res.json(maskedSettings());
  });

  router.get('/export', (req, res) => {
    const params = { ...parseQuery(req.query), dup: 'all', page: 1, limit: 100000 };
    const { items } = queryItems(params);
    const format = String(req.query.format || 'json');
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="mc-resources-${stamp}.csv"`);
      return res.send(toCsv(items));
    }
    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="mc-resources-${stamp}.md"`);
      return res.send(toMarkdown(items));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mc-resources-${stamp}.json"`);
    return res.send(JSON.stringify({ exportedAt: Date.now(), total: items.length, items }, null, 2));
  });

  return router;
}