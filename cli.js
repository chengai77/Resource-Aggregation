/** 命令行工具：采集、导出与自测 */
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith('-')) || 'help';

// 自测使用独立数据目录，避免污染正式数据
if (command === 'selftest') {
  process.env.MCRH_DATA_DIR = path.join(ROOT, '.selftest-data');
  fs.rmSync(process.env.MCRH_DATA_DIR, { recursive: true, force: true });
}

const { loadSettings, DATA_DIR } = await import('./src/config.js');
const { store } = await import('./src/store/store.js');
const { collector } = await import('./src/collector.js');
const { runDedupe } = await import('./src/store/dedupe.js');
const { parseQuery, queryFacets, queryItems } = await import('./src/server/query.js');
const { toCsv, toMarkdown } = await import('./src/server/export.js');
const { makeItem } = await import('./src/sources/base.js');

/** 解析 --key=value 参数 */
function parseArgs(list) {
  const out = {};
  for (const raw of list) {
    if (!raw.startsWith('--')) continue;
    const body = raw.slice(2);
    const eq = body.indexOf('=');
    if (eq < 0) out[body] = true;
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

const args = parseArgs(argv);

function printStats() {
  const stats = store.stats();
  console.log(`库存 ${stats.total} 条 | 已编辑 ${stats.edited} | 重复标记 ${stats.duplicated}`);
  console.log('按来源：', stats.bySource);
  console.log('按类型：', stats.byType);
}

async function cmdCollect() {
  loadSettings();
  store.load();
  const result = await collector.run({
    sources: args.source ? String(args.source).split(',') : undefined,
    type: args.type || 'datapack',
    query: args.query || '',
    sort: args.sort || 'hot',
    categories: args.category ? String(args.category).split(',') : [],
    versions: args.version ? String(args.version).split(',') : [],
    pages: Number(args.pages) || 1,
    limit: Number(args.limit) || 30,
    enrich: args.enrich !== 'false',
    dedupe: args.dedupe !== 'false',
  });
  for (const step of result.steps) {
    console.log(`[${step.state}] ${step.label} 抓取 ${step.fetched} 新增 ${step.inserted} 更新 ${step.updated} ${step.message || step.note || ''}`);
  }
  printStats();
}

function cmdStats() {
  store.load();
  printStats();
  const facets = queryFacets();
  console.log('热门分类：', facets.categories.slice(0, 8).map((c) => `${c.value}(${c.count})`).join(' '));
  console.log('版本分布：', facets.versions.slice(0, 8).map((c) => `${c.value}(${c.count})`).join(' '));
}

function cmdExport() {
  store.load();
  const format = String(args.format || 'json');
  const params = { ...parseQuery({ q: args.query || '', type: args.type || '' }), dup: 'all', page: 1, limit: 100000 };
  const { items } = queryItems(params);
  const body = format === 'csv' ? toCsv(items) : format === 'md' ? toMarkdown(items) : JSON.stringify({ total: items.length, items }, null, 2);
  const out = args.out ? path.resolve(ROOT, String(args.out)) : path.join(DATA_DIR, `export-${Date.now()}.${format === 'md' ? 'md' : format}`);
  fs.writeFileSync(out, body, 'utf8');
  console.log(`已导出 ${items.length} 条 → ${out}`);
}

/** 端到端自测：抓取、字段、去重、查询、导出 */
async function cmdSelftest() {
  loadSettings();
  store.load();
  const checks = [];
  const check = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true });
      console.log(`[通过] ${name}`);
    } catch (err) {
      checks.push({ name, ok: false, err: err.message });
      console.error(`[失败] ${name} → ${err.message}`);
    }
  };

  await check('Modrinth 搜索返回条目', async () => {
    const { getAdapter } = await import('./src/sources/index.js');
    const adapter = getAdapter('modrinth');
    const res = await adapter.search({ type: 'datapack', sort: 'downloads', limit: 5, page: 1 });
    assert.ok(res.items.length > 0, '未返回任何条目');
    for (const it of res.items) {
      assert.ok(it.uid && it.title && it.url && it.source === 'modrinth', `字段缺失：${JSON.stringify(it).slice(0, 120)}`);
      assert.equal(it.type, 'datapack');
    }
    store.upsertMany(res.items);
    assert.ok(store.items.size >= res.items.length, '入库数量不足');
  });

  await check('Modrinth 详情含玩法简介', async () => {
    const { getAdapter } = await import('./src/sources/index.js');
    const adapter = getAdapter('modrinth');
    const first = store.rawAll().find((it) => it.source === 'modrinth' && !/^[xyz]1$/.test(it.sourceId));
    assert.ok(first, '缺少可用于详情的真实条目');
    const detail = await adapter.details(first.sourceId, first.type);
    assert.ok(detail.summary, '缺少概述');
    assert.ok(detail.gameplay.length > 20, '玩法简介过短');
    assert.ok(detail.versions.length > 0, '缺少版本信息');
    assert.ok(detail.url.includes('modrinth.com'), '链接格式异常');
  });

  await check('批量补全填充正文', async () => {
    const { getAdapter } = await import('./src/sources/index.js');
    const adapter = getAdapter('modrinth');
    const items = store.rawAll().slice(0, 3);
    const patches = await adapter.enrich(items);
    assert.ok(patches.size > 0, '补全无结果');
    const anyWithGameplay = [...patches.values()].some((p) => (p.gameplay || '').length > 10);
    assert.ok(anyWithGameplay, '补全未提供玩法简介');
  });

  await check('klpbbs 列表、详情与补全可用', async () => {
    const { getAdapter } = await import('./src/sources/index.js');
    const adapter = getAdapter('klpbbs');
    const res = await adapter.search({ type: 'map', page: 1, limit: 3 });
    assert.ok(res.items.length > 0, '未返回任何条目');
    for (const it of res.items) {
      assert.ok(it.uid && it.title && it.url.includes('klpbbs.com'), `字段缺失：${JSON.stringify(it).slice(0, 120)}`);
    }
    const detail = await adapter.details(res.items[0].sourceId, 'map');
    assert.ok(detail.summary.length > 10, '详情缺少概述');
    assert.ok(detail.versions.length > 0 || detail.gallery.length > 0, '详情缺少版本与图片');
    const patches = await adapter.enrich(res.items);
    assert.ok([...patches.values()].some((p) => (p.summary || '').length > 10), '补全未提供概述');
    store.upsertMany(res.items);
    const sources = new Set(store.rawAll().map((it) => it.source));
    assert.ok(sources.size >= 2, '多源数据未共存');
  });

  await check('跨源去重标记相似条目', async () => {
    const a = makeItem({ source: 'modrinth', sourceId: 'x1', type: 'datapack', title: 'Better Villages Reborn', url: 'https://modrinth.com/datapack/better-villages-reborn' });
    const b = makeItem({ source: 'planetminecraft', sourceId: 'y1', type: 'datapack', title: 'Better Villages Reborn [1.21]', url: 'https://www.planetminecraft.com/data-pack/better-villages-reborn/' });
    const c = makeItem({ source: 'modrinth', sourceId: 'z1', type: 'datapack', title: 'Falling Tree Chopper', url: 'https://modrinth.com/datapack/falling-tree-chopper' });
    store.upsertMany([a, b, c]);
    const result = runDedupe(store);
    assert.ok(result.groups >= 1, '未发现重复组');
    const dup = store.items.get(b.uid);
    assert.equal(dup.dupOf, a.uid, '重复项未指向主条目');
    assert.equal(store.items.get(c.uid).dupOf, null, '无关条目被误判重复');
  });

  await check('查询筛选与排序可用', async () => {
    const res = queryItems(parseQuery({ q: 'villages', dup: 'all', limit: 10 }));
    assert.ok(res.items.length >= 1, '关键词查询无结果');
    const byDownloads = queryItems(parseQuery({ sort: 'downloads', limit: 5 }));
    assert.ok((byDownloads.items[0]?.stats?.downloads || 0) >= (byDownloads.items[1]?.stats?.downloads || 0), '排序异常');
    const favOnly = queryItems(parseQuery({ favorite: 'true' }));
    assert.equal(favOnly.total, 0, '收藏筛选初始应为空');
  });

  await check('用户编辑覆盖与重置', async () => {
    const target = store.rawAll().find((it) => it.source === 'modrinth');
    const patched = store.patch(target.uid, { title: '我的自定义标题', favorite: true, tags: ['自用', '自用', '测试'] });
    assert.equal(patched.title, '我的自定义标题');
    assert.deepEqual(patched.tags, ['自用', '测试'], '标签未去重');
    assert.equal(queryItems(parseQuery({ favorite: 'true' })).total, 1, '收藏筛选未生效');
    store.resetEdit(target.uid);
    assert.ok(store.get(target.uid).title !== '我的自定义标题', '重置未恢复原始数据');
  });

  await check('导出 CSV 与 Markdown', async () => {
    const items = queryItems(parseQuery({ limit: 100 })).items;
    const csv = toCsv(items);
    const md = toMarkdown(items);
    assert.ok(csv.split('\r\n').length >= items.length + 1, 'CSV 行数不足');
    assert.ok(md.includes('| 标题 |'), 'Markdown 缺少表头');
    assert.ok(md.includes(items[0].title.replace(/\|/g, '\\|')), 'Markdown 缺少数据行');
  });

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n自测完成：${checks.length - failed.length}/${checks.length} 项通过`);
  store.flushNow();
  if (failed.length) process.exitCode = 1;
}

const COMMANDS = { collect: cmdCollect, stats: cmdStats, export: cmdExport, selftest: cmdSelftest };

if (COMMANDS[command]) {
  await COMMANDS[command]();
} else {
  console.log('用法：');
  console.log('  node cli.js collect --type=datapack --query=adventure --pages=2');
  console.log('  node cli.js stats');
  console.log('  node cli.js export --format=csv --out=out.csv');
  console.log('  node cli.js selftest');
}

// 释放可能启动的浏览器，避免进程被 Chromium 挂住
const { closeBrowser } = await import('./src/util/browser.js');
await closeBrowser();