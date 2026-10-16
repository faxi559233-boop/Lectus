import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as, Client, PW } from './helpers.mjs';

const app = await boot({ seed: { students: 20 } }); const D = app.demo; test.after(() => app.close());
const OFF = D.offerings[0], OFF2 = D.offerings[2];             // course 0 and course 1, both section A; teacher1 teaches course 0, teacher2 course 1
const stuA = D.studentIds.filter((_, i) => i % 2 === 0);       // 10 students in section A
const COMP = [{ name: 'Quiz', max_marks: 10, weight: 15 }, { name: 'Mid', max_marks: 25, weight: 25 }, { name: 'Final', max_marks: 100, weight: 60 }];
let comps;

async function fill(t, scoreFor) {
  const sheet = (await t.get(`/api/offerings/${OFF}/assessment`)).json; comps = sheet.components;
  const entries = []; sheet.rows.forEach((row, i) => comps.forEach(c => entries.push({ student_id: row.id, component_id: c.id, ...scoreFor(i, c) })));
  return t.put(`/api/offerings/${OFF}/marks`, { entries });
}

test('only the course teacher can define components; weights must not exceed 100', async () => {
  const t = await as(app, 'teacher1@demo.local'), t2 = await as(app, 'teacher2@demo.local');
  assert.equal((await t2.put(`/api/offerings/${OFF}/components`, { components: COMP })).status, 403);
  assert.equal((await t.put(`/api/offerings/${OFF}/components`, { components: [{ name: 'A', max_marks: 10, weight: 70 }, { name: 'B', max_marks: 10, weight: 40 }] })).status, 400);
  assert.equal((await t.put(`/api/offerings/${OFF}/components`, { components: [{ name: 'A', max_marks: 10, weight: 50 }, { name: 'a', max_marks: 10, weight: 50 }] })).status, 400, 'duplicate names');
  const ok = await t.put(`/api/offerings/${OFF}/components`, { components: COMP }); assert.equal(ok.status, 200); assert.equal(ok.json.weight_sum, 100);
});

test('marks: validation, idempotent retry, missing marks block submission', async () => {
  const t = await as(app, 'teacher1@demo.local'); const sheet = (await t.get(`/api/offerings/${OFF}/assessment`)).json; const c = sheet.components;
  assert.equal((await t.put(`/api/offerings/${OFF}/marks`, { entries: [{ student_id: sheet.rows[0].id, component_id: c[0].id, obtained: 11 }] })).status, 400, 'above max marks');
  assert.equal((await t.put(`/api/offerings/${OFF}/marks`, { entries: [{ student_id: D.studentIds[1], component_id: c[0].id, obtained: 5 }] })).status, 400, 'student of the other section');
  const one = { op_id: 'op-marks-1234', entries: [{ student_id: sheet.rows[0].id, component_id: c[0].id, obtained: 8 }] };
  assert.equal((await t.put(`/api/offerings/${OFF}/marks`, one)).json.saved, 1); assert.equal((await t.put(`/api/offerings/${OFF}/marks`, one)).json.replayed, true);
  const sub = await t.post(`/api/offerings/${OFF}/results/submit`); assert.equal(sub.status, 400); assert.equal(sub.json.error.code, 'marks_missing');
});

test('full flow: submit, lock, HOD approval, student sees result, GPA maths', async () => {
  const t = await as(app, 'teacher1@demo.local'), hod = await as(app, 'hod@demo.local'), cs = await as(app, 'hod.cs@demo.local'), stu = await as(app, '21-ECO-001');
  // student 0 gets Quiz 10/10, Mid 25/25, Final 90/100 -> 15 + 25 + 54 = 94 -> A (4.0). student 2 is absent in the final -> 15*0.5... computed below
  const r = await fill(t, (i, c) => (i === 0 ? { obtained: { Quiz: 10, Mid: 25, Final: 90 }[c.name] } : i === 1 ? (c.name === 'Final' ? { absent: true } : { obtained: c.max_marks / 2 }) : { obtained: c.max_marks * 0.7 }));
  assert.equal(r.status, 200);
  const s = (await t.get(`/api/offerings/${OFF}/assessment`)).json; assert.equal(s.rows[0].total, 94); assert.equal(s.rows[0].grade, 'A'); assert.equal(s.rows[1].total, 20, '7.5 + 12.5 + 0 for the absent final');
  assert.equal(s.rows[1].grade, 'F'); assert.equal(s.rows[2].total, 70); assert.equal(s.rows[2].grade, 'B-');
  assert.equal((await stu.get('/api/my/results')).json.terms.length, 0, 'nothing is visible before approval');
  assert.equal((await t.post(`/api/offerings/${OFF}/results/approve`)).status, 403, 'a teacher cannot approve');
  assert.equal((await t.post(`/api/offerings/${OFF}/results/submit`)).status, 200);
  assert.equal((await t.put(`/api/offerings/${OFF}/marks`, { entries: [{ student_id: s.rows[0].id, component_id: comps[0].id, obtained: 1 }] })).status, 400, 'locked after submit');
  assert.equal((await cs.post(`/api/offerings/${OFF}/results/approve`)).status, 403, 'HOD of another department');
  assert.equal((await hod.post(`/api/offerings/${OFF}/results/reject`, { note: 'x' })).status, 400, 'note too short');
  assert.equal((await hod.post(`/api/offerings/${OFF}/results/reject`, { note: 'Please recheck the final' })).status, 200);
  assert.equal((await t.put(`/api/offerings/${OFF}/marks`, { entries: [{ student_id: s.rows[2].id, component_id: comps[2].id, obtained: 70 }] })).status, 200, 'editable again after rejection');
  assert.equal((await t.post(`/api/offerings/${OFF}/results/submit`)).status, 200);
  const ap = await hod.post(`/api/offerings/${OFF}/results/approve`); assert.equal(ap.status, 200); assert.equal(ap.json.students, 10);
  const mine = (await stu.get('/api/my/results')).json; assert.equal(mine.terms.length, 1); const c0 = mine.terms[0].courses[0];
  assert.deepEqual([c0.code, c0.total, c0.grade, c0.gp, c0.credits], ['ECO501', 94, 'A', 4, 3]); assert.equal(mine.cgpa, 4);
  assert.ok((await stu.get('/api/notifications')).json.items.some(n => /Result published/.test(n.title)));
  const other = await as(app, '21-ECO-005'); assert.equal((await other.get('/api/my/results')).json.terms[0].courses[0].total, 70, 'each student only sees own result');
});

