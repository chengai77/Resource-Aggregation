/** 详情抽屉：查看、外链跳转与编辑 */
import { api } from './api.js';
import { coverOf } from './cards.js';
import { el, externalLink, fmtDate, fmtNum, SOURCE_LABEL, TYPE_LABEL, toast } from './ui.js';
import { emit } from './state.js';

let currentUid = null;

const drawer = () => document.getElementById('drawer');
const body = () => document.getElementById('drawer-body');

function closeDetail() {
  currentUid = null;
  drawer().hidden = true;
}

/** 字段行 */
function kv(label, value) {
  if (!value) return null;
  return [el('dt', { text: label }), el('dd', {}, Array.isArray(value) ? value : String(value))];
}

/** 编辑表单 */
function buildEditForm(item) {
  const field = (name, label, value, multiline = false) => {
    const input = multiline
      ? el('textarea', { name, text: value || '' })
      : el('input', { name, type: 'text', value: value || '' });
    return el('div', {}, [el('label', { text: label }), input]);
  };

  const favorite = el('input', { type: 'checkbox', name: 'favorite' });
  favorite.checked = Boolean(item.favorite);

  const form = el('form', { class: 'edit-grid' }, [
    field('title', '标题', item.title),
    field('summary', '内容概述', item.summary, true),
    field('gameplay', '玩法简介', item.gameplay, true),
    field('tags', '标签（逗号分隔）', (item.tags || []).join(', ')),
    field('note', '备注', item.note),
    el('label', { class: 'edit-row' }, [favorite, '标为收藏']),
    el('div', { class: 'edit-row' }, [
      el('button', { class: 'btn small primary', type: 'submit', text: '保存' }),
      el('button', { class: 'btn small', type: 'button', text: '还原原值', onclick: () => resetEdit(item.uid) }),
      el('button', { class: 'btn small', type: 'button', text: '删除条目', onclick: () => removeItem(item.uid) }),
    ]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await api.patch(item.uid, {
        title: data.get('title'),
        summary: data.get('summary'),
        gameplay: data.get('gameplay'),
        tags: String(data.get('tags') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        note: data.get('note'),
        favorite: data.get('favorite') === 'on',
      });
      toast('已保存');
      await openDetail(item.uid);
      emit('data-stale');
    } catch (err) {
      toast(err.message);
    }
  });
  return form;
}

async function resetEdit(uid) {
  try {
    await api.reset(uid);
    toast('已还原原始数据');
    await openDetail(uid);
    emit('data-stale');
  } catch (err) {
    toast(err.message);
  }
}

async function removeItem(uid) {
  try {
    await api.remove(uid);
    toast('已删除');
    closeDetail();
    emit('data-stale');
  } catch (err) {
    toast(err.message);
  }
}

async function refreshItem(uid) {
  try {
    toast('正在从来源站刷新…');
    await api.refresh(uid);
    toast('已刷新');
    await openDetail(uid);
    emit('data-stale');
  } catch (err) {
    toast(err.message);
  }
}

/** 渲染详情内容 */
function renderDetail({ item, duplicatePrimary, sameGroup }) {
  const root = el('div', { class: 'detail' });
  root.append(el('div', { class: 'detail-cover' }, [coverOf(item, true)]));
  root.append(el('h2', { text: item.title }));

  root.append(el('div', { class: 'src-links' }, [
    externalLink(item.url, '打开来源页'),
    item.extra?.sourceUrl ? externalLink(item.extra.sourceUrl, '源码仓库') : null,
    item.extra?.wikiUrl ? externalLink(item.extra.wikiUrl, 'Wiki') : null,
    item.extra?.issuesUrl ? externalLink(item.extra.issuesUrl, '问题反馈') : null,
  ]));

  const pairs = [
    kv('来源', SOURCE_LABEL[item.source] || item.source),
    kv('类型', TYPE_LABEL[item.type] || item.type),
    kv('作者', item.author),
    kv('版本', (item.versions || []).slice(-8).join(' ')),
    kv('加载器', (item.loaders || []).join(' ')),
    kv('分类', (item.categories || []).join(' ')),
    kv('下载', item.stats?.downloads ? fmtNum(item.stats.downloads) : ''),
    kv('关注', item.stats?.follows ? fmtNum(item.stats.follows) : ''),
    kv('发布', fmtDate(item.publishedAt)),
    kv('更新', fmtDate(item.updatedAt)),
    kv('许可', item.license),
    kv('采集', fmtDate(item.collectedAt)),
    kv('备注', item.note),
  ].flat().filter(Boolean);
  if (pairs.length) root.append(el('dl', { class: 'kv' }, pairs));

  if (item.summary) {
    root.append(el('div', { class: 'section-title', text: '内容概述' }));
    root.append(el('p', { text: item.summary }));
  }
  if (item.gameplay) {
    root.append(el('div', { class: 'section-title', text: '玩法简介' }));
    root.append(el('p', { text: item.gameplay }));
  }

  const gallery = (item.gallery || []).filter((g) => g && g !== item.cover).slice(0, 10);
  if (gallery.length) {
    root.append(el('div', { class: 'section-title', text: '图集' }));
    root.append(el('div', { class: 'gallery' }, gallery.map((url) => el('img', {
      src: url,
      alt: '',
      referrerpolicy: 'no-referrer',
      onclick: () => window.open(url, '_blank', 'noopener'),
    }))));
  }

  if (duplicatePrimary || (sameGroup || []).length) {
    root.append(el('div', { class: 'section-title', text: '同源重复' }));
    const list = el('div', { class: 'dup-list' });
    if (duplicatePrimary) {
      list.append(el('div', {}, ['主条目：', el('a', {
        href: '#',
        text: duplicatePrimary.title,
        onclick: (e) => {
          e.preventDefault();
          openDetail(duplicatePrimary.uid);
        },
      })]));
    }
    for (const other of sameGroup || []) {
      list.append(el('div', {}, [
        `${SOURCE_LABEL[other.source] || other.source}：`,
        el('a', {
          href: '#',
          text: other.title,
          onclick: (e) => {
            e.preventDefault();
            openDetail(other.uid);
          },
        }),
      ]));
    }
    root.append(list);
  }

  root.append(el('div', { class: 'section-title', text: '编辑' }));
  root.append(buildEditForm(item));

  const box = body();
  box.textContent = '';
  box.append(root);
  document.getElementById('drawer-source').textContent = `${SOURCE_LABEL[item.source] || item.source} · ${TYPE_LABEL[item.type] || item.type}`;
}

/** 打开详情 */
export async function openDetail(uid) {
  currentUid = uid;
  drawer().hidden = false;
  body().textContent = '加载中…';
  try {
    const payload = await api.item(uid);
    if (currentUid !== uid) return;
    renderDetail(payload);
  } catch (err) {
    body().textContent = err.message;
  }
}

/** 绑定抽屉事件 */
export function initDetail() {
  document.getElementById('drawer-close').addEventListener('click', closeDetail);
  document.getElementById('drawer-refresh').addEventListener('click', () => {
    if (currentUid) refreshItem(currentUid);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !drawer().hidden) closeDetail();
  });
}