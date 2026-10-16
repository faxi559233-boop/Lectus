import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as, Client } from './helpers.mjs';
import { voucherNumber } from '../routes/fees.mjs';

const app = await boot({ seed: { students: 20 } }); const D = app.demo; test.after(() => app.close());
const luhnOk = s => { let sum = 0; [...s].reverse().forEach((ch, i) => { let d = +ch; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }); return sum % 10 === 0; };
let clerk, plan, vouchers;
const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10), daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

test('an accounts officer is a scoped admin: fees yes, everything else no', async () => {
  const a = await as(app, 'admin@demo.local');
  assert.equal((await a.post('/api/admin/users', { name: 'Accounts', email: 'accounts@demo.local', role: 'admin', perms: 'fees', password: 'Ledger-Desk-Pass-1' })).status, 201);
  assert.equal((await a.post('/api/admin/users', { name: 'Bad', email: 'bad@demo.local', role: 'admin', perms: 'everything', password: 'Ledger-Desk-Pass-1' })).status, 400);
  clerk = new Client(app.base); await clerk.login('accounts@demo.local', 'Ledger-Desk-Pass-1'); await clerk.post('/api/auth/change-password', { current: 'Ledger-Desk-Pass-1', new: 'Ledger-Desk-Pass-2' }); await clerk.login('accounts@demo.local', 'Ledger-Desk-Pass-2');
  for (const p of ['/api/admin/users', '/api/admin/stats', '/api/admin/students', '/api/admin/audit']) assert.equal((await clerk.get(p)).status, 403, p);
  assert.equal((await clerk.get('/api/fees/summary')).status, 200); assert.equal((await clerk.get('/api/notifications')).status, 200, 'shared routes stay open');
  assert.equal((await (await as(app, 'teacher1@demo.local')).get('/api/fees/summary')).status, 403);
  assert.equal((await (await as(app, '21-ECO-001')).get('/api/fees/vouchers')).status, 403);
  assert.equal((await a.put('/api/admin/users/' + (await a.get('/api/admin/users?q=accounts')).json.items[0].id, { perms: 'fees,exams' })).status, 200);
  await clerk.login('accounts@demo.local', 'Ledger-Desk-Pass-2'); assert.equal((await clerk.get('/api/auth/me')).json.user.perms, 'fees,exams', 'sessions were reset when perms changed');
});

test('voucher numbers are digits with a valid check digit', () => { for (const id of [1, 2, 999, 1234567]) { const n = voucherNumber('5', id); assert.match(n, /^\d{11}$/); assert.ok(luhnOk(n), n); } });

test('plans: create, validate, generate vouchers once per student', async () => {
  assert.equal((await clerk.post('/api/fees/plans', { name: 'Bad', items: [{ head: 'Tuition', amount: 100 }, { head: 'tuition', amount: 5 }] })).status, 400);
  const p = await clerk.post('/api/fees/plans', { name: 'Fall 2026 Tuition', due_days: 20, items: [{ head: 'Tuition', amount: 13335 }, { head: 'Library', amount: 500 }] }); assert.equal(p.status, 201); plan = p.json; assert.equal(plan.total, 13835);
  assert.equal((await clerk.post('/api/fees/plans', { name: 'Fall 2026 Tuition', items: [{ head: 'X', amount: 1 }] })).status, 409, 'duplicate name');
  const g = await clerk.post(`/api/fees/plans/${plan.id}/generate`, { section_id: D.secs[0] }); assert.equal(g.status, 200); assert.equal(g.json.created, 10);
  assert.deepEqual(await clerk.post(`/api/fees/plans/${plan.id}/generate`, { section_id: D.secs[0] }).then(r => r.json), { created: 0, skipped: 10 });
  vouchers = (await clerk.get('/api/fees/vouchers?limit=100')).json; assert.equal(vouchers.total, 10); assert.equal(vouchers.balance, 138350);
  assert.ok(vouchers.items.every(x => luhnOk(x.number) && x.gross === 13835 && x.state === 'unpaid'));
  assert.equal(new Set(vouchers.items.map(x => x.number)).size, 10);
  assert.equal((await clerk.del(`/api/fees/plans/${plan.id}`)).status, 409, 'plan in use');
});

test('payments: partial, overpay refused, reference rules, reversal, discount', async () => {
  const v = vouchers.items.find(x => x.roll === '21-ECO-001');
  assert.equal((await clerk.post(`/api/fees/vouchers/${v.id}/payments`, { amount: 5000, method: 'bank' })).status, 400, 'bank payment needs a reference');
  const p1 = await clerk.post(`/api/fees/vouchers/${v.id}/payments`, { amount: 5000, method: 'bank', reference: 'TX-1001' }); assert.equal(p1.status, 201); assert.equal(p1.json.state, 'partial'); assert.equal(p1.json.balance, 8835);
  assert.equal((await clerk.post(`/api/fees/vouchers/${v.id}/payments`, { amount: 100, method: 'bank', reference: 'TX-1001' })).status, 409, 'same reference twice');
  assert.equal((await clerk.post(`/api/fees/vouchers/${v.id}/payments`, { amount: 9000, method: 'cash' })).status, 400, 'more than balance');
  assert.equal((await clerk.put(`/api/fees/vouchers/${v.id}`, { discount: 2000 })).json.balance, 6835, 'discount lowers the balance');
  const p2 = await clerk.post(`/api/fees/vouchers/${v.id}/payments`, { amount: 6835, method: 'cash' }); assert.equal(p2.json.state, 'paid');
  assert.equal((await clerk.put(`/api/fees/vouchers/${v.id}`, { void: true })).status, 400, 'cannot void with payments');
  const rev = await clerk.post(`/api/fees/payments/${p1.json.payments[0].id}/reverse`, { reason: 'Cheque bounced' }); assert.equal(rev.json.state, 'partial'); assert.equal(rev.json.paid, 6835);
  assert.equal((await clerk.post(`/api/fees/payments/${p1.json.payments[0].id}/reverse`, { reason: 'Again please' })).status, 400, 'already reversed');
  assert.equal((await clerk.post(`/api/fees/vouchers/${v.id}/payments`, { amount: 100, method: 'bank', reference: 'TX-1001' })).status, 201, 'reference is free again after reversal');
});

