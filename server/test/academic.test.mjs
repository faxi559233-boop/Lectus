import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as, Client, PW } from './helpers.mjs';
import { hotp, verifyTotp } from '../lib/totp.mjs';

const app = await boot({ seed: { students: 20 } }); const D = app.demo; test.after(() => app.close());
const step = () => Math.floor(Date.now() / 30000);

test('TOTP matches the RFC 4226 test vector and refuses replays', () => {
  assert.equal(hotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082');
  const secret = 'JBSWY3DPEHPK3PXP', now = Date.now(), c = verifyTotp(secret, hotp(secret, Math.floor(now / 30000)), now); assert.ok(c);
  assert.equal(verifyTotp(secret, hotp(secret, Math.floor(now / 30000)), now, c), null, 'same step cannot be used twice');
  assert.equal(verifyTotp(secret, '12345', now), null);
});

test('two-step login: setup, enable, login needs a code, backup code works once, disable', async () => {
  const a = await as(app, 'admin@demo.local');
  const su = (await a.post('/api/auth/2fa/setup')).json; assert.match(su.secret, /^[A-Z2-7]{32}$/); assert.match(su.uri, /^otpauth:\/\/totp\//);
  assert.equal((await a.post('/api/auth/2fa/enable', { code: '000000' })).status, 400);
  const en = await a.post('/api/auth/2fa/enable', { code: hotp(su.secret, step()) }); assert.equal(en.status, 200); assert.equal(en.json.backup_codes.length, 8);
  assert.equal((await a.get('/api/auth/me')).json.user.totp_on, true);
  const c = new Client(app.base);
  const r1 = await c.login('admin@demo.local'); assert.equal(r1.status, 200); assert.equal(r1.json.need_2fa, true); assert.equal((await c.get('/api/auth/me')).status, 401, 'no session before the code');
  assert.equal((await c.post('/api/auth/login', { email: 'admin@demo.local', password: PW, code: '123456' })).status, 401, 'wrong code');
  assert.equal((await c.post('/api/auth/login', { email: 'admin@demo.local', password: PW, code: hotp(su.secret, step()) })).status, 401, 'the code used at setup cannot be replayed');
  assert.equal((await c.post('/api/auth/login', { email: 'admin@demo.local', password: PW, code: hotp(su.secret, step() + 1) })).status, 200, 'next code works');
  const bc = en.json.backup_codes[0]; const c2 = new Client(app.base);
  assert.equal((await c2.post('/api/auth/login', { email: 'admin@demo.local', password: PW, code: bc })).status, 200, 'backup code');
  assert.equal((await new Client(app.base).post('/api/auth/login', { email: 'admin@demo.local', password: PW, code: bc })).status, 401, 'backup code is single use');
  assert.equal((await c2.post('/api/auth/2fa/disable', { password: PW, code: en.json.backup_codes[1] })).status, 200);
  assert.equal((await new Client(app.base).login('admin@demo.local')).json.user.email, 'admin@demo.local', 'plain login again');
});

test('sessions list and sign out everywhere else', async () => {
  const a = await as(app, 'teacher1@demo.local'), b = await as(app, 'teacher1@demo.local');
  const list = (await a.get('/api/auth/sessions')).json; assert.ok(list.length >= 2); assert.equal(list.filter(x => x.current).length, 1);
  assert.equal((await b.post('/api/auth/sessions/revoke-others')).json.revoked >= 1, true);
  assert.equal((await a.get('/api/auth/me')).status, 401, 'the other session is gone'); assert.equal((await b.get('/api/auth/me')).status, 200);
});

test('timetable clashes: teacher, room and section; scoped to the active term', async () => {
  const a = await as(app, 'admin@demo.local'), hodCs = await as(app, 'hod.cs@demo.local');
  const o0 = D.offerings[0], o1 = D.offerings[2];   // course 0 and course 1, both section A; teacher1 and teacher2
  assert.equal((await a.put('/api/admin/offerings/' + o0, { days: '1,3', start_time: '09:00', duration_min: 90, room: 'R1' })).status, 200);
  assert.equal((await a.put('/api/admin/offerings/' + o1, { days: '3', start_time: '10:00', duration_min: 60, room: 'r1' })).status, 200);   // overlaps o0 by 30 min on day 3
  const clashes = (await a.get('/api/admin/timetable/clashes')).json; const kinds = clashes.filter(c => [c.a.id, c.b.id].includes(o0) && [c.a.id, c.b.id].includes(o1)).map(c => c.kind).sort();
  assert.deepEqual(kinds, ['room', 'section'], 'same room (case-insensitive) and same section, different teachers');
  assert.equal((await a.put('/api/admin/offerings/' + o1, { start_time: '10:30' })).status, 200); assert.equal((await a.get('/api/admin/timetable/clashes')).json.filter(c => [c.a.id, c.b.id].includes(o0) && [c.a.id, c.b.id].includes(o1)).length, 0, 'back to back is fine');   // (the demo seed puts every course at 09:00, so other pairs still clash)
  assert.equal((await hodCs.get('/api/admin/timetable/clashes')).status, 200);
  const stu = (await (await as(app, '21-ECO-001')).get('/api/timetable')).json; assert.ok(stu.length >= 2 && stu.every(x => x.days));
  assert.equal((await (await as(app, 'teacher1@demo.local')).get('/api/timetable')).json.every(x => x.teacher_id), true);
});

test('term rollover moves students, keeps history, and graduates after the last semester', async () => {
  const a = await as(app, 'admin@demo.local');
  const t2 = (await a.post('/api/admin/terms', { name: 'Spring 2027', active: 0 })).json, t3 = (await a.post('/api/admin/terms', { name: 'Fall 2027', active: 0 })).json;
  const before = D.studentIds.filter((_, i) => i % 2 === 0)[0];
  const r = (await a.post('/api/admin/rollover', { from_term_id: D.term, to_term_id: t2.id })).json; assert.deepEqual([r.sections, r.students, r.graduated], [2, 20, 0]);
  const secs = (await a.get('/api/admin/sections')).json.filter(s => s.term_id === t2.id); assert.equal(secs.length, 2); assert.ok(secs.every(s => s.semester_no === 6));
  const stu = (await a.get('/api/admin/students?q=21-ECO-001')).json.items[0]; assert.equal(stu.section_name, 'A');
  const oldRoster = (await (await as(app, 'teacher1@demo.local')).get(`/api/offerings/${D.offerings[0]}/summary`)).json.items; assert.equal(oldRoster.length, 10, 'old term roster is untouched');
  const off = await a.post('/api/admin/offerings', { course_id: D.courses[0], section_id: secs.find(s => s.name === 'A').id, teacher_id: D.teachers[0] }); assert.equal(off.status, 201);
  assert.equal((await a.get('/api/admin/offerings')).json.find(o => o.id === off.json.id).enrolled, 10, 'students are enrolled in new offerings automatically');
  await a.put('/api/admin/settings', {}).catch(() => {}); app.db.prepare("INSERT INTO settings(key,value) VALUES ('max_semester','6')").run();
  const g = (await a.post('/api/admin/rollover', { from_term_id: t2.id, to_term_id: t3.id })).json; assert.equal(g.graduated, 20); assert.equal(g.sections, 0);
  assert.equal((await a.post('/api/admin/rollover', { from_term_id: t2.id, to_term_id: t2.id })).status, 400);
  assert.equal((await (await as(app, 'teacher1@demo.local')).post('/api/admin/rollover', {})).status, 403);
});
