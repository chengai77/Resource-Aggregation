/** 浏览器抓取：按需启动浏览器，用于带访问校验的站点 */
import path from 'node:path';
import { DATA_DIR, getSettings } from '../config.js';
import { log } from './log.js';

let contextPromise = null;
let available = null;
let queue = Promise.resolve();

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

/** 惰性创建持久化上下文，复用 Cookie 减少重复校验 */
async function getContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const { chromium } = await import('playwright');
      const userDataDir = path.join(DATA_DIR, 'browser-profile');
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // 可见模式，必要时由用户手动完成站点校验
        viewport: { width: 1280, height: 900 },
        locale: 'zh-CN',
        args: ['--no-first-run'],
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

/** 打开页面并返回渲染后的 HTML，串行执行 */
export function browserFetch(url, { timeout = 60000, scroll = true } = {}) {
  const task = async () => {
    const context = await getContext();
    const page = await context.newPage();
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      const status = res?.status() ?? 0;
      await waitForChallenge(page, timeout);
      if (scroll) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(1200);
      }
      const html = await page.content();
      if (status >= 400 && html.length < 4000) throw new Error(`页面返回 ${status}`);
      return html;
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
    await context.close();
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
    hint: ok ? '' : '未安装 playwright，无法使用浏览器模式',
  };
}