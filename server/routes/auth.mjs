import { v, HttpError, now } from '../lib/util.mjs';
import { hashPassword, verifyPassword, dummyVerify, withAuthSlot, createSession, cookieHeader, clearCookie, destroySession, destroyAllSessions, checkPasswordPolicy, Limiter } from '../lib/auth.mjs';
import { audit } from '../lib/audit.mjs';
import { config } from '../config.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { newSecret, verifyTotp, otpauthUri } from '../lib/totp.mjs';
const sha = x => createHash('sha256').update(x).digest('hex');

const ipFails = new Limiter(100, 10 * 60e3);      // failed logins per IP (generous: a campus shares one public IP)
setInterval(() => ipFails.sweep(), 60e3).unref();
const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, dept_id: u.dept_id ?? null, perms: u.perms || 'all', totp_on: !!u.totp_on, must_change: !!u.must_change });

/** Accepts the current authenticator code (once per 30 s step) or a one-time backup code. */
function useSecondFactor(db, u, code) {
  const step = verifyTotp(u.totp_secret, code, Date.now(), u.totp_last);
  if (step) { db.prepare('UPDATE users SET totp_last=? WHERE id=?').run(step, u.id); return true; }
  const codes = JSON.parse(u.backup_codes || '[]'), h = sha(code.toUpperCase().replace(/[\s-]/g, '')), i = codes.indexOf(h);
  if (i >= 0) { codes.splice(i, 1); db.prepare('UPDATE users SET backup_codes=? WHERE id=?').run(JSON.stringify(codes), u.id); return true; }
  return false;
}

export default function (r, db) {
  r.post('/api/auth/login', { auth: false }, ctx => withAuthSlot(async () => {
    const ident = v.str(ctx.body.email, 'email', { max: 120 }).toLowerCase(); const pw = v.str(ctx.body.password, 'password', { max: 200 });
    if (!ipFails.peek(ctx.ip)) throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts. Try again later.');
    const u = ident.includes('@')
      ? db.prepare('SELECT * FROM users WHERE email=?').get(ident)
      : db.prepare('SELECT u.* FROM users u JOIN students s ON s.user_id=u.id WHERE s.roll=? COLLATE NOCASE').get(ident);   // students log in with their roll number
    if (!u || !u.active) { await dummyVerify(pw); ipFails.hit(ctx.ip); throw new HttpError(401, 'invalid_credentials', 'Invalid login or password'); }
    if (u.locked_until > now()) throw new HttpError(429, 'locked', 'Account temporarily locked. Try again in a few minutes.');
    const failLogin = (why) => {
      const failed = u.failed + 1, lock = failed >= 5;
      db.prepare('UPDATE users SET failed=?, locked_until=? WHERE id=?').run(lock ? 0 : failed, lock ? now() + 15 * 60e3 : 0, u.id);
      audit(db, null, 'auth.fail', 'user', u.id, { locked: lock, why }, ctx.ip); ipFails.hit(ctx.ip);
      throw new HttpError(401, 'invalid_credentials', 'Invalid login or password');
    };
    if (!(await verifyPassword(pw, u.pw_hash))) failLogin('password');
    if (u.totp_on) {
      const code = ctx.body.code == null ? '' : String(ctx.body.code).trim();
      if (!code) return { need_2fa: true };                                   // password was right: ask for the authenticator code (no session yet)
      if (!useSecondFactor(db, u, code)) failLogin('2fa');
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
  /* ----- two-step login (authenticator app) and sessions ----- */
  r.post('/api/auth/2fa/setup', {}, ctx => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id); if (u.totp_on) throw new HttpError(400, 'already_on', 'Two-step login is already on');
    const secret = newSecret(); db.prepare('UPDATE users SET totp_secret=?, totp_last=0 WHERE id=?').run(secret, u.id);
    return { secret, uri: otpauthUri(secret, u.email) };
  });
  r.post('/api/auth/2fa/enable', {}, ctx => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id); if (!u.totp_secret || u.totp_on) throw new HttpError(400, 'not_ready', 'Start the setup first');
    const step = verifyTotp(u.totp_secret, String(ctx.body.code ?? '').trim()); if (!step) throw new HttpError(400, 'invalid_code', 'That code is wrong. Check the time on your phone.');
    const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex').toUpperCase());
    db.prepare('UPDATE users SET totp_on=1, totp_last=?, backup_codes=? WHERE id=?').run(step, JSON.stringify(codes.map(sha)), u.id);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?').run(u.id, ctx.user.tokenHash); audit(db, u, 'auth.2fa_on', 'user', u.id, null, ctx.ip);
    return { backup_codes: codes };
  });
  r.post('/api/auth/2fa/disable', {}, ctx => withAuthSlot(async () => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id); if (!u.totp_on) throw new HttpError(400, 'not_on', 'Two-step login is not on');
    if (!(await verifyPassword(String(ctx.body.password ?? ''), u.pw_hash)) || !useSecondFactor(db, u, String(ctx.body.code ?? '').trim())) throw new HttpError(401, 'invalid_credentials', 'Password or code is wrong');
    db.prepare('UPDATE users SET totp_on=0, totp_secret=NULL, backup_codes=NULL WHERE id=?').run(u.id); audit(db, u, 'auth.2fa_off', 'user', u.id, null, ctx.ip); return { ok: true };
  }));
  r.get('/api/auth/sessions', {}, ctx => db.prepare('SELECT token_hash,created_at,last_seen,ip,ua FROM auth_sessions WHERE user_id=? ORDER BY last_seen DESC').all(ctx.user.id).map(x => ({ id: x.token_hash.slice(0, 12), current: x.token_hash === ctx.user.tokenHash, created_at: x.created_at, last_seen: x.last_seen, ip: x.ip, ua: x.ua })));
  r.post('/api/auth/sessions/revoke-others', {}, ctx => { const n = db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?').run(ctx.user.id, ctx.user.tokenHash).changes; audit(db, ctx.user, 'auth.revoke_others', 'user', ctx.user.id, { n }, ctx.ip); return { revoked: Number(n) }; });
}
