import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, Client, as, PW } from './helpers.mjs';

const app = await boot();
test.after(() => app.close());

test('health is public and minimal', async () => {
  const r = await new Client(app.base).get('/api/health'); assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.json).sort(), ['ok', 'version']);
});
test('security headers are present on API and static responses', async () => {
  for (const p of ['/api/health', '/index.html']) { const r = await new Client(app.base).get(p); const h = r.headers; assert.equal(h.get('x-content-type-options'), 'nosniff'); assert.match(h.get('content-security-policy'), /default-src 'self'/); assert.equal(h.get('x-frame-options'), 'DENY'); }
});
test('unauthenticated requests get 401', async () => {
  const c = new Client(app.base); for (const p of ['/api/auth/me', '/api/admin/users', '/api/my/attendance', '/api/my/offerings']) assert.equal((await c.get(p)).status, 401, p);
});
test('login succeeds, sets HttpOnly SameSite=Strict cookie, wrong password fails with the same message as unknown user', async () => {
  const c = new Client(app.base); const ok = await c.req('POST', '/api/auth/login', { email: 'admin@demo.local', password: PW }, { raw: true });
  assert.equal(ok.status, 200); const sc = ok.headers.getSetCookie()[0]; assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  const a = await new Client(app.base).login('admin@demo.local', 'wrong-password-1'); const b = await new Client(app.base).login('nobody@demo.local', 'wrong-password-1');
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.json.error.message, b.json.error.message);
});
test('students can log in with their roll number', async () => {
  const c = new Client(app.base); const r = await c.login('21-ECO-001'); assert.equal(r.status, 200); assert.equal(r.json.user.role, 'student');
});
test('CSRF: writes without X-GMC header or non-JSON bodies are rejected', async () => {
  const c = await as(app, 'admin@demo.local');
  assert.equal((await c.post('/api/admin/departments', { code: 'X1', name: 'Test' }, { csrf: false })).status, 403);
  assert.equal((await c.post('/api/admin/departments', 'code=X1', { ctype: 'text/plain' })).status, 415);
});
test('oversized body gets 413', async () => {
  const c = await as(app, 'admin@demo.local'); const big = JSON.stringify({ code: 'BIG', name: 'x'.repeat(1_100_000) });
  assert.equal((await c.post('/api/admin/departments', big)).status, 413);
});
test('account locks after 5 wrong passwords, even for the right password', async () => {
  const id = 'teacher3@demo.local'; const c = new Client(app.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.login(id, 'wrong-password-' + i)).status, 401);
  const r = await c.login(id, PW); assert.equal(r.status, 429); assert.equal(r.json.error.code, 'locked');
});
test('forced password change blocks everything else until done; policy enforced; old sessions die', async () => {
  const admin = await as(app, 'admin@demo.local');
  const created = (await admin.post('/api/admin/users', { email: 'new.teacher@demo.local', name: 'New Teacher', role: 'teacher', dept_id: app.demo.dept })).json;
  assert.ok(created.password.length >= 12);
  const t = new Client(app.base), t2 = new Client(app.base); await t.login('new.teacher@demo.local', created.password); await t2.login('new.teacher@demo.local', created.password);
  assert.equal((await t.get('/api/my/offerings')).status, 403); assert.equal((await t.get('/api/my/offerings')).json.error.code, 'must_change_password');
  assert.equal((await t.get('/api/auth/me')).status, 200);
  assert.equal((await t.post('/api/auth/change-password', { current: created.password, new: 'short' })).status, 400);
  assert.equal((await t.post('/api/auth/change-password', { current: created.password, new: 'password1' })).status, 400);
  assert.equal((await t.post('/api/auth/change-password', { current: 'bad-current-pass', new: 'Brand-new-pass-77' })).status, 401);
  assert.equal((await t.post('/api/auth/change-password', { current: created.password, new: 'Brand-new-pass-77' })).status, 200);
  assert.equal((await t.get('/api/my/offerings')).status, 200);
  assert.equal((await t2.get('/api/auth/me')).status, 401, 'other device is signed out');
});
test('generated passwords use the fast hash, chosen passwords the strong one; busy server sheds load with 503', async () => {
  const admin = await as(app, 'admin@demo.local');
  const made = (await admin.post('/api/admin/users', { email: 'hash.probe@demo.local', name: 'Hash Probe', role: 'teacher' })).json;
  const hashOf = () => app.db.prepare("SELECT pw_hash FROM users WHERE email='hash.probe@demo.local'").get().pw_hash;
  assert.match(hashOf(), /^scrypt\$1024\$/, 'system-generated: fast');
  const c = new Client(app.base); await c.login('hash.probe@demo.local', made.password);
  assert.equal((await c.post('/api/auth/change-password', { current: made.password, new: 'Chosen-by-human-42' })).status, 200);
  assert.match(hashOf(), /^scrypt\$2048\$/, 'user-chosen: strong');
  assert.equal((await new Client(app.base).login('hash.probe@demo.local', 'Chosen-by-human-42')).status, 200, 'old fast hash upgraded and still verifies');
  const { withAuthSlot, pendingAuthCount } = await import('../lib/auth.mjs'); const { config } = await import('../config.mjs');
  const saved = config.maxPendingAuth; config.maxPendingAuth = 2; const slow = () => withAuthSlot(() => new Promise(r => setTimeout(r, 50)));
  const res = await Promise.allSettled([slow(), slow(), slow()]); config.maxPendingAuth = saved;
  assert.equal(res.filter(x => x.status === 'rejected').length, 1); assert.equal(res.find(x => x.status === 'rejected').reason.status, 503); assert.equal(pendingAuthCount(), 0);
});
test('logout invalidates the session; deactivated users are cut off immediately', async () => {
  const c = await as(app, 'teacher2@demo.local'); assert.equal((await c.get('/api/auth/me')).status, 200);
  const saved = c.cookie; await c.post('/api/auth/logout'); const c2 = new Client(app.base); c2.cookie = saved; assert.equal((await c2.get('/api/auth/me')).status, 401);
  const s = await as(app, '21-ECO-002'); const admin = await as(app, 'admin@demo.local');
  const sid = app.db.prepare("SELECT u.id FROM users u JOIN students s ON s.user_id=u.id WHERE s.roll='21-ECO-002'").get().id;
  assert.equal((await admin.put('/api/admin/users/' + sid, { active: false })).status, 200); assert.equal((await s.get('/api/my/attendance')).status, 401);
});
test('admin cannot lock themselves out', async () => {
  const admin = await as(app, 'admin@demo.local'); assert.equal((await admin.put('/api/admin/users/' + app.demo.admin, { active: false })).status, 400); assert.equal((await admin.put('/api/admin/users/' + app.demo.admin, { role: 'teacher' })).status, 400);
});
test('stored password hashes and session tokens are not recoverable', async () => {
  const c = await as(app, 'admin@demo.local'); const tok = c.cookie.split('=')[1];
  const row = app.db.prepare('SELECT token_hash FROM auth_sessions').all(); assert.ok(row.length > 0); assert.ok(!row.some(r => r.token_hash === tok), 'raw token must not be stored');
  assert.match(app.db.prepare('SELECT pw_hash FROM users WHERE email=?').get('admin@demo.local').pw_hash, /^scrypt\$/);
});
