import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, Client, as, PW } from './helpers.mjs';
import { startPushWorker } from '../lib/push.mjs';
import { backupNow, restoreDrill, countRows } from '../lib/backup.mjs';

const app = await boot({ seed: { students: 20 } });
const D = app.demo; test.after(() => app.close());
const OFF = D.offerings[0];            // course 0, section A, teacher1
const stuA = D.studentIds.filter((_, i) => i % 2 === 0), stuB = D.studentIds.filter((_, i) => i % 2 === 1);
const mk = async (c, date, marks, extra = {}) => { const s = (await c.post(`/api/offerings/${OFF}/sessions`, { date, topic: 'T ' + date })).json; const r = await c.put(`/api/sessions/${s.id}/marks`, { op_id: 'op-' + s.id + '-' + Math.random().toString(36).slice(2), marks, ...extra }); return { s, r }; };

test('admin builds structure; duplicates and in-use deletes are refused', async () => {
  const a = await as(app, 'admin@demo.local');
  assert.equal((await a.post('/api/admin/departments', { code: 'ECO', name: 'Dup' })).status, 409);
  const d = await a.post('/api/admin/departments', { code: 'MATH', name: 'Mathematics' }); assert.equal(d.status, 201);
  assert.equal((await a.del('/api/admin/departments/' + D.dept)).status, 409, 'department with programs cannot be deleted');
  assert.equal((await a.del('/api/admin/departments/' + d.json.id)).status, 200);
  assert.equal((await a.post('/api/admin/courses', { dept_id: 999, code: 'ZZ1', name: 'Bad ref' })).status, 409);
  assert.equal((await a.post('/api/admin/offerings', { course_id: D.courses[0], section_id: D.secs[0], days: '9' })).status, 400);
  assert.equal((await a.get('/api/admin/offerings')).json.length, 12);
});
test('role boundaries: students/teachers cannot use admin routes; HOD cannot write structure', async () => {
  const s = await as(app, '21-ECO-001'), t = await as(app, 'teacher1@demo.local'), h = await as(app, 'hod@demo.local');
  for (const [c, p] of [[s, '/api/admin/users'], [t, '/api/admin/users'], [t, '/api/admin/audit'], [s, '/api/my/offerings'], [s, '/api/department/overview'], [t, '/api/department/overview']]) assert.equal((await c.get(p)).status, 403, p);
  assert.equal((await h.post('/api/admin/departments', { code: 'HX', name: 'HOD attempt' })).status, 403);
  assert.equal((await h.get('/api/admin/offerings')).status, 200, 'HOD may read structure');
});
test('teacher marks attendance; roster only contains enrolled students; replay is idempotent', async () => {
  const t = await as(app, 'teacher1@demo.local');
  const s = (await t.post(`/api/offerings/${OFF}/sessions`, { date: '2026-09-01', topic: 'Intro' })).json;
  const roster = (await t.get('/api/sessions/' + s.id)).json.roster; assert.equal(roster.length, 10); assert.ok(roster.every(r => r.status === null));
  const marks = stuA.map((id, i) => ({ student_id: id, status: i < 2 ? 'A' : 'P' }));
  const r1 = await t.put(`/api/sessions/${s.id}/marks`, { op_id: 'op-replay-0001', marks }); assert.deepEqual([r1.status, r1.json.saved, r1.json.changed], [200, 10, 0]);
  const r2 = await t.put(`/api/sessions/${s.id}/marks`, { op_id: 'op-replay-0001', marks: marks.map(m => ({ ...m, status: 'A' })) }); assert.equal(r2.json.replayed, true); assert.equal(r2.json.saved, 10);
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM attendance WHERE session_id=? AND status=?').get(s.id, 'A').c, 2, 'replay must not alter data');
  const fix = await t.put(`/api/sessions/${s.id}/marks`, { op_id: 'op-fix-00001', marks: [{ student_id: stuA[0], status: 'P' }] }); assert.deepEqual([fix.json.saved, fix.json.changed], [0, 1]);
  const log = app.db.prepare("SELECT detail FROM audit_log WHERE action='attendance.change' ORDER BY id DESC LIMIT 1").get(); assert.deepEqual(JSON.parse(log.detail), { from: 'A', to: 'P' });
  const bad = await t.put(`/api/sessions/${s.id}/marks`, { marks: [{ student_id: stuB[0], status: 'P' }] }); assert.equal(bad.status, 400); assert.equal(bad.json.error.code, 'not_enrolled');
  assert.equal((await t.put(`/api/sessions/${s.id}/marks`, { marks: [{ student_id: stuA[0], status: 'Z' }] })).status, 400);
  assert.equal((await t.post(`/api/offerings/${OFF}/sessions`, { date: '2999-01-01' })).status, 400, 'future date refused');
});
test('ownership: other teachers, other-department HODs and students cannot touch this course', async () => {
  const t2 = await as(app, 'teacher2@demo.local'), h2 = await as(app, 'hod.cs@demo.local'), h = await as(app, 'hod@demo.local'), s = await as(app, '21-ECO-003');
  const sid = app.db.prepare('SELECT id FROM lecture_sessions WHERE offering_id=?').get(OFF).id;
  assert.equal((await t2.get('/api/sessions/' + sid)).status, 403); assert.equal((await t2.put(`/api/sessions/${sid}/marks`, { marks: [{ student_id: stuA[0], status: 'P' }] })).status, 403);
  assert.equal((await t2.post(`/api/offerings/${OFF}/sessions`, { date: '2026-09-02' })).status, 403); assert.equal((await t2.get(`/api/offerings/${OFF}/summary`)).status, 403);
  assert.equal((await h2.get('/api/sessions/' + sid)).status, 403); assert.equal((await h.get('/api/sessions/' + sid)).status, 200);
  assert.equal((await h.put(`/api/sessions/${sid}/marks`, { marks: [{ student_id: stuA[0], status: 'P' }] })).status, 403, 'HOD can read but not mark');
  assert.equal((await s.get('/api/sessions/' + sid)).status, 403); assert.equal((await t2.del('/api/sessions/' + sid)).status, 403);
});
test('student sees only own numbers: pct, outlook and status are computed correctly', async () => {
  const t = await as(app, 'teacher1@demo.local'); const me = stuA[1];                    // roll 21-ECO-003
  await mk(t, '2026-09-03', stuA.map(id => ({ student_id: id, status: id === me ? 'A' : 'P' })));
  await mk(t, '2026-09-04', stuA.map(id => ({ student_id: id, status: id === me ? 'A' : 'P' })));
  // me: sessions = A(fixed? first session was A, kept A), A, A  → set exact: first session mark A, then A, A → verify via API
  const s = await as(app, '21-ECO-003'); const r = (await s.get('/api/my/attendance')).json; const o = r.offerings.find(x => x.offering_id === OFF);
  assert.equal(r.student.roll, '21-ECO-003'); assert.equal(o.total, 3); assert.equal(o.A, 3); assert.equal(o.pct, 0); assert.equal(o.status, 'bad'); assert.equal(o.outlook.need, 9, '(75*3-0)/25 = 9');
  const other = (await (await as(app, '21-ECO-005')).get('/api/my/attendance')).json; assert.equal(other.student.roll, '21-ECO-005'); assert.ok(!JSON.stringify(other).includes('21-ECO-003'));
  assert.ok(r.recent.length >= 3);
});
test('settings change how leave counts', async () => {
  const t = await as(app, 'teacher1@demo.local'), a = await as(app, 'admin@demo.local'), id = stuA[4];
  const { s } = await mk(t, '2026-09-05', stuA.map(x => ({ student_id: x, status: x === id ? 'L' : 'P' })));
  const roll = app.db.prepare('SELECT roll FROM students WHERE id=?').get(id).roll; const st = await as(app, roll);
  const pct = async () => (await st.get('/api/my/attendance')).json.offerings.find(o => o.offering_id === OFF).pct;
  const withLeave = await pct(); assert.equal((await a.put('/api/admin/settings', { leave_counts: 0 })).status, 200); const without = await pct(); assert.ok(without < withLeave, `${without} < ${withLeave}`);
  await a.put('/api/admin/settings', { leave_counts: 1 }); assert.equal((await a.put('/api/admin/settings', { min_pct: 500 })).status, 400);
});
test('code check-in: valid, repeat, wrong, not-enrolled, closed, rate limit', async () => {
  const t = await as(app, 'teacher1@demo.local'); const s = (await t.post(`/api/offerings/${OFF}/sessions`, { date: '2026-09-06' })).json;
  assert.equal((await t.get(`/api/sessions/${s.id}/checkin`)).json.open, false);
  assert.equal((await t.post(`/api/sessions/${s.id}/checkin/open`, { minutes: 5 })).status, 200);
  const { code, expires_in_ms } = (await t.get(`/api/sessions/${s.id}/checkin`)).json; assert.match(code, /^\d{6}$/); assert.ok(expires_in_ms > 0 && expires_in_ms <= 30000);
  const a1 = await as(app, '21-ECO-001'), b1 = await as(app, '21-ECO-002');
  const ok = await a1.post('/api/checkin', { code }); assert.equal(ok.status, 200); assert.equal(ok.json.status, 'P');
  assert.equal((await a1.post('/api/checkin', { code })).json.already, true);
  assert.equal((await b1.post('/api/checkin', { code })).json.error.code, 'invalid_code', 'section-B student is not enrolled');
  const a2 = await as(app, '21-ECO-005'); assert.equal((await a2.post('/api/checkin', { code: code === '000000' ? '111111' : '000000' })).status, 400);
  assert.equal((await t.get(`/api/sessions/${s.id}/checkin`)).json.checked_in, 1);
  await t.post(`/api/sessions/${s.id}/checkin/close`); assert.equal((await a2.post('/api/checkin', { code })).status, 400, 'closed window');
  const flood = await as(app, '21-ECO-007'); let last; for (let i = 0; i < 12; i++) last = await flood.post('/api/checkin', { code: '123456' }); assert.equal(last.status, 429);
  assert.equal((await a1.post('/api/checkin', { code: 'abcdef' })).status, 400);
});
test('geofenced check-in requires being near the classroom', async () => {
  const t = await as(app, 'teacher1@demo.local'); const s = (await t.post(`/api/offerings/${OFF}/sessions`, { date: '2026-09-07' })).json;
  await t.post(`/api/sessions/${s.id}/checkin/open`, { minutes: 5, lat: 32.0836, lon: 72.6711, radius: 100 }); const code = (await t.get(`/api/sessions/${s.id}/checkin`)).json.code;
  const c = await as(app, '21-ECO-009');
  assert.equal((await c.post('/api/checkin', { code })).json.error.code, 'location_required');
  assert.equal((await c.post('/api/checkin', { code, lat: 31.5, lon: 74.3 })).json.error.code, 'too_far');
  assert.equal((await c.post('/api/checkin', { code, lat: 32.0837, lon: 72.6712 })).status, 200);
});
test('HOD dashboard shows department shortage; other department sees nothing; CSV export works', async () => {
  const h = await as(app, 'hod@demo.local'), h2 = await as(app, 'hod.cs@demo.local'), a = await as(app, 'admin@demo.local');
  const ov = (await h.get('/api/department/overview')).json; assert.equal(ov.department.code, 'ECO'); assert.equal(ov.items.length, 12); assert.ok(ov.shortage >= 1); assert.ok(ov.rate > 0 && ov.rate < 100);
  const sh = (await h.get('/api/department/shortage')).json.items; assert.ok(sh.some(x => x.roll === '21-ECO-003' && x.pct === 25 && x.outlook.need === 8));
  assert.equal((await h2.get('/api/department/overview')).json.items.length, 0); assert.equal((await h2.get('/api/department/shortage')).json.items.length, 0);
  assert.equal((await a.get('/api/department/overview')).status, 400, 'admin must name a department'); assert.equal((await a.get('/api/department/overview?dept_id=' + D.dept)).status, 200);
  const csv = await h.req('GET', '/api/department/shortage.csv', undefined, { raw: true }); assert.match(csv.headers.get('content-type'), /text\/csv/); const buf = Buffer.from(await csv.arrayBuffer()); assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM so Excel shows Urdu names'); assert.ok(buf.toString('utf8').includes('21-ECO-003'));
});
test('bulk import creates students, enrols them, and logins are generated per section', async () => {
  const a = await as(app, 'admin@demo.local');
  const rows = [{ roll: '22-ECO-101', name: 'Imported One', phone: '0300-1112223' }, { roll: '22-ECO-102', name: 'Imported Two' }, { roll: 'x', name: 'Bad' }, { roll: '21-ECO-001', name: 'Student 1 (renamed)' }];
  const r = (await a.post('/api/admin/import/students', { section_id: D.secs[0], rows })).json; assert.equal(r.created, 2); assert.equal(r.updated, 1); assert.equal(r.errors.length, 1); assert.equal(r.errors[0].row, 3);
  const id = app.db.prepare("SELECT id FROM students WHERE roll='22-ECO-101'").get().id; assert.equal(app.db.prepare('SELECT COUNT(*) c FROM enrollments WHERE student_id=?').get(id).c, 6, 'enrolled in all 6 section offerings');
  const lg = (await a.post(`/api/admin/sections/${D.secs[0]}/create-logins`)).json; assert.equal(lg.created, 2); const cred = lg.credentials.find(c => c.roll === '22-ECO-101');
  const c = new Client(app.base); const login = await c.login('22-ECO-101', cred.password); assert.equal(login.status, 200); assert.equal(login.json.user.must_change, true);
  assert.equal((await c.get('/api/my/attendance')).status, 403, 'must change password first');
  assert.equal((await a.post(`/api/admin/sections/${D.secs[0]}/create-logins`)).json.created, 0, 'idempotent');
});
test('moving a student to another section re-enrols them', async () => {
  const a = await as(app, 'admin@demo.local'); const id = stuA[9];
  assert.equal((await a.put('/api/admin/students/' + id, { section_id: D.secs[1] })).status, 200);
  const offs = app.db.prepare('SELECT o.section_id FROM enrollments e JOIN offerings o ON o.id=e.offering_id WHERE e.student_id=?').all(id); assert.equal(offs.length, 6); assert.ok(offs.every(o => o.section_id === D.secs[1]));
});
test('reminders, announcements and scoping', async () => {
  const t = await as(app, 'teacher1@demo.local'), h = await as(app, 'hod@demo.local'), a = await as(app, 'admin@demo.local');
  const rem = (await t.post(`/api/offerings/${OFF}/remind`)).json; assert.ok(rem.shortage >= 1); assert.ok(rem.sent >= 1);
  const s = await as(app, '21-ECO-003'); const n = (await s.get('/api/notifications')).json; assert.ok(n.unread >= 1); assert.match(n.items[0].title, /Attendance warning/);
  await s.post('/api/notifications/read', { all: true }); assert.equal((await s.get('/api/notifications')).json.unread, 0);
  assert.equal((await t.post('/api/announcements', { scope: 'all', title: 'Hello', body: 'Everyone' })).status, 403);
  assert.equal((await t.post('/api/announcements', { scope: 'section', scope_id: D.secs[0], title: 'Quiz', body: 'Tomorrow' })).status, 201);
  assert.equal((await h.post('/api/announcements', { scope: 'dept', scope_id: D.dept2, title: 'Notice', body: 'Not my dept' })).status, 403);
  assert.ok((await a.post('/api/announcements', { scope: 'all', title: 'Holiday', body: 'Campus closed' })).json.recipients >= 20);
  const other = await as(app, '21-ECO-004'); assert.ok(!(await other.get('/api/notifications')).json.items.some(i => /Attendance warning/.test(i.title)), 'no warning for students who are fine');
});
test('push: subscribe validation, delivery, dead endpoints removed, throttling backs off', async () => {
  const s = await as(app, '21-ECO-005'), uid = app.db.prepare("SELECT user_id FROM students WHERE roll='21-ECO-005'").get().user_id;
  assert.equal((await s.post('/api/push/subscribe', { endpoint: 'http://insecure.example/x', keys: { p256dh: 'a', auth: 'b' } })).status, 400);
  assert.equal((await s.post('/api/push/subscribe', { endpoint: 'https://push.example/good', keys: { p256dh: 'k1', auth: 'a1' } })).status, 200);
  assert.equal((await s.post('/api/push/subscribe', { endpoint: 'https://push.example/dead', keys: { p256dh: 'k2', auth: 'a2' } })).status, 200);
  const ins = () => app.db.prepare("INSERT INTO notifications(user_id,title,body,created_at) VALUES (?,?,?,?)").run(uid, 'T', 'B', Date.now());
  const sent = []; const w = startPushWorker(app.db, async sub => { if (sub.endpoint.endsWith('/dead')) { const e = new Error('gone'); e.statusCode = 410; throw e; } sent.push(sub.endpoint); });
  clearInterval(w.timer); app.db.prepare('UPDATE notifications SET pushed_at=? WHERE pushed_at IS NULL').run(1); ins(); await w.tick();
  assert.deepEqual(sent, ['https://push.example/good']); assert.equal(app.db.prepare('SELECT COUNT(*) c FROM push_subs WHERE user_id=?').get(uid).c, 1, '410 endpoint deleted'); assert.equal(app.db.prepare('SELECT COUNT(*) c FROM notifications WHERE pushed_at IS NULL').get().c, 0);
  const w2 = startPushWorker(app.db, async () => { const e = new Error('slow down'); e.statusCode = 429; throw e; }); clearInterval(w2.timer); ins(); await w2.tick();
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM notifications WHERE pushed_at IS NULL').get().c, 1, 'throttled message stays queued'); await w2.tick();
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM notifications WHERE pushed_at IS NULL').get().c, 1, 'worker paused after throttling');
});
test('stats table always equals a fresh recount (insert, change, check-in, session delete)', async () => {
  const t = await as(app, 'teacher1@demo.local'); const same = () => {
    const re = app.db.prepare("SELECT s.offering_id, a.student_id, SUM(a.status='P') P, SUM(a.status='A') A, SUM(a.status='L') L, SUM(a.status='T') T, COUNT(*) total FROM attendance a JOIN lecture_sessions s ON s.id=a.session_id GROUP BY 1,2 ORDER BY 1,2").all().map(r => ({ ...r }));
    const st = app.db.prepare('SELECT offering_id, student_id, P, A, L, T, total FROM stats WHERE total>0 ORDER BY 1,2').all().map(r => ({ ...r })); assert.deepEqual(st, re); return re.length; };
  const before = same(); assert.ok(before > 0);
  const { s } = await mk(t, '2026-09-20', stuA.map((id, i) => ({ student_id: id, status: ['P', 'A', 'L', 'T'][i % 4] }))); same();
  await t.put(`/api/sessions/${s.id}/marks`, { op_id: 'op-stats-chg-1', marks: stuA.map(id => ({ student_id: id, status: 'T' })) }); same();
  const sid = app.db.prepare('SELECT id FROM lecture_sessions WHERE offering_id=? ORDER BY id DESC LIMIT 1').get(OFF).id; assert.equal((await t.del('/api/sessions/' + s.id)).status, 200); same();
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM attendance WHERE session_id=?').get(s.id).c, 0);
  const gone = stuA[3]; app.db.prepare('DELETE FROM students WHERE id=?').run(gone); same();
});
test('audit log records sensitive actions and is admin-only', async () => {
  const a = await as(app, 'admin@demo.local'); await a.post('/api/admin/users', { email: 'audit.probe@demo.local', name: 'Audit Probe', role: 'teacher' }); const log = (await a.get('/api/admin/audit?limit=500')).json; const actions = new Set(log.map(l => l.action));
  for (const x of ['auth.login', 'attendance.mark', 'attendance.change', 'checkin.open', 'students.import', 'users.create']) assert.ok(actions.has(x), x);
  assert.ok(!JSON.stringify(log).includes('scrypt$'), 'no password hashes in the log');
});
test('static files: only the public allow-list is served', async () => {
  const c = new Client(app.base);
  for (const p of ['/', '/index.html', '/app.js', '/styles.css', '/icons/logo.jpg', '/manifest.webmanifest']) assert.equal((await c.get(p)).status, 200, p);
  for (const p of ['/server/config.mjs', '/server/data/gmc.db', '/docs/ERP-PLAN.md', '/bench/seed.mjs', '/.git/config', '/%2e%2e/etc/passwd', '/..%2fserver%2fconfig.mjs', '/README.md', '/tests/e2e.js', '/deploy/install.sh']) assert.equal((await c.get(p)).status, 404, p);
  const gz = await c.get('/app.js', { headers: { 'accept-encoding': 'gzip' } }); assert.equal(gz.headers.get('content-encoding'), 'gzip');
});
test('backup is consistent, verified, and the restore drill passes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gmc-bk-')); const r = backupNow(app.db, dir, 14);
  assert.equal(r.integrity, 'ok'); assert.equal(r.students, app.db.prepare('SELECT COUNT(*) c FROM students').get().c); assert.equal(r.attendance, app.db.prepare('SELECT COUNT(*) c FROM attendance').get().c);
  const d = restoreDrill(app.db, dir); assert.equal(d.ok, true); assert.deepEqual(d.backup, countRows(d.file));
});
