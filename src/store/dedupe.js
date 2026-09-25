/** 跨源去重：精确键合并 + 倒排索引近似合并 */
import { canonicalKey, canonicalUrl, diceSimilarity, normalizeTitle, tokenSet } from '../util/text.js';
import { log } from '../util/log.js';

/** 单条候选上限，避免复杂度爆炸 */
const MAX_CANDIDATES = 240;
/** 过常见的词不作为倒排键 */
const COMMON_TOKEN_LIMIT = 400;

/** 并查集，路径压缩 */
class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }

  find(x) {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

/**
 * 执行去重，写回 dupGroup / dupOf 字段
 * @param {import('./store.js').Store} store
 * @param {{threshold?: number}} [opts]
 */
export function runDedupe(store, { threshold = 0.86 } = {}) {
  const items = store.rawAll();
  for (const it of items) {
    it.dupOf = null;
    it.dupGroup = null;
  }
  if (items.length < 2) return { groups: 0, duplicates: 0 };

  const byUid = new Map(items.map((it) => [it.uid, it]));
  const order = new Map(items.map((it, i) => [it.uid, i]));
  const uf = new UnionFind(items.map((it) => it.uid));
  const normMap = new Map();
  const exactMap = new Map();
  const tokenIndex = new Map();

  for (const it of items) {
    const norm = normalizeTitle(it.title);
    const keyPart = canonicalUrl(it.url) || canonicalKey(it.title);
    if (keyPart.length >= 3) {
      const exactKey = `${it.type}|${keyPart}`;
      const bucket = exactMap.get(exactKey);
      if (bucket) bucket.push(it.uid);
      else exactMap.set(exactKey, [it.uid]);
    }
    if (!norm) continue;
    normMap.set(it.uid, norm);
    for (const token of tokenSet(norm)) {
      if (token.length < 3) continue;
      const bucket = tokenIndex.get(token);
      if (bucket) bucket.push(it.uid);
      else tokenIndex.set(token, [it.uid]);
    }
  }

  // 精确键：同类型且链接或标题完全一致
  for (const uids of exactMap.values()) {
    for (let i = 1; i < uids.length; i++) uf.union(uids[0], uids[i]);
  }

  // 近似：共享关键词且相似度达标
  let compared = 0;
  for (const it of items) {
    const norm = normMap.get(it.uid);
    if (!norm || norm.length < 4) continue;
    const candidates = new Set();
    for (const token of tokenSet(norm)) {
      const bucket = tokenIndex.get(token);
      if (!bucket || bucket.length > COMMON_TOKEN_LIMIT) continue;
      for (const uid of bucket) {
        if (uid !== it.uid) candidates.add(uid);
        if (candidates.size >= MAX_CANDIDATES) break;
      }
      if (candidates.size >= MAX_CANDIDATES) break;
    }
    for (const uid of candidates) {
      if ((order.get(uid) ?? 0) <= (order.get(it.uid) ?? 0)) continue; // 每对只比一次
      const other = byUid.get(uid);
      const otherNorm = normMap.get(uid);
      if (!other || !otherNorm || other.type !== it.type) continue;
      if (uf.find(uid) === uf.find(it.uid)) continue;
      const lenRatio = Math.min(norm.length, otherNorm.length) / Math.max(norm.length, otherNorm.length);
      if (lenRatio < 0.55) continue;
      compared++;
      if (diceSimilarity(norm, otherNorm) >= threshold) uf.union(it.uid, uid);
    }
  }

  const groups = new Map();
  for (const it of items) {
    const root = uf.find(it.uid);
    const bucket = groups.get(root);
    if (bucket) bucket.push(it.uid);
    else groups.set(root, [it.uid]);
  }

  let groupCount = 0;
  let duplicates = 0;
  let groupNo = 0;
  for (const uids of groups.values()) {
    if (uids.length < 2) continue;
    groupNo++;
    const members = uids.map((u) => byUid.get(u));
    members.sort(
      (a, b) =>
        (b.edited?.favorite ? 1 : 0) - (a.edited?.favorite ? 1 : 0) ||
        (b.edited ? 1 : 0) - (a.edited ? 1 : 0) ||
        (b.stats?.downloads || 0) - (a.stats?.downloads || 0) ||
        (a.collectedAt || 0) - (b.collectedAt || 0),
    );
    const primary = members[0];
    const gid = `g${groupNo}`;
    for (const member of members) {
      member.dupGroup = gid;
      if (member.uid === primary.uid) {
        member.dupOf = null;
      } else {
        member.dupOf = primary.uid;
        duplicates++;
      }
    }
    groupCount++;
  }

  store.scheduleFlush();
  log.info('dedupe', `去重完成：${groupCount} 组重复，标记 ${duplicates} 条（比较 ${compared} 对）`);
  return { groups: groupCount, duplicates };
}