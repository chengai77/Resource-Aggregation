/** 富文本清洗：Markdown / HTML 转纯文本，用于概述与玩法简介 */
import { clampText } from './text.js';

/** 去掉 Markdown 语法与图片徽章 */
export function stripMarkdown(input) {
  let s = String(input || '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // 图片
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // 链接保留文字
  s = s.replace(/^\s*#{1,6}\s*/gm, ''); // 标题符号
  s = s.replace(/^\s*[>*\-+]\s+/gm, ''); // 列表/引用
  s = s.replace(/<[^>]+>/g, ' '); // 内嵌 HTML
  s = s.replace(/[*_~`|]+/g, '');
  s = s.replace(/^\s*[-=]{3,}\s*$/gm, ' ');
  return s;
}

/** 去 HTML 标签与脚本样式 */
export function stripHtml(input) {
  let s = String(input || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6])>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  return decodeEntities(s);
}

const ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
  '&raquo;': '»',
  '&laquo;': '«',
};

/** 常见实体解码 */
export function decodeEntities(input) {
  return String(input || '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ');
}

/** 指引型句子，不宜作为玩法简介 */
const GUIDE_PATTERN = /^(read|see|click|check|visit|join|download|install|note|warning|disclaimer|faq|usage|usage|support|credit|thanks|update|changelog|requirement|dependenc|how to (install|use)|both comes with)/i;
const GAMEPLAY_KEYWORDS = /(玩法|机制|特色|介绍|说明|feature|gameplay|mechanic|how to play|content|include|adds|allows|turns|lets you)/i;

/** 拆分正文段落，过滤过短与指引句 */
function usefulChunks(input) {
  return stripMarkdown(input)
    .split(/\n{2,}|\n/)
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter((c) => c.length >= 30 && !GUIDE_PATTERN.test(c));
}

/** 从正文里挑出适合作为玩法简介的段落 */
export function pickGameplay(input, { max = 480 } = {}) {
  const chunks = usefulChunks(input);
  if (!chunks.length) return '';
  const hits = chunks.filter((c) => GAMEPLAY_KEYWORDS.test(c));
  const pool = hits.length ? hits : chunks;
  const picked = [];
  let total = 0;
  for (const c of pool) {
    if (total && total + c.length > max) break;
    picked.push(c);
    total += c.length;
    if (picked.length >= 2) break;
  }
  return clampText(picked.join(' '), max);
}

/** 按段落取正文前若干段 */
export function firstParagraphs(input, { paragraphs = 3, max = 480 } = {}) {
  const chunks = usefulChunks(input);
  return clampText(chunks.slice(0, paragraphs).join(' '), max);
}