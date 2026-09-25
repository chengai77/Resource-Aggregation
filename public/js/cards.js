/** 卡片列表与分页渲染 */
import { el, fmtDate, fmtNum, SOURCE_LABEL, TYPE_LABEL } from './ui.js';
import { emit, state } from './state.js';

/** 封面元素，无封面时用方块占位 */
function coverOf(item, big = false) {
  if (!item.cover) return el('div', { class: 'ph', text: 'NO COVER' });
  const img = el('img', {
    src: item.cover,
    alt: item.title,
    loading: big ? 'eager' : 'lazy',
    referrerpolicy: 'no-referrer',
  });
  img.addEventListener('error', () => img.replaceWith(el('div', { class: 'ph', text: 'NO COVER' })), { once: true });
  return img;
}

function card(item) {
  const badges = el('div', { class: 'card-badges' }, [
    el('span', { class: 'badge src', text: SOURCE_LABEL[item.source] || item.source }),
    el('span', { class: 'badge', text: TYPE_LABEL[item.type] || item.type }),
    item.favorite ? el('span', { class: 'badge fav', text: '收藏' }) : null,
  ]);

  const meta = el('div', { class: 'card-meta' }, [
    item.stats?.downloads ? el('span', { text: `下载 ${fmtNum(item.stats.downloads)}` }) : null,
    item.versions?.length ? el('span', { class: 'tag2', text: item.versions.slice(-1)[0] }) : null,
    item.publishedAt ? el('span', { text: fmtDate(item.publishedAt) }) : null,
    item.dupGroup ? el('span', { class: 'tag2', text: '重复' }) : null,
  ]);

  return el('article', {
    class: item.dupOf ? 'card is-dup' : 'card',
    title: item.title,
    onclick: () => emit('open-detail', item.uid),
  }, [
    el('div', { class: 'card-cover' }, [coverOf(item), badges]),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'card-title', text: item.title }),
      el('div', { class: 'card-summary', text: item.summary || '暂无概述' }),
      meta,
    ]),
  ]);
}

/** 渲染卡片区 */
export function renderCards() {
  const box = document.getElementById('cards');
  box.textContent = '';
  const items = state.data.items || [];
  if (!items.length) {
    box.append(el('div', { class: 'empty', text: '暂无数据，点击右上角「采集」开始抓取' }));
    return;
  }
  for (const item of items) box.append(card(item));
}

/** 渲染分页 */
export function renderPager() {
  const box = document.getElementById('pager');
  box.textContent = '';
  const { page = 1, pages = 1, total = 0 } = state.data;
  document.getElementById('result-count').textContent = `共 ${total} 条`;
  if (pages <= 1) return;

  const goto = (next) => {
    if (next < 1 || next > pages || next === page) return;
    state.page = next;
    emit('page-changed', next);
  };

  box.append(el('button', { class: 'btn small', text: '上一页', disabled: page <= 1, onclick: () => goto(page - 1) }));
  box.append(el('span', { class: 'page-info', text: `${page} / ${pages}` }));
  box.append(el('button', { class: 'btn small', text: '下一页', disabled: page >= pages, onclick: () => goto(page + 1) }));
}

export { coverOf };