/** DOM 构造与格式化工具 */

/** 创建元素：标签、属性、子节点 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** 数字缩写：1.2万 / 35.6万 */
export function fmtNum(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num === 0) return '0';
  if (num >= 100000000) return `${(num / 100000000).toFixed(1)}亿`;
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
  return String(Math.round(num));
}

/** 日期截断到天 */
export function fmtDate(value) {
  if (!value) return '';
  const d = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN');
}

export const TYPE_LABEL = { map: '地图', datapack: '数据包', modpack: '整合包', resourcepack: '资源包', mod: '模组' };

export const SOURCE_LABEL = {
  modrinth: 'Modrinth',
  planetminecraft: 'Planet Minecraft',
  curseforge: 'CurseForge',
  klpbbs: '苦力怕论坛',
};

/** 轻提示 */
export function toast(message, ms = 2400) {
  const box = document.getElementById('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    box.hidden = true;
  }, ms);
}

/** 防抖 */
export function debounce(fn, ms = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** 安全外链 */
export function externalLink(href, text) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: text || href });
}

/** 打开模态 */
export function openModal(title, content) {
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  body.textContent = '';
  body.append(content);
  document.getElementById('modal-layer').hidden = false;
}

/** 关闭模态 */
export function closeModal() {
  document.getElementById('modal-layer').hidden = true;
}

/** 带标签的表单行 */
export function field(label, control, hint = '') {
  return el('div', {}, [el('label', { text: label }), control, hint ? el('div', { class: 'hint', text: hint }) : null]);
}