import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from './config.mjs';
import { openDb } from './db.mjs';
import { Router, SECURITY_HEADERS } from './lib/router.mjs';
import { serveStatic } from './lib/static.mjs';
import { initPush, startPushWorker } from './lib/push.mjs';
import { scheduleBackups } from './lib/backup.mjs';
import { startSeenFlusher, flushSeen } from './lib/auth.mjs';
import authRoutes from './routes/auth.mjs';
import adminRoutes from './routes/admin.mjs';
import attendanceRoutes from './routes/attendance.mjs';
import studentRoutes from './routes/student.mjs';
import hodRoutes from './routes/hod.mjs';
import notifyRoutes from './routes/notify.mjs';

export const VERSION = '1.0.0';

export async function createApp({ dbFile, workers = true, pushSender } = {}) {
  const db = openDb(dbFile);
  const router = new Router(db);
  router.get('/api/health', { auth: false }, () => { db.prepare('SELECT 1').get(); return { ok: true, version: VERSION }; });
  for (const mod of [authRoutes, adminRoutes, attendanceRoutes, studentRoutes, hodRoutes, notifyRoutes]) mod(router, db);
  if (workers) await initPush();
  const server = http.createServer(async (req, res) => {
    try { if (!(await router.handle(req, res))) serveStatic(req, res); }
    catch (e) { console.error('[fatal-request]', e); if (!res.headersSent) { res.writeHead(500, SECURITY_HEADERS); } res.end(); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 65000;
  const timers = [];
  const housekeeping = () => {
    const t = Date.now();
    db.prepare('DELETE FROM auth_sessions WHERE expires_at<?').run(t);
    db.prepare('DELETE FROM ops WHERE ts<?').run(t - 14 * 86400e3);
    db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at<?').run(t - 90 * 86400e3);
  };
  housekeeping();
  const sweepWindows = () => db.prepare('UPDATE lecture_sessions SET code_until=0 WHERE code_until>0 AND code_until<?').run(Date.now());
  if (workers) { const h = setInterval(housekeeping, 3600e3), w = setInterval(sweepWindows, 30e3); h.unref(); w.unref(); timers.push(h, w, startSeenFlusher(db), startPushWorker(db, pushSender).timer, scheduleBackups(db)); }
  const close = async () => { flushSeen(db); for (const t of timers) if (t) clearInterval(t); await new Promise(r => server.close(r)); try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* already closed */ } };
  return { server, db, router, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createApp();
  app.server.listen(config.port, config.host, () => console.log(`[gmc] v${VERSION} listening on http://${config.host}:${config.port} data=${config.dataDir} static=${config.staticDir}`));
  const stop = sig => { console.log(`[gmc] ${sig} received, shutting down`); setTimeout(() => process.exit(1), 10000).unref(); app.close().then(() => process.exit(0)); };
  process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
}
