/**
 * Tiny stale-while-revalidate cache for client GETs that several components ask for at
 * once (the shell badge, the project browser, discuss buttons all want the unread summary).
 * Callers asking within `ttlMs` share one request; failed results are never cached.
 */
type Entry<T> = { at: number; promise: Promise<T> };
const store = new Map<string, Entry<unknown>>();

export function dedupe<T extends { ok: boolean }>(key: string, ttlMs: number, load: () => Promise<T>, now = Date.now): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && now() - hit.at < ttlMs) return hit.promise;
  const promise = load().then((result) => {
    if (!result.ok && store.get(key)?.promise === promise) store.delete(key);
    return result;
  }, (error) => {
    if (store.get(key)?.promise === promise) store.delete(key);
    throw error;
  });
  store.set(key, { at: now(), promise });
  return promise;
}

/** Drop cached entries whose key starts with `prefix` (after a write that changes them). */
export function invalidate(prefix: string) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
