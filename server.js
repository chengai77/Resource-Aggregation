/** 程序入口 */
import { startServer } from './src/server/app.js';
import { loadSettings } from './src/config.js';
import { store } from './src/store/store.js';
import { log } from './src/util/log.js';

// 全局兜底，防止未捕获异常导致进程退出
process.on('unhandledRejection', (reason) => {
  log.error('process', `未处理的 Promise 异常：${reason?.message || reason}`);
});
process.on('uncaughtException', (err) => {
  log.error('process', `未捕获异常：${err.message}`);
  store.flushNow();
});

loadSettings();
startServer();