import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as } from './helpers.mjs';

const app = await boot({ seed: { students: 20 } }); const D = app.demo; test.after(() => app.close());
const OFF = D.offerings[0]; const iso = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

test('leave request: validation, overlap, cancel', async () => {
  const s = await as(app, '21-ECO-001');
  assert.equal((await s.post('/api/leaves', { from: iso(2), to: iso(1), reason: 'Wedding in family' })).status, 400, 'end before start');
  assert.equal((await s.post('/api/leaves', { from: iso(-90), to: iso(-89), reason: 'Long ago ill' })).status, 400, 'too old');
  assert.equal((await s.post('/api/leaves', { from: iso(0), to: iso(90), reason: 'Very long trip' })).status, 400, 'too long');
  const a = await s.post('/api/leaves', { from: iso(1), to: iso(3), reason: 'Wedding in family' }); assert.equal(a.status, 201);
  assert.equal((await s.post('/api/leaves', { from: iso(3), to: iso(4), reason: 'Overlaps the first' })).status, 400, 'overlap');
  assert.equal((await s.post(`/api/leaves/${a.json.id}/cancel`)).status, 200); assert.equal((await s.post('/api/leaves', { from: iso(3), to: iso(4), reason: 'Now free again' })).status, 201);
  assert.equal((await (await as(app, 'teacher1@demo.local')).get('/api/leaves')).status, 403);
});

test('HOD approval turns absences into leave and flags the roster', async () => {
  const t = await as(app, 'teacher1@demo.local'), s = await as(app, '21-ECO-005'), hod = await as(app, 'hod@demo.local'), cs = await as(app, 'hod.cs@demo.local');
  const today = iso(0); const ses = (await t.post(`/api/offerings/${OFF}/sessions`, { date: today, topic: 'L1' })).json;
  const roster = (await t.get(`/api/sessions/${ses.id}`)).json.roster; const me = roster.find(x => x.roll === '21-ECO-005');
  await t.put(`/api/sessions/${ses.id}/marks`, { marks: roster.map(x => ({ student_id: x.id, status: x.roll === '21-ECO-005' ? 'A' : 'P' })) });
  const before = (await s.get('/api/my/attendance')).json.offerings.find(o => o.course_code === 'ECO501'); assert.equal(before.A, 1);
  const l = (await s.post('/api/leaves', { from: today, to: iso(1), reason: 'Medical: fever and rest' })).json;
  assert.equal((await cs.post(`/api/leaves/${l.id}/decide`, { decision: 'approved' })).status, 403, 'HOD of another department');
  assert.equal((await cs.get('/api/leaves')).json.length, 0);
  assert.ok((await hod.get('/api/leaves')).json.some(x => x.id === l.id), 'HOD sees the request of their department');
  assert.equal((await hod.post(`/api/leaves/${l.id}/decide`, { decision: 'rejected' })).status, 400, 'rejection needs a reason');
  const ok = await hod.post(`/api/leaves/${l.id}/decide`, { decision: 'approved', note: 'Get well soon' }); assert.equal(ok.status, 200); assert.equal(ok.json.converted, 1);
  const after = (await s.get('/api/my/attendance')).json.offerings.find(o => o.course_code === 'ECO501'); assert.equal(after.A, 0); assert.equal(after.L, 1, 'absence became leave and stats followed');
  assert.equal((await hod.post(`/api/leaves/${l.id}/decide`, { decision: 'rejected', note: 'late' })).status, 400, 'decided once');
  assert.equal((await t.get(`/api/sessions/${ses.id}`)).json.roster.find(x => x.id === me.id).on_leave, true);
  assert.ok((await s.get('/api/notifications')).json.items.some(n => /Leave approved/.test(n.title)));
  assert.equal((await s.get('/api/my/leaves')).json[0].status, 'approved');
});
