/** 资源仓库：内存索引 + JSON 原子持久化 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getSettings } from '../config.js';
import { log } from '../util/log.js';

const FILE = path.join(DATA_DIR, 'items.json');
const FLUSH_DELAY = 1500;
/** 允许用户编辑的字段白名单 */
const EDITABLE = ['title', 'summary', 'gameplay', 'tags', 'categories', 'url', 'cover', 'note', 'favorite'];

export class Store {
  constructor() {
    this.items = new Map();
    this.dirty = false;
    this.flushTimer = null;
  }

  /** 载入磁盘数据 */
  load() {
    try {
      if (!fs.existsSync(FILE)) return 0;
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      const list = Array.isArray(raw?.items) ? raw.items : [];
      for (const item of list) {
        if (item?.uid) this.items.set(item.uid, item);
      }
      log.info('store', `载入 ${this.items.size} 条历史数据`);
      return this.items.size;
    } catch (err) {
      log.error('store', `数据载入失败：${err.message}`);
      return 0;
    }
  }

  /** 批量写入，返回新增与更新计数 */
  upsertMany(list) {
    let inserted = 0;
    let updated = 0;
    for (const item of list) {
      if (!item?.uid) continue;
      const exist = this.items.get(item.uid);
      if (exist) {
        // 保留用户编辑与首次采集时间
        this.items.set(item.uid, {
          ...exist,
          ...item,
          edited: exist.edited || null,
          collectedAt: exist.collectedAt || Date.now(),
          dupOf: exist.dupOf || null,
          dupGroup: exist.dupGroup || null,
        });
        updated++;
      } else {
        this.items.set(item.uid, { ...item, edited: null, collectedAt: Date.now(), dupOf: null, dupGroup: null });
        inserted++;
      }
    }
    this.#enforceLimit();
    this.scheduleFlush();
    return { inserted, updated };
  }

  /** 用户编辑：仅接受白名单字段 */
  patch(uid, fields = {}) {
    const item = this.items.get(uid);
    if (!item) return null;
    const edited = { ...(item.edited || {}) };
    for (const key of EDITABLE) {
      if (fields[key] === undefined) continue;
      if (key === 'favorite') edited.favorite = Boolean(fields.favorite);
      else if (key === 'tags' || key === 'categories') {
        edited[key] = Array.isArray(fields[key])
          ? [...new Set(fields[key].map((t) => String(t).trim()).filter(Boolean))].slice(0, 40)
          : [];
      } else edited[key] = String(fields[key]);
    }
    edited.updatedAt = Date.now();
    item.edited = edited;
    this.scheduleFlush();
    return this.toView(item);
  }

  /** 清除用户编辑，回到原始数据 */
  resetEdit(uid) {
    const item = this.items.get(uid);
    if (!item) return null;
    item.edited = null;
    this.scheduleFlush();
    return this.toView(item);
  }

  get(uid) {
    const item = this.items.get(uid);
    return item ? this.toView(item) : null;
  }

  remove(uid) {
    const ok = this.items.delete(uid);
    if (ok) this.scheduleFlush();
    return ok;
  }

  /** 原始条目数组（内部用） */
  rawAll() {
    return [...this.items.values()];
  }

  /** 合并用户编辑后的对外视图 */
  toView(item) {
    const edited = item.edited || {};
    const view = { ...item, ...edited, uid: item.uid, source: item.source, editedAt: edited.updatedAt || null };
    view.editable = [...EDITABLE];
    return view;
  }

  /** 超出上限时淘汰旧条目，保护已编辑与收藏 */
  #enforceLimit() {
    const limit = Number(getSettings().maxItems) || 50000;
    if (this.items.size <= limit) return;
    const victims = this.rawAll()
      .filter((it) => !it.edited?.favorite)
      .sort((a, b) => (a.edited ? 1 : 0) - (b.edited ? 1 : 0) || (a.collectedAt || 0) - (b.collectedAt || 0));
    let drop = this.items.size - limit;
    let removed = 0;
    for (const it of victims) {
      if (drop <= 0) break;
      this.items.delete(it.uid);
      drop--;
      removed++;
    }
    log.warn('store', `超出上限，淘汰 ${removed} 条旧数据`);
  }

  scheduleFlush() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, FLUSH_DELAY);
    this.flushTimer.unref?.();
  }

  /** 原子落盘：写临时文件后重命名 */
  flushNow() {
    if (!this.dirty) return false;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const payload = JSON.stringify({ version: 1, updatedAt: Date.now(), items: this.rawAll() });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, payload, 'utf8');
      fs.renameSync(tmp, FILE);
      this.dirty = false;
      return true;
    } catch (err) {
      log.error('store', `数据落盘失败：${err.message}`);
      return false;
    }
  }

  stats() {
    const bySource = {};
    const byType = {};
    let edited = 0;
    let duplicated = 0;
    for (const it of this.items.values()) {
      bySource[it.source] = (bySource[it.source] || 0) + 1;
      byType[it.type] = (byType[it.type] || 0) + 1;
      if (it.edited) edited++;
      if (it.dupOf) duplicated++;
    }
    return { total: this.items.size, edited, duplicated, bySource, byType };
  }
}

export const store = new Store();