test('bank file import matches by voucher number and is safe to repeat', async () => {
  const [a, b] = vouchers.items.filter(x => x.roll !== '21-ECO-001').slice(0, 2);
  const rows = [{ number: a.number, amount: 13835, reference: 'BK-1', paid_on: '2026-10-01' }, { number: b.number, amount: 99999, reference: 'BK-2' }, { number: '00000000000', amount: 10, reference: 'BK-3' }];
  const r1 = (await clerk.post('/api/fees/payments/import', { rows })).json; assert.equal(r1.applied, 1); assert.equal(r1.errors.length, 2);
  const r2 = (await clerk.post('/api/fees/payments/import', { rows })).json; assert.equal(r2.applied, 0); assert.equal(r2.duplicate, 1, 'the same statement can be uploaded twice');
  assert.equal((await clerk.get(`/api/fees/vouchers/${a.id}`)).json.state, 'paid');
});

test('overdue, late fines, filters and CSV', async () => {
  const x = vouchers.items.find(v => v.roll === '21-ECO-005');
  await clerk.put(`/api/fees/vouchers/${x.id}`, { due_date: daysAgo(10) });
  assert.equal((await clerk.post('/api/fees/fines/apply')).status, 400, 'no rule yet');
  await clerk.put('/api/fees/settings', { late_fine_per_day: 50, late_fine_cap: 300 });
  const f = (await clerk.post('/api/fees/fines/apply')).json; assert.equal(f.vouchers, 1); assert.equal(f.total, 300, '10 days x 50 capped at 300');
  assert.equal((await clerk.post('/api/fees/fines/apply')).json.vouchers, 0, 'fine is applied once');
  const od = (await clerk.get('/api/fees/vouchers?state=overdue')).json; assert.equal(od.total, 1); assert.equal(od.items[0].balance, 14135);
  assert.equal((await clerk.get('/api/fees/vouchers?state=paid')).json.total, 1);
  assert.equal((await clerk.get('/api/fees/vouchers?q=21-ECO-005')).json.total, 1);
  assert.equal((await clerk.put('/api/fees/settings', { voucher_prefix: '7' })).status, 400, 'prefix is locked once vouchers exist');
  const csv = await clerk.get('/api/fees/vouchers.csv?state=overdue'); assert.match(csv.text, /21-ECO-005/); assert.equal((await clerk.get('/api/fees/payments.csv')).status, 200);
  const sm = (await clerk.get('/api/fees/summary')).json; assert.equal(sm.overdue_count, 1); assert.ok(sm.collected > 0 && sm.outstanding > 0);
});

test('students see only their own vouchers; custom voucher; settings', async () => {
  const s = await as(app, '21-ECO-001'), o = await as(app, '21-ECO-003');
  const mine = (await s.get('/api/my/fees')).json; assert.equal(mine.vouchers.length, 1); assert.equal(mine.vouchers[0].roll, '21-ECO-001'); assert.ok(mine.vouchers[0].items.length === 2 && mine.vouchers[0].payments.length >= 2);
  assert.equal((await o.get('/api/my/fees')).json.vouchers[0].roll, '21-ECO-003');
  assert.equal((await clerk.get(`/api/fees/vouchers/${mine.vouchers[0].id}`)).status, 200); assert.equal((await s.get(`/api/fees/vouchers/${mine.vouchers[0].id}`)).status, 403);
  const stu = (await clerk.get('/api/fees/students?q=21-ECO-00')).json; assert.ok(stu.length > 0);
  const c = await clerk.post('/api/fees/vouchers', { student_id: stu[0].id, title: 'Transcript fee', items: [{ head: 'Transcript', amount: 1000 }], due_date: tomorrow() }); assert.equal(c.status, 201); assert.equal(c.json.gross, 1000);
  assert.equal((await clerk.post('/api/fees/vouchers', { student_id: stu[0].id, title: 'x', items: [{ head: 'A', amount: 10 }], discount: 50, due_date: tomorrow() })).status, 400, 'discount above total');
  assert.ok((await s.get('/api/notifications')).json.items.some(n => /Fee voucher/.test(n.title)));
  assert.equal((await clerk.put('/api/fees/settings', { instructions: 'Pay at any HBL branch, quote the voucher number.' })).status, 200);
  assert.match((await s.get('/api/my/fees')).json.instructions, /HBL/);
});
