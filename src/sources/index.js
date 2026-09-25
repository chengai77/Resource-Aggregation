/** 源注册表：集中管理适配器与就绪状态 */
import { modrinthAdapter } from './modrinth.js';
import { planetMinecraftAdapter } from './planetminecraft.js';
import { klpbbsAdapter } from './klpbbs.js';
import { minecraftMapsAdapter } from './minecraftmaps.js';
import { curseForgeAdapter } from './curseforge.js';

const ADAPTERS = [modrinthAdapter, planetMinecraftAdapter, minecraftMapsAdapter, klpbbsAdapter, curseForgeAdapter];
const registry = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

/** 全部适配器 */
export function allAdapters() {
  return [...registry.values()];
}

/** 按 id 取适配器 */
export function getAdapter(id) {
  return registry.get(String(id || '')) || null;
}

let stateCache = { at: 0, value: null };

/** 各源就绪状态，5 秒内复用结果 */
export async function adapterStates(force = false) {
  if (!force && stateCache.value && Date.now() - stateCache.at < 5000) return stateCache.value;
  const list = await Promise.all(
    allAdapters().map(async (adapter) => {
      let ready = { ready: true, reason: '' };
      try {
        ready = await adapter.checkReady();
      } catch (err) {
        ready = { ready: false, reason: err.message };
      }
      return adapter.describe({ ready: ready.ready, reason: ready.reason, notes: adapter.notes });
    }),
  );
  stateCache = { at: Date.now(), value: list };
  return list;
}

/** 清空就绪状态缓存 */
export function invalidateStates() {
  stateCache = { at: 0, value: null };
}