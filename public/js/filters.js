/** 侧栏筛选渲染 */
import { el, TYPE_LABEL, SOURCE_LABEL } from './ui.js';
import { state, toggleFilter, toggleSwitch } from './state.js';

const FACET_META = [
  { facet: 'type', key: 'types', label: (v) => TYPE_LABEL[v] || v },
  { facet: 'source', key: 'sources', label: (v) => SOURCE_LABEL[v] || v },
  { facet: 'category', key: 'categories', label: (v) => v },
  { facet: 'version', key: 'versions', label: (v) => v },
];

/** 渲染筛选项与统计 */
export function renderFilters() {
  for (const meta of FACET_META) {
    const box = document.querySelector(`.chips[data-facet="${meta.facet}"]`);
    if (!box) continue;
    box.textContent = '';
    const entries = state.facets[meta.key] || [];
    if (!entries.length) {
      box.append(el('span', { class: 'hint', text: '暂无' }));
      continue;
    }
    for (const { value, count } of entries) {
      const on = state.filters[meta.facet].has(value);
      box.append(
        el('button', {
          class: on ? 'chip on' : 'chip',
          title: value,
          onclick: () => toggleFilter(meta.facet, value),
        }, [meta.label(value), el('span', { class: 'n', text: String(count) })]),
      );
    }
  }

  for (const btn of document.querySelectorAll('[data-toggle]')) {
    btn.classList.toggle('on', Boolean(state.toggles[btn.dataset.toggle]));
  }
  renderStats();
}

function renderStats() {
  const box = document.getElementById('stats');
  box.textContent = '';
  const s = state.storing;
  if (!s) return;
  box.append(el('div', {}, ['库存 ', el('b', { text: String(s.total) })]));
  box.append(el('div', {}, ['已编辑 ', el('b', { text: String(s.edited) })]));
  box.append(el('div', {}, ['重复 ', el('b', { text: String(s.duplicated) })]));
  const bySource = Object.entries(s.bySource || {})
    .map(([k, v]) => `${SOURCE_LABEL[k] || k} ${v}`)
    .join(' · ');
  if (bySource) box.append(el('div', { text: bySource }));
}

/** 绑定状态开关按钮 */
export function bindSwitches() {
  for (const btn of document.querySelectorAll('[data-toggle]')) {
    btn.addEventListener('click', () => toggleSwitch(btn.dataset.toggle));
  }
}