import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as, Client } from './helpers.mjs';

const app = await boot({ seed: { students: 20 } }); const D = app.demo; test.after(() => app.close());
const OFF = D.offerings[0]; const iso = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

test('calendar: only admin edits; creating a lecture on a holiday asks first', async () => {
  const a = await as(app, 'admin@demo.local'), t = await as(app, 'teacher1@demo.local'), s = await as(app, '21-ECO-001');
  assert.equal((await t.post('/api/admin/calendar', { date: iso(0), title: 'x', kind: 'holiday' })).status, 403);
  assert.equal((await a.post('/api/admin/calendar', { date: iso(1), end_date: iso(0), title: 'Backwards', kind: 'event' })).status, 400);
  const ev = await a.post('/api/admin/calendar', { date: iso(0), title: 'Founders day', kind: 'holiday' }); assert.equal(ev.status, 201);
  assert.ok((await s.get('/api/calendar')).json.some(e => e.title === 'Founders day'), 'students can read the calendar');
  const blocked = await t.post(`/api/offerings/${OFF}/sessions`, { date: iso(0) }); assert.equal(blocked.status, 409); assert.equal(blocked.json.error.code, 'holiday');
  assert.equal((await t.post(`/api/offerings/${OFF}/sessions`, { date: iso(0), force: true })).status, 201);
  assert.equal((await a.del('/api/admin/calendar/' + ev.json.id)).status, 200);
});

test('attendance correction: student asks, teacher approves, stats follow', async () => {
  const t = await as(app, 'teacher1@demo.local'), s = await as(app, '21-ECO-003'), other = await as(app, '21-ECO-005'), t2 = await as(app, 'teacher2@demo.local');
  const ses = (await t.post(`/api/offerings/${OFF}/sessions`, { date: iso(-1) })).json; const roster = (await t.get(`/api/sessions/${ses.id}`)).json.roster;
  await t.put(`/api/sessions/${ses.id}/marks`, { marks: roster.map(x => ({ student_id: x.id, status: x.roll === '21-ECO-003' ? 'A' : 'P' })) });
  assert.equal((await other.post('/api/corrections', { session_id: ses.id, status: 'P', note: 'I was there' })).status, 400, 'only for lectures where you are absent');
  const c = await s.post('/api/corrections', { session_id: ses.id, status: 'P', note: 'I was in the front row' }); assert.equal(c.status, 201);
  assert.equal((await s.post('/api/corrections', { session_id: ses.id, status: 'P', note: 'again please' })).status, 409);
  assert.equal((await t2.post(`/api/corrections/${c.json.id}/decide`, { decision: 'approved' })).status, 403, 'another teacher');
  assert.equal((await t.get('/api/corrections')).json.length, 1); assert.equal((await t2.get('/api/corrections')).json.length, 0);
  assert.equal((await t.post(`/api/corrections/${c.json.id}/decide`, { decision: 'rejected' })).status, 400, 'reason needed');
  const before = (await s.get('/api/my/attendance')).json.offerings.find(o => o.course_code === 'ECO501').A;
  assert.equal((await t.post(`/api/corrections/${c.json.id}/decide`, { decision: 'approved' })).status, 200);
  assert.equal((await s.get('/api/my/attendance')).json.offerings.find(o => o.course_code === 'ECO501').A, before - 1);
  assert.equal((await s.get('/api/my/corrections')).json[0].status, 'approved');
  const old = (await t.post(`/api/offerings/${OFF}/sessions`, { date: iso(-20) })).json; await t.put(`/api/sessions/${old.id}/marks`, { marks: roster.map(x => ({ student_id: x.id, status: 'A' })) });
  assert.equal((await s.post('/api/corrections', { session_id: old.id, status: 'P', note: 'long ago' })).status, 400, 'older than 7 days');
});

