// Minimal API used ONLY to measure what one small server can carry. Not the production backend.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { PRAGMAS } from './schema.mjs';
const db = new DatabaseSync(process.argv[2] || 'bench.db'); db.exec(PRAGMAS);
const checkin = db.prepare('INSERT OR IGNORE INTO att VALUES (?,?,?,?)');
const upsert = db.prepare('INSERT OR REPLACE INTO att VALUES (?,?,?,?)');
const summary = db.prepare('SELECT status, COUNT(*) c FROM att WHERE student_id=? GROUP BY status');
const sessionView = db.prepare('SELECT status, COUNT(*) c FROM att WHERE session_id=? GROUP BY status');
const json = (res, code, o) => { const b = JSON.stringify(o); res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }); res.end(b); };
http.createServer((req, res) => {
  if (req.method === 'GET') {
    const [, kind, id] = req.url.split('?')[0].split('/');
    if (kind === 'student') { const rows = summary.all(+id); const t = rows.reduce((a, r) => a + r.c, 0); const p = rows.filter(r => r.status === 1).reduce((a, r) => a + r.c, 0); return json(res, 200, { total: t, present: p, pct: t ? Math.round(p * 1000 / t) / 10 : null }); }
    if (kind === 'session') return json(res, 200, sessionView.all(+id));
    if (kind === 'health') return json(res, 200, { ok: true, rss: process.memoryUsage().rss });
    return json(res, 404, {});
  }
  let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
    try {
      const d = JSON.parse(body); const now = Date.now();
      if (req.url === '/checkin') { checkin.run(d.s, d.sess, 1, now); return json(res, 200, { ok: 1 }); }
      if (req.url === '/batch') { db.exec('BEGIN'); try { for (const [s, st] of d.marks) upsert.run(s, d.sess, st, now); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return json(res, 200, { ok: d.marks.length }); }
      json(res, 404, {});
    } catch (e) { json(res, 500, { error: String(e.message) }); }
  });
}).listen(8199, () => console.log('listening 8199, pid', process.pid));
