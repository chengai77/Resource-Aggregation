/** 前端入口：装配各模块 */
import { api } from './api.js';
import { renderCards, renderPager } from './cards.js';
import { openCollect, openSettings } from './collect.js';
import { initDetail, openDetail } from './detail.js';
import { bindSwitches, renderFilters } from './filters.js';
import { on, resetFilters, state, toQueryParams } from './state.js';
import { closeModal, debounce, toast } from './ui.js';

/** 加载列表 */
async function loadItems() {
  try {
    state.data = await api.items(toQueryParams());
    renderCards();
    renderPager();
  } catch (err) {
    toast(`列表加载失败：${err.message}`);
  }
}

/** 加载筛选项与源状态 */
async function loadMeta() {
  try {
    const [facets, sources] = await Promise.all([api.facets(), api.sources()]);
    state.facets = facets;
    state.sources = sources.sources || [];
    state.storing = sources.storing;
    renderFilters();
  } catch (err) {
    toast(`筛选项加载失败：${err.message}`);
  }
}

function initUI() {
  const search = document.getElementById('search');
  search.addEventListener('input', debounce(() => {
    state.q = search.value.trim();
    state.page = 1;
    loadItems();
  }, 320));

  document.getElementById('sort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.page = 1;
    loadItems();
  });

  document.getElementById('btn-collect').addEventListener('click', openCollect);
  document.getElementById('btn-settings').addEventListener('click', openSettings);

  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    resetFilters();
    search.value = '';
    renderFilters();
    loadItems();
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-layer').addEventListener('click', (event) => {
    if (event.target.id === 'modal-layer') closeModal();
  });

  document.getElementById('btn-dedupe').addEventListener('click', async () => {
    const btn = document.getElementById('btn-dedupe');
    btn.disabled = true;
    try {
      const result = await api.dedupe(0.86);
      toast(`去重完成：${result.groups} 组，标记 ${result.duplicates} 条`);
      await loadMeta();
      await loadItems();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  const exports = [['btn-export-md', 'md'], ['btn-export-csv', 'csv'], ['btn-export-json', 'json']];
  for (const [id, format] of exports) {
    document.getElementById(id).addEventListener('click', () => {
      window.open(api.exportUrl(format, toQueryParams()), '_blank', 'noopener');
    });
  }
}

on('filters-changed', () => {
  renderFilters();
  loadItems();
});
on('page-changed', loadItems);
on('open-detail', openDetail);
on('data-stale', async () => {
  await loadMeta();
  await loadItems();
});
on('sources-stale', loadMeta);

initUI();
initDetail();
bindSwitches();
await loadMeta();
await loadItems();