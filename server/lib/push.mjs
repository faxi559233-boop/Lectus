import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { now } from './util.mjs';

let wp = null, vapid = null;
export async function initPush() {
  try { wp = (await import('web-push')).default; } catch { console.warn('[push] web-push not installed; push disabled'); return null; }
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const f = join(config.dataDir, 'vapid.json');
  if (existsSync(f)) vapid = JSON.parse(readFileSync(f, 'utf8')); else { vapid = wp.generateVAPIDKeys(); writeFileSync(f, JSON.stringify(vapid), { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* windows */ } }
  wp.setVapidDetails(config.pushContact, vapid.publicKey, vapid.privateKey);
  return vapid.publicKey;
}
export const publicKey = () => (vapid ? vapid.publicKey : null);

/** Drains unsent notifications at a fixed rate; removes dead subscriptions; backs off on throttling. */
export function startPushWorker(db, inject) {
  const send = inject || ((sub, payload) => wp.sendNotification(sub, payload, { TTL: 86400 }));
  let pausedUntil = 0; const attempts = new Map();
  const tick = async () => {
    if (!wp && !inject) return; if (now() < pausedUntil) return;
    const batch = db.prepare('SELECT * FROM notifications WHERE pushed_at IS NULL ORDER BY id LIMIT ?').all(config.pushRatePerSec);
    for (const n of batch) {
      const subs = db.prepare('SELECT * FROM push_subs WHERE user_id=?').all(n.user_id); let throttled = false;
      const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url || '/portal/' });
      await Promise.allSettled(subs.map(async s => {
        try { await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); }
        catch (e) {
          const sc = e && e.statusCode;
          if (sc === 404 || sc === 410) db.prepare('DELETE FROM push_subs WHERE id=?').run(s.id);
          else if (sc === 429 || sc === 406 || (sc >= 500)) throttled = true;
          else db.prepare('UPDATE push_subs SET failures=failures+1 WHERE id=?').run(s.id);
        }
      }));
      if (throttled) { const k = (attempts.get(n.id) || 0) + 1; attempts.set(n.id, k); pausedUntil = now() + 30000; if (k < 3) break; }
      db.prepare('UPDATE notifications SET pushed_at=? WHERE id=?').run(now(), n.id); attempts.delete(n.id);
    }
  };
  const t = setInterval(() => tick().catch(e => console.error('[push]', e.message)), 1000); t.unref(); return { tick, timer: t };
}
