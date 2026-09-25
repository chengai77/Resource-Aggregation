/** 采集面板与设置面板 */
import { api } from './api.js';
import { el, closeModal, field, openModal, SOURCE_LABEL, TYPE_LABEL, toast } from './ui.js';
import { emit } from './state.js';

let pollTimer = null;

/** 采集表单 */
function buildCollectForm(sources) {
  const sourceBoxes = sources.map((src) => {
    const box = el('input', { type: 'checkbox', value: src.id });
    box.checked = src.ready;
    box.disabled = !src.ready;
    return el('label', { class: 'edit-row', title: src.notes || '' }, [
      box,
      `${SOURCE_LABEL[src.id] || src.label}${src.ready ? '' : '（不可用）'}`,
    ]);
  });

  const type = el('select', {}, Object.entries(TYPE_LABEL).map(([value, label]) => el('option', { value, text: label })));
  type.value = 'datapack';

  const sort = el('select', {}, [
    el('option', { value: 'hot', text: '热门' }),
    el('option', { value: 'downloads', text: '下载量' }),
    el('option', { value: 'latest', text: '最新' }),
    el('option', { value: 'updated', text: '最近更新' }),
  ]);

  const query = el('input', { type: 'text', placeholder: '留空则按热度浏览' });
  const categories = el('input', { type: 'text', placeholder: '如 minigame,adventure' });
  const versions = el('input', { type: 'text', placeholder: '如 1.21,1.20.4' });
  const pages = el('input', { type: 'number', value: '1', min: '1', max: '10' });
  const limit = el('input', { type: 'number', value: '30', min: '1', max: '100' });

  const enrich = el('input', { type: 'checkbox' });
  enrich.checked = true;
  const dedupe = el('input', { type: 'checkbox' });
  dedupe.checked = true;

  const steps = el('div', { class: 'steps' });
  const logs = el('div', { class: 'logs' });

  const start = el('button', { class: 'btn primary', type: 'submit', text: '开始采集' });

  const form = el('form', { class: 'form-grid' }, [
    field('数据源', el('div', {}, sourceBoxes)),
    el('div', { class: 'inline' }, [field('类型', type), field('排序', sort)]),
    field('关键词', query),
    el('div', { class: 'inline' }, [field('分类', categories), field('游戏版本', versions)]),
    el('div', { class: 'inline' }, [field('页数', pages), field('每页数量', limit)]),
    el('label', { class: 'edit-row' }, [enrich, '补全正文（内容概述与玩法简介）']),
    el('label', { class: 'edit-row' }, [dedupe, '采集后自动去重']),
    el('div', { class: 'edit-row' }, [start, el('span', { class: 'hint', text: '采集在后台进行，可关闭本窗口' })]),
    steps,
    logs,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const chosen = sourceBoxes.map((label) => label.querySelector('input')).filter((b) => b.checked).map((b) => b.value);
    if (!chosen.length) return toast('请至少选择一个可用数据源');
    start.disabled = true;
    try {
      await api.collect({
        sources: chosen,
        type: type.value,
        sort: sort.value,
        query: query.value.trim(),
        categories: categories.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        versions: versions.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        pages: Number(pages.value) || 1,
        limit: Number(limit.value) || 30,
        enrich: enrich.checked,
        dedupe: dedupe.checked,
      });
      toast('采集已开始');
      pollStatus(steps, logs, start);
    } catch (err) {
      toast(err.message);
      start.disabled = false;
    }
  });

  return { form, steps, logs, start };
}

/** 轮询采集进度 */
function pollStatus(steps, logs, startBtn) {
  clearInterval(pollTimer);
  const tick = async () => {
    try {
      const status = await api.collectStatus();
      renderSteps(steps, status);
      const { logs: recent } = await api.logs(20);
      logs.textContent = recent.map((l) => `[${l.scope}] ${l.message}`).join('\n');
      logs.scrollTop = logs.scrollHeight;
      if (!status.running) {
        clearInterval(pollTimer);
        pollTimer = null;
        if (startBtn) startBtn.disabled = false;
        emit('data-stale');
      }
    } catch {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
  tick();
  pollTimer = setInterval(tick, 1500);
}

function renderSteps(box, status) {
  box.textContent = '';
  if (!status.steps?.length) {
    box.append(el('div', { class: 'hint', text: status.running ? '准备中…' : '暂无采集记录' }));
    return;
  }
  for (const step of status.steps) {
    box.append(el('div', { class: 'step' }, [
      el('span', { class: `st ${step.state}`, text: step.state }),
      el('span', { text: step.label }),
      el('span', { class: 'hint', text: step.message || step.note || '' }),
      el('span', { class: 'sp', text: `抓取 ${step.fetched} / 新增 ${step.inserted} / 更新 ${step.updated}` }),
    ]));
  }
  if (status.running) box.append(el('div', { class: 'hint', text: '采集中…' }));
}

/** 打开采集面板 */
export async function openCollect() {
  let sources = [];
  try {
    const data = await api.sources();
    sources = data.sources || [];
  } catch (err) {
    return toast(`数据源读取失败：${err.message}`);
  }
  const { form, steps, logs, start } = buildCollectForm(sources);
  openModal('采集资源', form);
  pollStatus(steps, logs, start);
}

/** 设置面板 */
export async function openSettings() {
  let settings = {};
  try {
    settings = await api.settings();
  } catch (err) {
    return toast(err.message);
  }

  const key = el('input', { type: 'text', value: settings.curseforgeApiKey || '', placeholder: '未配置时该源自动跳过' });
  const cookie = el('input', { type: 'text', value: settings.klpbbsCookie || '', placeholder: '未配置时仅按板块翻页' });
  const browser = el('input', { type: 'checkbox' });
  browser.checked = Boolean(settings.browserMode);
  const interval = el('input', { type: 'number', value: String(settings.requestIntervalMs || 1200), min: '300' });
  const maxItems = el('input', { type: 'number', value: String(settings.maxItems || 50000), min: '1000' });

  const form = el('form', { class: 'form-grid' }, [
    field('CurseForge API Key', key, '第三方使用者需向 Overwolf 提交申请表单获取，非自助注册'),
    field('苦力怕论坛 Cookie', cookie, '登录后从浏览器开发者工具复制，用于关键词搜索'),
    field('请求间隔（毫秒）', interval, '同源最小请求间隔，过低易被限流'),
    field('库存上限', maxItems, '超出后淘汰最旧的未编辑条目'),
    el('label', { class: 'edit-row' }, [browser, '启用浏览器抓取模式（需安装 playwright）']),
    el('div', { class: 'edit-row' }, [el('button', { class: 'btn primary', type: 'submit', text: '保存' })]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api.saveSettings({
        curseforgeApiKey: key.value.trim(),
        klpbbsCookie: cookie.value.trim(),
        browserMode: browser.checked,
        requestIntervalMs: Number(interval.value) || 1200,
        maxItems: Number(maxItems.value) || 50000,
      });
      toast('设置已保存');
      closeModal();
      emit('sources-stale');
    } catch (err) {
      toast(err.message);
    }
  });

  openModal('设置', form);
}