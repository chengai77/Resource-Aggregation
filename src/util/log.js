/** 日志：控制台输出 + 内存环形缓冲 */
const RING_LIMIT = 800;
const ring = [];

function stamp(ts) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

function push(level, scope, message) {
  const entry = { ts: Date.now(), level, scope, message: String(message) };
  ring.push(entry);
  if (ring.length > RING_LIMIT) ring.shift();
  const line = `[${stamp(entry.ts)}][${scope}] ${entry.message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (scope, msg) => push('info', scope, msg),
  warn: (scope, msg) => push('warn', scope, msg),
  error: (scope, msg) => push('error', scope, msg),
  /** 读取最近日志 */
  recent(limit = 150) {
    const n = Math.max(1, Math.min(Number(limit) || 150, RING_LIMIT));
    return ring.slice(-n);
  },
};