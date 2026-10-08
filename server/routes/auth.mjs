import { v, HttpError, now } from '../lib/util.mjs';
import { hashPassword, verifyPassword, dummyVerify, withAuthSlot, createSession, cookieHeader, clearCookie, destroySession, destroyAllSessions, checkPasswordPolicy, Limiter } from '../lib/auth.mjs';
import { audit } from '../lib/audit.mjs';
import { config } from '../config.mjs';

const ipFails = new Limiter(100, 10 * 60e3);      // failed logins per IP (generous: a campus shares one public IP)
setInterval(() => ipFails.sweep(), 60e3).unref();
const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, dept_id: u.dept_id ?? null, must_change: !!u.must_change });

export default function (r, db) {
  r.post('/api/auth/login', { auth: false }, ctx => withAuthSlot(async () => {
    const ident = v.str(ctx.body.email, 'email', { max: 120 }).toLowerCase(); const pw = v.str(ctx.body.password, 'password', { max: 200 });
    if (!ipFails.peek(ctx.ip)) throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts. Try again later.');
    const u = ident.includes('@')
      ? db.prepare('SELECT * FROM users WHERE email=?').get(ident)
      : db.prepare('SELECT u.* FROM users u JOIN students s ON s.user_id=u.id WHERE s.roll=? COLLATE NOCASE').get(ident);   // students log in with their roll number
    if (!u || !u.active) { await dummyVerify(pw); ipFails.hit(ctx.ip); throw new HttpError(401, 'invalid_credentials', 'Invalid login or password'); }
    if (u.locked_until > now()) throw new HttpError(429, 'locked', 'Account temporarily locked. Try again in a few minutes.');
    if (!(await verifyPassword(pw, u.pw_hash))) {
      const failed = u.failed + 1, lock = failed >= 5;
      db.prepare('UPDATE users SET failed=?, locked_until=? WHERE id=?').run(lock ? 0 : failed, lock ? now() + 15 * 60e3 : 0, u.id);
      audit(db, null, 'auth.fail', 'user', u.id, { locked: lock }, ctx.ip); ipFails.hit(ctx.ip);
      throw new HttpError(401, 'invalid_credentials', 'Invalid login or password');
    }
    db.prepare('UPDATE users SET failed=0, locked_until=0, last_login=? WHERE id=?').run(now(), u.id);
    const token = createSession(db, u.id, ctx.ip, ctx.req.headers['user-agent']);
    ctx.headers['set-cookie'] = cookieHeader(token, config.sessionMaxMs);
    audit(db, u, 'auth.login', 'user', u.id, null, ctx.ip);
    return { user: publicUser(u) };
  }));
  r.post('/api/auth/logout', { allowMustChange: true }, ctx => { destroySession(db, ctx.user.tokenHash); ctx.headers['set-cookie'] = clearCookie(); return { ok: true }; });
  r.get('/api/auth/me', { allowMustChange: true }, ctx => ({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id)) }));
  r.post('/api/auth/change-password', { allowMustChange: true }, ctx => withAuthSlot(async () => {
    const cur = v.str(ctx.body.current, 'current', { max: 200 }), next = ctx.body.new;
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id);
    if (!(await verifyPassword(cur, u.pw_hash))) throw new HttpError(401, 'invalid_credentials', 'Current password is wrong');
    checkPasswordPolicy(next, u.email); if (next === cur) throw new HttpError(400, 'weak_password', 'Choose a different password');
    db.prepare('UPDATE users SET pw_hash=?, must_change=0 WHERE id=?').run(await hashPassword(next), u.id);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?').run(u.id, ctx.user.tokenHash);   // sign out other devices
    audit(db, u, 'auth.password_changed', 'user', u.id, null, ctx.ip);
    return { ok: true };
  }));
}
