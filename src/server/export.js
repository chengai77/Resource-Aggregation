/** 导出：CSV 与 Markdown */
const HEADERS = ['标题', '类型', '来源', '作者', 'MC版本', '分类', '下载量', '链接', '收录时间', '内容概述', '玩法简介', '备注'];

const TYPE_CN = { map: '地图', datapack: '数据包', modpack: '整合包', resourcepack: '资源包', mod: '模组' };

/** CSV 字段转义 */
function csvCell(value) {
  const s = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowOf(item) {
  return {
    title: item.title,
    type: TYPE_CN[item.type] || item.type,
    source: item.source,
    author: item.author,
    versions: (item.versions || []).slice(-4).join(' '),
    categories: (item.categories || []).slice(0, 6).join(' '),
    downloads: item.stats?.downloads ?? '',
    url: item.url,
    collectedAt: item.collectedAt ? new Date(item.collectedAt).toISOString().slice(0, 10) : '',
    summary: item.summary,
    gameplay: item.gameplay,
    note: item.note || '',
  };
}

export function toCsv(items) {
  const lines = [HEADERS.join(',')];
  for (const item of items) {
    const row = rowOf(item);
    lines.push(
      [row.title, row.type, row.source, row.author, row.versions, row.categories, row.downloads, row.url, row.collectedAt, row.summary, row.gameplay, row.note]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

/** Markdown 表格，管道符需转义 */
function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export function toMarkdown(items) {
  const lines = [
    '# Minecraft 资源清单',
    '',
    `共 ${items.length} 条，导出时间 ${new Date().toLocaleString('zh-CN')}`,
    '',
    '| 标题 | 类型 | 来源 | 作者 | 版本 | 下载量 | 链接 | 内容概述 | 玩法简介 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const item of items) {
    const row = rowOf(item);
    lines.push(
      `| ${mdCell(row.title)} | ${mdCell(row.type)} | ${mdCell(row.source)} | ${mdCell(row.author)} | ${mdCell(row.versions)} | ${mdCell(row.downloads)} | [打开](${item.url}) | ${mdCell(row.summary)} | ${mdCell(row.gameplay)} |`,
    );
  }
  return lines.join('\n');
}