test('certificates: request, issue, public verification, fee clearance rule, access', async () => {
  const s = await as(app, '21-ECO-001'), a = await as(app, 'admin@demo.local'), hod = await as(app, 'hod@demo.local'), cs = await as(app, 'hod.cs@demo.local'), o = await as(app, '21-ECO-003'), anon = new Client(app.base);
  const r1 = (await s.post('/api/certificates', { kind: 'bonafide', purpose: 'Bank account' })).json; assert.equal((await s.post('/api/certificates', { kind: 'nonsense' })).status, 400);
  assert.equal((await cs.post(`/api/certificate-requests/${r1.id}/decide`, { decision: 'issued' })).status, 403, 'other department');
  assert.equal((await hod.get('/api/certificate-requests')).json.length, 1);
  const ok = (await hod.post(`/api/certificate-requests/${r1.id}/decide`, { decision: 'issued' })).json; assert.match(ok.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const cert = (await s.get('/api/certificates/' + r1.id)).json; assert.equal(cert.roll, '21-ECO-001'); assert.equal(cert.kind, 'bonafide'); assert.equal((await o.get('/api/certificates/' + r1.id)).status, 404, 'not another student\'s');
  const ver = (await anon.get('/api/verify/' + ok.code.toLowerCase())).json; assert.equal(ver.valid, true); assert.equal(ver.roll, '21-ECO-001'); assert.equal(Object.keys(ver).includes('guardian'), false, 'public check shows the minimum');
  assert.equal((await anon.get('/api/verify/AAAA-BBBB-CCCC')).json.valid, false);
  // fee clearance needs a zero balance
  const clerk = a; const plan = (await clerk.post('/api/fees/plans', { name: 'Fee Plan', items: [{ head: 'Tuition', amount: 1000 }] })).json; await clerk.post(`/api/fees/plans/${plan.id}/generate`, { section_id: D.secs[0] });
  const r2 = (await s.post('/api/certificates', { kind: 'fee_clearance' })).json; const refused = await hod.post(`/api/certificate-requests/${r2.id}/decide`, { decision: 'issued' }); assert.equal(refused.status, 400); assert.equal(refused.json.error.code, 'fees_due');
  const v = (await clerk.get('/api/fees/vouchers?q=21-ECO-001')).json.items[0]; await clerk.post(`/api/fees/vouchers/${v.id}/payments`, { amount: 1000, method: 'cash' });
  assert.equal((await hod.post(`/api/certificate-requests/${r2.id}/decide`, { decision: 'issued' })).status, 200);
  const r3 = (await s.post('/api/certificates', { kind: 'attendance' })).json; await a.post(`/api/certificate-requests/${r3.id}/decide`, { decision: 'issued' }); const att = (await s.get('/api/certificates/' + r3.id)).json; assert.ok(Array.isArray(att.attendance) && att.attendance.length === 6);
  assert.equal((await s.get('/api/my/certificates')).json.length, 3);
  for (let i = 0; i < 3; i++) await o.post('/api/certificates', { kind: 'character' }); assert.equal((await o.post('/api/certificates', { kind: 'character' })).status, 400, 'at most 3 pending');
});

test('complaints: harassment reaches only the admin; hidden names stay hidden', async () => {
  const s = await as(app, '21-ECO-001'), hod = await as(app, 'hod@demo.local'), a = await as(app, 'admin@demo.local');
  assert.equal((await s.post('/api/complaints', { category: 'academic', body: 'short' })).status, 400);
  await s.post('/api/complaints', { category: 'academic', body: 'The lab is always locked in the morning.', hide_name: true }); await s.post('/api/complaints', { category: 'harassment', body: 'Something serious happened in the corridor.' });
  const h = (await hod.get('/api/complaints')).json; assert.equal(h.length, 1); assert.equal(h[0].roll, null, 'name hidden'); assert.equal(h[0].student_name, null);
  const all = (await a.get('/api/complaints')).json; assert.equal(all.length, 2); assert.equal(all.find(x => x.category === 'harassment').roll, '21-ECO-001');
  assert.equal((await hod.post(`/api/complaints/${all.find(x => x.category === 'harassment').id}/respond`, { status: 'resolved', response: 'Looked into it' })).status, 404, 'HOD cannot touch harassment cases');
  assert.equal((await hod.post(`/api/complaints/${h[0].id}/respond`, { status: 'resolved', response: 'Lab keys now with the guard.' })).status, 200);
  assert.match((await s.get('/api/my/complaints')).json.find(x => x.category === 'academic').response, /guard/);
  for (let i = 0; i < 5; i++) await s.post('/api/complaints', { category: 'other', body: 'Spam spam spam spam spam' }); assert.equal((await s.post('/api/complaints', { category: 'other', body: 'Spam spam spam spam spam' })).status, 429);
});

test('teacher feedback: anonymous, once per course, hidden below 5 answers', async () => {
  const a = await as(app, 'admin@demo.local'), t = await as(app, 'teacher1@demo.local'), hod = await as(app, 'hod@demo.local');
  const sv = await a.post('/api/admin/surveys', { title: 'Mid-term feedback', opens: iso(-1), closes: iso(5) }); assert.equal(sv.status, 201);
  const ratings = n => ({ prepared: n, clear: n, punctual: n, fair: n, respect: n, overall: n });
  const stuA = ['21-ECO-001', '21-ECO-003', '21-ECO-005', '21-ECO-007', '21-ECO-009', '21-ECO-011'];
  const first = await as(app, stuA[0]); const list = (await first.get('/api/my/surveys')).json; assert.equal(list.length, 1); const course = list[0].courses.find(c => c.offering_id === OFF); assert.ok(course && !course.done);
  assert.equal((await first.post(`/api/surveys/${sv.json.id}/respond`, { offering_id: OFF, ratings: { ...ratings(5), fair: 9 } })).status, 400);
  assert.equal((await first.post(`/api/surveys/${sv.json.id}/respond`, { offering_id: OFF, ratings: ratings(4), comment: 'Clear lectures' })).status, 200);
  assert.equal((await first.post(`/api/surveys/${sv.json.id}/respond`, { offering_id: OFF, ratings: ratings(4) })).status, 409, 'once per course');
  assert.equal((await first.get('/api/my/surveys')).json[0].courses.find(c => c.offering_id === OFF).done, true);
  assert.equal((await (await as(app, '21-ECO-002')).post(`/api/surveys/${sv.json.id}/respond`, { offering_id: OFF, ratings: ratings(5) })).status, 403, 'not enrolled (other section)');
  let rep = (await t.get(`/api/surveys/${sv.json.id}/report`)).json; assert.equal(rep.length, 1); assert.equal(rep[0].hidden, true); assert.equal(rep[0].n, 1); assert.equal(rep[0].avg, undefined, 'nothing shown below 5 answers');
  for (const roll of stuA.slice(1, 5)) await (await as(app, roll)).post(`/api/surveys/${sv.json.id}/respond`, { offering_id: OFF, ratings: ratings(5) });
  rep = (await t.get(`/api/surveys/${sv.json.id}/report`)).json; assert.equal(rep[0].hidden, false); assert.equal(rep[0].n, 5); assert.equal(rep[0].avg.overall, 4.8); assert.deepEqual(rep[0].comments, ['Clear lectures']);
  const dump = JSON.stringify(app.db.prepare('SELECT * FROM survey_answers').all()); assert.ok(!/student/i.test(Object.keys(app.db.prepare('SELECT * FROM survey_answers LIMIT 1').get()).join()), 'answers carry no student column');
  assert.equal((await (await as(app, 'teacher2@demo.local')).get(`/api/surveys/${sv.json.id}/report`)).json.length, 0, 'other teachers see nothing of this course');
  assert.equal((await hod.get(`/api/surveys/${sv.json.id}/report`)).json.length, 1);
  assert.equal((await t.post('/api/admin/surveys', {})).status, 403);
});

test('profile, data export and anonymise, at-risk list', async () => {
  const s = await as(app, '21-ECO-001'), a = await as(app, 'admin@demo.local'), t = await as(app, 'teacher1@demo.local'), hod = await as(app, 'hod@demo.local'), cs = await as(app, 'hod.cs@demo.local');
  assert.equal((await s.put('/api/my/profile', { guardian_name: 'Mr Khan', guardian_phone: '0300-1234567', address: 'Gujrat', email: 'not-an-email' })).status, 400);
  assert.equal((await s.put('/api/my/profile', { guardian_name: 'Mr Khan', guardian_phone: '0300-1234567', address: 'Gujrat' })).status, 200); assert.equal((await s.get('/api/my/profile')).json.guardian_name, 'Mr Khan');
  const stu = (await a.get('/api/admin/students?q=21-ECO-001')).json.items[0]; const ex = (await a.get(`/api/admin/students/${stu.id}/export`)).json; assert.equal(ex.student.guardian_name, 'Mr Khan'); assert.ok(ex.attendance.length > 0 && ex.certificates.length >= 3);
  assert.equal((await t.get(`/api/admin/students/${stu.id}/export`)).status, 403);
  // at-risk: 21-ECO-001 was absent in most lectures earlier in this file (old session all absent)
  const risk = (await hod.get('/api/department/at-risk')).json; assert.ok(risk.length >= 1 && risk[0].score >= risk[risk.length - 1].score); assert.equal((await cs.get('/api/department/at-risk')).json.length, 0);
  assert.equal((await a.post(`/api/admin/students/${stu.id}/anonymize`, { reason: 'x' })).status, 400);
  assert.equal((await a.post(`/api/admin/students/${stu.id}/anonymize`, { reason: 'Student asked for deletion' })).status, 200);
  const after = (await a.get(`/api/admin/students/${stu.id}/export`)).json; assert.equal(after.student.name, 'Anonymized student'); assert.equal(after.student.guardian_name, null); assert.equal(after.student.roll, 'ANON-' + stu.id); assert.ok(after.attendance.length > 0, 'attendance record is retained');
  assert.equal((await new Client(app.base).login('21-ECO-001')).status, 401, 'login is gone');
});
