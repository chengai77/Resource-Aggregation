/** 浏览器抓取：按需启动，用于带访问校验的站点 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getSettings } from '../config.js';
import { log } from './log.js';

const STATE_FILE = path.join(DATA_DIR, 'browser-state.json');
let contextPromise = null;
let available = null;
let queue = Promise.resolve();
let verification = {
  running: false,
  state: 'idle',
  url: '',
  startedAt: 0,
  finishedAt: 0,
  error: '',
};

/**
 * 判断 HTML 是否仍是 Cloudflare/站点挑战页。
 * 200 状态并不代表挑战已通过，因此不能只看 HTTP 状态码。
 */
export function looksLikeChallengePage(html = '') {
  const text = String(html).slice(0, 300000).toLowerCase();
  const titleChallenge = /<title[^>]*>[^<]*(just a moment|attention required|verify you are human|请稍候|正在验证)/i.test(text);
  const markers = [
    '/cdn-cgi/challenge-platform/',
    '__cf_chl_',
    'cf-chl-',
    'cf-turnstile',
    'challenge-stage',
    'challenge-form',
  ].filter((marker) => text.includes(marker));
  return titleChallenge || markers.length >= 2;
}

/** 判断 HTML 是否是站点直接拒绝访问的拦截页（不可解，只能等冷却） */
export function looksLikeBlockedPage(html = '') {
  const head = String(html).slice(0, 4000).toLowerCase();
  return /error 1006|used cloudflare to restrict access/.test(head) || head.includes('access denied');
}

/** playwright 是否可用 */
export async function isBrowserAvailable() {
  if (available !== null) return available;
  try {
    await import('playwright');
    available = true;
  } catch {
    available = false;
  }
  return available;
}

/** 读取上次保存的 Cookie */
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return undefined;
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return Array.isArray(raw.cookies) && raw.cookies.length ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** 保存 Cookie 供下次复用，避免重复通过站点校验 */
async function saveState(context) {
  try {
    await context.storageState({ path: STATE_FILE });
  } catch (err) {
    log.warn('browser', `Cookie 保存失败：${err.message}`);
  }
}

/** 惰性创建上下文，用 storageState 复用 Cookie（不占用 profile 目录锁） */
async function getContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: false, args: ['--no-first-run'] });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'zh-CN',
        storageState: loadState(),
      });
      context.on('close', () => {
        contextPromise = null;
      });
      log.info('browser', '浏览器已启动（可见窗口）');
      return context;
    })().catch((err) => {
      contextPromise = null;
      throw err;
    });
  }
  return contextPromise;
}

/** 浏览器模式限速，避免高频请求触发站点防护 */
let nextAllowedAt = 0;
async function throttle() {
  const interval = Math.max(1000, Number(getSettings().browserIntervalMs) || 5000);
  const now = Date.now();
  const at = Math.max(now, nextAllowedAt);
  nextAllowedAt = at + interval;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** 等待站点校验页结束 */
async function waitForChallenge(page, timeout) {
  const deadline = Date.now() + timeout;
  let waited = 0;
  while (Date.now() < deadline) {
    const passed = await page
      .evaluate(() => {
        const title = document.title || '';
        if (/just a moment|attention required|请稍候|正在验证/i.test(title)) return false;
        return !document.querySelector('#challenge-form, #cf-challenge-running, #challenge-stage, .cf-turnstile');
      })
      .catch(() => true);
    if (passed) return true;
    if (waited === 0) log.info('browser', '检测到站点校验页，请在窗口内完成验证…');
    await page.waitForTimeout(1500);
    waited += 1500;
  }
  return false;
}

/**
 * 打开页面并返回渲染后的 HTML，串行执行。
 * 浏览器窗口保持可见，挑战页由用户本人完成验证；程序不伪造或注入挑战凭据。
 */
export function browserFetch(url, { timeout = 60000, scroll = true, clickSelector = '', clickTimes = 0, clickWait = 2500 } = {}) {
  const task = async () => {
    await throttle();
    verification = { running: true, state: 'opening', url, startedAt: Date.now(), finishedAt: 0, error: '' };
    const context = await getContext();
    const page = await context.newPage();
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      const status = res?.status() ?? 0;
      verification.state = 'waiting_manual_verification';
      const passed = await waitForChallenge(page, timeout);
      if (!passed) throw new Error('人工验证未在规定时间内完成');
      verification.state = 'collecting';
      // 点击「加载更多」类按钮以展开后续内容
      for (let i = 0; i < clickTimes; i++) {
        const target = await page.$(clickSelector).catch(() => null);
        if (!target) break;
        await target.click().catch(() => {});
        await page.waitForTimeout(clickWait);
      }
      if (scroll) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(1200);
      }
      const html = await page.content();
      if (looksLikeChallengePage(html)) throw new Error('验证后仍返回挑战页面');
      // 拦截页不是有效内容，避免把拒绝访问当成数据
      if (looksLikeBlockedPage(html)) throw new Error('站点拒绝访问（Cloudflare 拦截）');
      if (status >= 400 && html.length < 4000) throw new Error(`页面返回 ${status}`);
      await saveState(context);
      verification = { ...verification, running: false, state: 'verified', finishedAt: Date.now() };
      return html;
    } catch (err) {
      verification = { ...verification, running: false, state: 'error', finishedAt: Date.now(), error: err.message };
      throw err;
    } finally {
      await page.close().catch(() => {});
    }
  };
  const result = queue.then(task, task);
  queue = result.then(() => {}, () => {});
  return result;
}

/** 退出时关闭浏览器 */
export async function closeBrowser() {
  if (!contextPromise) return;
  try {
    const context = await contextPromise;
    await saveState(context);
    await context.browser()?.close();
  } catch {
    // 忽略关闭异常
  }
  contextPromise = null;
}

/** 供前端展示的浏览器模式状态 */
export async function browserStatus() {
  const settings = getSettings();
  const ok = await isBrowserAvailable();
  return {
    enabled: Boolean(settings.browserMode),
    installed: ok,
    running: Boolean(contextPromise),
    verification: { ...verification },
    hint: ok ? '' : '未安装 playwright，无法使用浏览器模式',
  };
}