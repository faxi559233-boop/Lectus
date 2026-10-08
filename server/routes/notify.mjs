import { v, HttpError, now, bad, forbidden } from '../lib/util.mjs';
import { audit } from '../lib/audit.mjs';
import { tx } from '../db.mjs';
import { publicKey } from '../lib/push.mjs';

const ANY = { auth: ['admin', 'hod', 'teacher', 'student'] };
export default function (r, db) {
  r.get('/api/push/key', ANY, () => ({ key: publicKey() }));
  r.post('/api/push/subscribe', ANY, ctx => {
    const endpoint = v.str(ctx.body.endpoint, 'endpoint', { max: 600, re: /^https:\/\// }), k = ctx.body.keys || {};
    const p256dh = v.str(k.p256dh, 'p256dh', { max: 200 }), auth = v.str(k.auth, 'auth', { max: 100 });
    db.prepare('INSERT INTO push_subs(user_id,endpoint,p256dh,auth,created_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth, failures=0').run(ctx.user.id, endpoint, p256dh, auth, now());
    return { ok: true };
  });
  r.post('/api/push/unsubscribe', ANY, ctx => { db.prepare('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(v.str(ctx.body.endpoint, 'endpoint', { max: 600 }), ctx.user.id); return { ok: true }; });
  r.get('/api/notifications', ANY, ctx => ({
    unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(ctx.user.id).c,
    items: db.prepare('SELECT id,title,body,url,created_at,read_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(ctx.user.id) }));
  r.post('/api/notifications/read', ANY, ctx => {
    if (ctx.body.all) db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(), ctx.user.id);
    else for (const id of (Array.isArray(ctx.body.ids) ? ctx.body.ids : []).slice(0, 100)) db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(now(), v.int(id, 'id'), ctx.user.id);
    return { ok: true };
  });
  r.post('/api/announcements', { auth: ['admin', 'hod', 'teacher'] }, ctx => {
    const u = ctx.user, scope = v.oneOf(ctx.body.scope, 'scope', ['all', 'dept', 'section']), sid = v.int(ctx.body.scope_id, 'scope_id', { min: 1, optional: true });
    const title = v.str(ctx.body.title, 'title', { min: 2, max: 120 }), body = v.str(ctx.body.body, 'body', { min: 2, max: 1000 });
    if (scope !== 'all' && sid == null) throw bad('scope_id', 'scope_id is required');
    let q, args = [];
    if (scope === 'all') { if (u.role !== 'admin') throw forbidden('Only admins can announce to everyone'); q = "SELECT user_id FROM students WHERE user_id IS NOT NULL UNION SELECT id FROM users WHERE active=1 AND role<>'student'"; }
    else if (scope === 'dept') {
      if (u.role === 'teacher' || (u.role === 'hod' && u.dept_id !== sid)) throw forbidden('Not your department');
      q = `SELECT st.user_id FROM students st JOIN sections sec ON sec.id=st.section_id JOIN programs p ON p.id=sec.program_id WHERE p.dept_id=? AND st.user_id IS NOT NULL`; args = [sid];
    } else {
      if (u.role === 'teacher' && !db.prepare('SELECT 1 FROM offerings WHERE section_id=? AND teacher_id=?').get(sid, u.id)) throw forbidden('You do not teach this section');
      if (u.role === 'hod' && !db.prepare('SELECT 1 FROM sections sec JOIN programs p ON p.id=sec.program_id WHERE sec.id=? AND p.dept_id=?').get(sid, u.dept_id)) throw forbidden('Not your department');
      q = 'SELECT user_id FROM students WHERE section_id=? AND user_id IS NOT NULL'; args = [sid];
    }
    const t = now(); let n = 0;
    tx(db, () => { db.prepare('INSERT INTO announcements(author_id,scope,scope_id,title,body,created_at) VALUES (?,?,?,?,?,?)').run(u.id, scope, sid, title, body, t);
      const ins = db.prepare('INSERT INTO notifications(user_id,title,body,url,created_at) VALUES (?,?,?,?,?)'); for (const x of db.prepare(q).all(...args)) { ins.run(x.user_id, title, body, '/portal/#/inbox', t); n++; } });
    audit(db, u, 'announce', scope, sid, { recipients: n, title }, ctx.ip); ctx.status = 201; return { recipients: n };
  });
}
