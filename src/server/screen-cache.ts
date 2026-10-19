import { getCache } from "@vercel/functions";
// Neon's free plan only covers ~100 compute hours a month, and the database
// stays awake for 5 minutes after every query. TVs poll every 1-2 seconds, so
// everything a paired TV needs on a routine poll is served from Vercel's
// shared runtime cache. Any staff change clears the cache (see expireScreens),
// and the database is only woken when something actually changed.
export const SYNC_TTL_S = 6 * 3600;
export const HEARTBEAT_SAVE_MS = 6 * 3600_000;
export const ERROR_SAVE_MS = 3600_000;
const ALL = "screens";
const cache = () => getCache({ namespace: "oc-screens" });
export type Heartbeat = {
  at: string;
  savedAt: number;
  appVersion: string;
  resolution: string;
  rendererVersion: number;
};
async function get<T>(key: string): Promise<T | null> {
  try {
    return ((await cache().get(key)) as T | null) ?? null;
  } catch (e) {
    console.error(JSON.stringify({ event: "cache_get_failed", key, message: (e as Error).message }));
    return null;
  }
}
async function set(key: string, value: unknown, ttl: number, tags: string[] = []) {
  try {
    await cache().set(key, value, { ttl: Math.max(1, Math.floor(ttl)), tags, name: "" });
  } catch (e) {
    console.error(JSON.stringify({ event: "cache_set_failed", key, message: (e as Error).message }));
  }
}
export const screenTag = (screenId: string) => "screen:" + screenId;
export const syncKey = (tokenHash: string) => "sync:" + tokenHash;
export const getSync = <T>(tokenHash: string) => get<T>(syncKey(tokenHash));
export const setSync = (tokenHash: string, screenId: string, value: unknown, ttl: number) =>
  set(syncKey(tokenHash), value, ttl, [ALL, screenTag(screenId)]);
export const getHeartbeat = (screenId: string) => get<Heartbeat>("hb:" + screenId);
export const setHeartbeat = (screenId: string, hb: Heartbeat) =>
  set("hb:" + screenId, hb, 7 * 86400);
export const getLastError = (screenId: string) =>
  get<{ message: string; savedAt: number }>("err:" + screenId);
export const setLastError = (screenId: string, message: string) =>
  set("err:" + screenId, { message, savedAt: Date.now() }, ERROR_SAVE_MS / 1000);
// A TV can be rebuilding its entry from the database while staff change
// something. Each expiry records when it happened, and an entry rebuilt from
// data read before that moment is dropped instead of being kept for hours.
const EXPIRED_AT = "expired-at";
export const lastExpiry = async () => (await get<number>(EXPIRED_AT)) ?? 0;
const markExpired = () => set(EXPIRED_AT, Date.now(), SYNC_TTL_S + 3600);
export async function dropSync(tokenHash: string) {
  try {
    await cache().delete(syncKey(tokenHash));
  } catch (e) {
    console.error(JSON.stringify({ event: "cache_delete_failed", message: (e as Error).message }));
  }
}
export async function expireScreen(screenId: string) {
  await markExpired();
  try {
    await cache().expireTag(screenTag(screenId));
  } catch (e) {
    console.error(JSON.stringify({ event: "cache_expire_failed", message: (e as Error).message }));
  }
}
export async function expireScreens() {
  await markExpired();
  try {
    await cache().expireTag(ALL);
  } catch (e) {
    console.error(JSON.stringify({ event: "cache_expire_failed", message: (e as Error).message }));
  }
}
// Shows the freshest heartbeat on the dashboard, since most heartbeats now
// live only in the cache.
export async function withLiveHeartbeat<T extends Record<string, any>>(screen: T): Promise<T> {
  const hb = await getHeartbeat(screen.id);
  if (!hb || (screen.last_heartbeat && new Date(screen.last_heartbeat) >= new Date(hb.at)))
    return screen;
  return {
    ...screen,
    last_heartbeat: hb.at,
    app_version: hb.appVersion,
    resolution: hb.resolution,
    renderer_version: hb.rendererVersion,
  };
}
