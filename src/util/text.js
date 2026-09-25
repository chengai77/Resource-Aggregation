/** 标题规范化、分词与相似度，用于跨源去重 */

/** 去掉括号修饰、版本号与标点，便于比较 */
export function normalizeTitle(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】|《[^》]*》/g, ' ')
    .replace(/\bv?\d+(?:[._]\d+)*(?:[a-z]{0,3})?\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** 归一化主键：压缩全部空白 */
export function canonicalKey(input) {
  return normalizeTitle(input).replace(/\s+/g, '');
}

/** 词集合 */
export function tokenSet(input) {
  const normalized = normalizeTitle(input);
  return new Set(normalized ? normalized.split(' ').filter(Boolean) : []);
}

/** 二元组集合，用于字符级相似度 */
function bigrams(input) {
  const s = String(input || '').replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (!out.size && s) out.add(s);
  return out;
}

/** Dice 系数：字符二元组重合度，0~1 */
export function diceSimilarity(a, b) {
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (!setA.size || !setB.size) return 0;
  if (setA.size === 1 && setB.size === 1) return setA.has([...setB][0]) ? 1 : 0;
  let inter = 0;
  for (const g of setA) if (setB.has(g)) inter++;
  return (2 * inter) / (setA.size + setB.size);
}

/** 词级 Jaccard：0~1 */
export function jaccard(a, b) {
  const setA = a instanceof Set ? a : tokenSet(a);
  const setB = b instanceof Set ? b : tokenSet(b);
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

/** 截断文本，避免超长描述撑爆界面 */
export function clampText(input, max = 600) {
  const s = String(input || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 归一化 URL：去协议、去 www、去尾斜杠、去查询串 */
export function canonicalUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '');
  }
}