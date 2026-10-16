import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as } from './helpers.mjs';

const app = await boot({ seed: { students: 20 } }); const D = app.demo; test.after(() => app.close());
const OFF = D.offerings[0]; const stuA = D.studentIds.filter((_, i) => i % 2 === 0);

test('warning ladder: one notification per level, never repeated', async () => {
  const t = await as(app, 'teacher1@demo.local'), a = await as(app, 'admin@demo.local');
  const roster = async id => (await t.get(`/api/sessions/${id}`)).json.roster;
  assert.deepEqual((await a.post('/api/admin/warnings/run')).json, { level1: 0, level2: 0, checked: 0 }, 'no lectures yet');
  // four lectures: student 1 absent 3 times (25%), student 2 absent once (75% = exactly the minimum, within 5 points), the rest present
  for (let i = 0; i < 4; i++) { const s = (await t.post(`/api/offerings/${OFF}/sessions`, { date: `2026-10-0${i + 1}` })).json; const r = await roster(s.id);
    await t.put(`/api/sessions/${s.id}/marks`, { marks: r.map((x, k) => ({ student_id: x.id, status: (k === 0 && i < 3) || (k === 1 && i === 0) ? 'A' : 'P' })) }); }
  const run = (await a.post('/api/admin/warnings/run')).json; assert.equal(run.level2, 1); assert.equal(run.level1, 1);
  assert.deepEqual((await a.post('/api/admin/warnings/run')).json.level1 + (await a.post('/api/admin/warnings/run')).json.level2, 0, 'second run sends nothing');
  const s1 = await as(app, '21-ECO-001'); const n = (await s1.get('/api/notifications')).json.items; assert.ok(n.some(x => /below minimum/i.test(x.title)) && !n.some(x => /getting low/i.test(x.title)));
  const s2 = await as(app, '21-ECO-003'); assert.ok((await s2.get('/api/notifications')).json.items.some(x => /getting low/i.test(x.title)));
  const s3 = await as(app, '21-ECO-005'); assert.equal((await s3.get('/api/notifications')).json.items.length, 0, 'students above the line hear nothing');
  // student 1 falls further: level 2 already sent, nothing new; student 2 now drops below the minimum: level 2 arrives
  const s = (await t.post(`/api/offerings/${OFF}/sessions`, { date: '2026-10-05' })).json; const r = await roster(s.id);
  await t.put(`/api/sessions/${s.id}/marks`, { marks: r.map((x, k) => ({ student_id: x.id, status: k <= 1 ? 'A' : 'P' })) });
  assert.deepEqual([(await a.post('/api/admin/warnings/run')).json].map(x => [x.level1, x.level2])[0], [0, 1]);
  assert.equal((await t.post('/api/admin/warnings/run')).status, 403);
});
