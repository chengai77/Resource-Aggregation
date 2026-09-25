/** Express 应用装配与启动 */
import express from 'express';
import { HOST, PORT, PUBLIC_DIR, loadSettings } from '../config.js';
import { store } from '../store/store.js';
import { createRouter } from './routes.js';
import { closeBrowser } from '../util/browser.js';
import { log } from '../util/log.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createRouter());
  // 静态资源强制协商缓存，避免前端更新后加载旧文件
  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      if (/\.(css|js|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // 统一错误出口，避免单个异常拖垮服务
  app.use((err, req, res, _next) => {
    const status = Number(err.code) === 409 ? 409 : Number(err.status) || 500;
    if (status >= 500) log.error('server', `${req.method} ${req.originalUrl} → ${err.message}`);
    if (!res.headersSent) res.status(status).json({ error: err.message || '内部错误' });
  });
  return app;
}

export function startServer() {
  loadSettings();
  store.load();
  const app = createApp();
  const server = app.listen(PORT, HOST, () => {
    log.info('server', `已启动：http://${HOST}:${PORT}`);
  });

  // 退出前落盘并关闭浏览器，避免数据丢失与残留进程
  const shutdown = (signal) => {
    log.info('server', `收到 ${signal}，正在保存并退出`);
    store.flushNow();
    closeBrowser();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}