test('GPA is credit weighted across courses and terms', async () => {
  const t2 = await as(app, 'teacher2@demo.local'), hod = await as(app, 'hod@demo.local'), a = await as(app, 'admin@demo.local');
  await a.put('/api/admin/courses/' + D.courses[1], { credits: 1 });                                   // second course has 1 credit
  await t2.put(`/api/offerings/${OFF2}/components`, { components: [{ name: 'Total', max_marks: 100, weight: 100 }] });
  const sh = (await t2.get(`/api/offerings/${OFF2}/assessment`)).json;
  await t2.put(`/api/offerings/${OFF2}/marks`, { entries: sh.rows.map((x, i) => ({ student_id: x.id, component_id: sh.components[0].id, obtained: i === 0 ? 61 : 90 })) });   // student 0: 61 -> C (2.0)
  await t2.post(`/api/offerings/${OFF2}/results/submit`); await hod.post(`/api/offerings/${OFF2}/results/approve`);
  const mine = (await (await as(app, '21-ECO-001')).get('/api/my/results')).json;
  assert.equal(mine.credits, 4); assert.equal(mine.cgpa, 3.5, '(4.0*3 + 2.0*1) / 4');
  assert.equal(mine.terms[0].gpa, 3.5);
});

test('reopen needs a reason and an admin; scoped exam admin works; published snapshot survives a scale change', async () => {
  const a = await as(app, 'admin@demo.local'), t = await as(app, 'teacher1@demo.local'), hod = await as(app, 'hod@demo.local');
  assert.equal((await hod.post(`/api/offerings/${OFF}/results/reopen`, { reason: 'because I want' })).status, 403);
  // scoped admin: exams only
  const mk = await a.post('/api/admin/users', { name: 'Exam Cell', email: 'exams@demo.local', role: 'admin', perms: 'exams', password: 'Exam-Cell-Pass-1' }); assert.equal(mk.status, 201);
  const ex = new Client(app.base); await ex.login('exams@demo.local', 'Exam-Cell-Pass-1'); await ex.post('/api/auth/change-password', { current: 'Exam-Cell-Pass-1', new: 'Exam-Cell-Pass-2' }); await ex.login('exams@demo.local', 'Exam-Cell-Pass-2');
  assert.equal((await ex.get('/api/admin/users')).status, 403, 'limited admin cannot manage users');
  assert.equal((await ex.get('/api/admin/grade-scale')).status, 200);
  // changing the scale does not touch published results
  const scale = (await ex.get('/api/admin/grade-scale')).json.scale.map(r => (r.grade === 'A' ? { ...r, min: 95 } : r));
  assert.equal((await ex.put('/api/admin/grade-scale', { scale })).status, 200);
  assert.equal((await (await as(app, '21-ECO-001')).get('/api/my/results')).json.terms[0].courses[0].grade, 'A', 'snapshot unchanged');
  assert.equal((await ex.post(`/api/offerings/${OFF}/results/reopen`, { reason: 'ok' })).status, 400, 'reason too short');
  assert.equal((await ex.post(`/api/offerings/${OFF}/results/reopen`, { reason: 'Final paper marks corrected' })).status, 200);
  assert.equal((await (await as(app, '21-ECO-001')).get('/api/my/results')).json.terms.length, 1, 'only the other course remains visible');
  assert.equal((await t.put(`/api/offerings/${OFF}/marks`, { entries: [{ student_id: stuA[0], component_id: comps[2].id, obtained: 90 }] })).status, 200, 'teacher can edit again');
  const logs = (await a.get('/api/admin/audit?limit=200')).json.map(x => x.action); assert.ok(logs.includes('results.reopen') && logs.includes('results.approve'));
});

test('grade scale validation and CSV export', async () => {
  const a = await as(app, 'admin@demo.local'), t = await as(app, 'teacher1@demo.local');
  assert.equal((await a.put('/api/admin/grade-scale', { scale: [{ min: 50, grade: 'P', gp: 2 }, { min: 0, grade: 'F', gp: 3 }] })).status, 400, 'grade points rising as marks fall');
  assert.equal((await a.put('/api/admin/grade-scale', { scale: [{ min: 50, grade: 'P', gp: 2 }] })).status, 400, 'needs a row starting at 0');
  assert.equal((await a.put('/api/admin/grade-scale', { scale: [{ min: 50, grade: 'P', gp: 2 }, { min: 0, grade: 'F', gp: 0 }] })).status, 200);
  const csv = await t.get(`/api/offerings/${OFF}/results.csv`); assert.equal(csv.status, 200); assert.match(csv.text, /Roll.*Quiz \(\/10\).*Total.*Grade/); assert.match(csv.text, /21-ECO-001/);
  assert.equal((await (await as(app, 'teacher2@demo.local')).get(`/api/offerings/${OFF}/results.csv`)).status, 403);
});
