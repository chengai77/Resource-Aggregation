/** 后端接口封装 */
const BASE = '/api';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

export const api = {
  items: (params) => request(`/items?${new URLSearchParams(params)}`),
  item: (uid) => request(`/items/${encodeURIComponent(uid)}`),
  patch: (uid, fields) => request(`/items/${encodeURIComponent(uid)}`, { method: 'PATCH', body: fields }),
  reset: (uid) => request(`/items/${encodeURIComponent(uid)}/reset`, { method: 'POST' }),
  remove: (uid) => request(`/items/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
  refresh: (uid) => request(`/items/${encodeURIComponent(uid)}/refresh`, { method: 'POST' }),
  facets: () => request('/facets'),
  sources: () => request('/sources'),
  collect: (params) => request('/collect', { method: 'POST', body: params }),
  collectStatus: () => request('/collect/status'),
  dedupe: (threshold) => request('/dedupe', { method: 'POST', body: { threshold } }),
  logs: (limit = 60) => request(`/logs?limit=${limit}`),
  settings: () => request('/settings'),
  saveSettings: (patch) => request('/settings', { method: 'POST', body: patch }),
  verifyPlanetMinecraft: () => request('/browser/verify/planetminecraft', { method: 'POST', body: {} }),
  browserStatus: () => request('/browser/status'),
  exportUrl: (format, params) => `${BASE}/export?${new URLSearchParams({ ...params, format })}`,
};