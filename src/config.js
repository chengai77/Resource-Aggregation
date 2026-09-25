/** 全局配置与可持久化设置项 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './util/log.js';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DATA_DIR = process.env.MCRH_DATA_DIR || path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const PORT = Number(process.env.PORT || 5178);
export const HOST = process.env.HOST || '127.0.0.1';

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

/** 默认设置 */
const DEFAULTS = {
  curseforgeApiKey: '',
  browserMode: false, // 启用可见浏览器抓取 Cloudflare 站点
  requestIntervalMs: 1200, // 同源最小请求间隔
  maxItems: 50000, // 条目上限，超出淘汰最旧
};

let settings = { ...DEFAULTS };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadSettings() {
  try {
    ensureDir();
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      settings = { ...DEFAULTS, ...raw };
    }
  } catch (err) {
    log.warn('config', `设置读取失败，使用默认值：${err.message}`);
  }
  return settings;
}

export function getSettings() {
  return { ...settings };
}

/** 合并写入设置 */
export function saveSettings(patch = {}) {
  const next = { ...settings };
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULTS && v !== undefined) next[k] = v;
  }
  settings = next;
  try {
    ensureDir();
    const tmp = `${SETTINGS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, SETTINGS_FILE);
  } catch (err) {
    log.error('config', `设置写入失败：${err.message}`);
  }
  return getSettings();
}

/** 对外暴露时隐去密钥明文 */
export function maskedSettings() {
  const s = getSettings();
  // 未配置时返回空字符串，避免设置面板把展示文案误保存成 API Key。
  return { ...s, curseforgeApiKey: s.curseforgeApiKey ? '已配置' : '' };
}