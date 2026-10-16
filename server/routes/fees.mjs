import { v, bad, notFound, HttpError, now, today, csvCell } from '../lib/util.mjs';
import { audit } from '../lib/audit.mjs';
import { tx } from '../db.mjs';
import { dbErr } from './admin.mjs';
import { studentOfUser } from '../lib/access.mjs';

const FEES = { auth: ['admin'], perm: 'fees' }, STU = { auth: ['student'] };
const getS = (db, k, d) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : d; };
const setS = (db, k, val) => db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(val));
/** All-digit consumer number: prefix + yy + 7-digit serial + Luhn check digit. Digits only so it can later be used as a bank/1Bill style reference. */
export function voucherNumber(prefix, id) {
  const body = prefix + String(new Date().getFullYear()).slice(2) + String(id).padStart(7, '0');
  let sum = 0; [...body].reverse().forEach((ch, i) => { let d = +ch; if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; });
  return body + String((10 - (sum % 10)) % 10);
}
const VSEL = `SELECT v.*, st.roll, st.name AS student_name, st.section_id, sec.name AS section_name,
  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.voucher_id=v.id AND p.reversed_at IS NULL),0) AS paid,
  (v.gross - v.discount + v.fine) AS due_total FROM vouchers v JOIN students st ON st.id=v.student_id LEFT JOIN sections sec ON sec.id=st.section_id`;
function decorate(x) {
  const balance = x.due_total - x.paid;
  const status = x.status === 'void' ? 'void' : balance <= 0 ? 'paid' : x.paid > 0 ? 'partial' : 'unpaid';
  return { ...x, balance, state: status, overdue: x.status === 'open' && balance > 0 && x.due_date < today() };
}
const detail = (db, id) => { const x = db.prepare(VSEL + ' WHERE v.id=?').get(id); if (!x) throw notFound('Voucher not found');
  return { ...decorate(x), items: db.prepare('SELECT head,amount FROM voucher_items WHERE voucher_id=? ORDER BY head').all(id), payments: db.prepare('SELECT id,amount,method,reference,paid_on,note,reversed_at,reversed_reason FROM payments WHERE voucher_id=? ORDER BY id').all(id) }; };
const notify = (db, userId, title, body) => { if (userId) db.prepare('INSERT INTO notifications(user_id,title,body,url,created_at) VALUES (?,?,?,?,?)').run(userId, title, body, '/portal/#/fees', now()); };
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function createVoucher(db, user, { student, plan_id = null, title, items, discount = 0, due_date, note = null }) {
  const gross = items.reduce((a, i) => a + i.amount, 0);
  if (discount > gross) throw bad('discount_too_big', 'Discount is larger than the total');
  const id = Number(db.prepare('SELECT COALESCE(MAX(id),0)+1 AS n FROM vouchers').get().n);
  db.prepare('INSERT INTO vouchers(id,number,student_id,plan_id,title,gross,discount,due_date,created_by,created_at,note) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, voucherNumber(getS(db, 'voucher_prefix', '5'), id), student.id, plan_id, title, gross, discount, due_date, user.id, now(), note);
  for (const i of items) db.prepare('INSERT INTO voucher_items(voucher_id,head,amount) VALUES (?,?,?)').run(id, i.head, i.amount);
  notify(db, student.user_id, `Fee voucher: ${title}`, `Amount Rs ${gross - discount}, due ${due_date}.`);
  return id;
}
const parseItems = list => { if (!Array.isArray(list) || !list.length || list.length > 30) throw bad('invalid_items', 'Send 1-30 fee items');
  const out = list.map(i => ({ head: v.str(i.head, 'head', { max: 60 }), amount: v.int(i.amount, 'amount', { min: 0, max: 100000000 }) }));
  if (new Set(out.map(i => i.head.toLowerCase())).size !== out.length) throw bad('duplicate', 'Fee item names must be different'); return out; };

export default function (r, db) {
  /* ----- settings & lookups ----- */
  r.get('/api/fees/settings', FEES, () => ({ voucher_prefix: getS(db, 'voucher_prefix', '5'), late_fine_per_day: +getS(db, 'late_fine_per_day', 0), late_fine_cap: +getS(db, 'late_fine_cap', 0),
    instructions: getS(db, 'fee_instructions', ''), college_name: getS(db, 'college_name', 'Government Murray College') }));
  r.put('/api/fees/settings', FEES, ctx => {
    const b = ctx.body;
    if ('voucher_prefix' in b) { if (db.prepare('SELECT 1 FROM vouchers LIMIT 1').get()) throw bad('prefix_locked', 'The number prefix cannot change after vouchers exist'); setS(db, 'voucher_prefix', v.str(b.voucher_prefix, 'voucher_prefix', { min: 1, max: 6, re: /^\d+$/ })); }
    if ('late_fine_per_day' in b) setS(db, 'late_fine_per_day', v.int(b.late_fine_per_day, 'late_fine_per_day', { min: 0, max: 100000 }));
    if ('late_fine_cap' in b) setS(db, 'late_fine_cap', v.int(b.late_fine_cap, 'late_fine_cap', { min: 0, max: 10000000 }));
    if ('instructions' in b) setS(db, 'fee_instructions', v.str(b.instructions, 'instructions', { max: 600, optional: true }) ?? '');
    if ('college_name' in b) setS(db, 'college_name', v.str(b.college_name, 'college_name', { min: 2, max: 100 }));
    audit(db, ctx.user, 'fees.settings', 'settings', null, b, ctx.ip); return { ok: true };
  });
  r.get('/api/fees/lookups', FEES, () => ({
    terms: db.prepare('SELECT id,name,active FROM terms ORDER BY id DESC').all(), programs: db.prepare('SELECT id,code,name FROM programs ORDER BY code').all(),
    sections: db.prepare('SELECT sec.id, sec.name, sec.term_id, sec.program_id, p.code AS program_code, (SELECT COUNT(*) FROM students s WHERE s.section_id=sec.id AND s.status=\'active\') AS students FROM sections sec JOIN programs p ON p.id=sec.program_id ORDER BY sec.term_id DESC, p.code, sec.name').all() }));
  r.get('/api/fees/students', FEES, ctx => { const q = '%' + String(ctx.query.q || '').slice(0, 40) + '%';
    return db.prepare("SELECT st.id, st.roll, st.name, sec.name AS section_name FROM students st LEFT JOIN sections sec ON sec.id=st.section_id WHERE st.status='active' AND (st.roll LIKE ? OR st.name LIKE ?) ORDER BY st.roll LIMIT 20").all(q, q); });

  /* ----- plans ----- */
  const planWithItems = id => { const p = db.prepare('SELECT * FROM fee_plans WHERE id=?').get(id); if (!p) throw notFound('Plan not found'); return { ...p, items: db.prepare('SELECT head,amount FROM fee_plan_items WHERE plan_id=? ORDER BY head').all(id), total: db.prepare('SELECT COALESCE(SUM(amount),0) t FROM fee_plan_items WHERE plan_id=?').get(id).t }; };
  r.get('/api/fees/plans', FEES, () => db.prepare('SELECT id FROM fee_plans ORDER BY id DESC').all().map(x => planWithItems(x.id)));
  const savePlan = (ctx, id) => {
    const b = ctx.body, name = v.str(b.name, 'name', { min: 2, max: 80 }), items = parseItems(b.items), due = v.int(b.due_days ?? 30, 'due_days', { min: 1, max: 365 });
    const term = v.int(b.term_id, 'term_id', { min: 1, optional: true }), prog = v.int(b.program_id, 'program_id', { min: 1, optional: true }), active = b.active === false ? 0 : 1;
    try { return tx(db, () => {
      if (!id) id = Number(db.prepare('INSERT INTO fee_plans(name,term_id,program_id,due_days,active) VALUES (?,?,?,?,?)').run(name, term, prog, due, active).lastInsertRowid);
      else { if (!db.prepare('SELECT 1 FROM fee_plans WHERE id=?').get(id)) throw notFound(); db.prepare('UPDATE fee_plans SET name=?, term_id=?, program_id=?, due_days=?, active=? WHERE id=?').run(name, term, prog, due, active, id); db.prepare('DELETE FROM fee_plan_items WHERE plan_id=?').run(id); }
      for (const i of items) db.prepare('INSERT INTO fee_plan_items(plan_id,head,amount) VALUES (?,?,?)').run(id, i.head, i.amount);
      return id; }); } catch (e) { throw dbErr(e); }
  };
  r.post('/api/fees/plans', FEES, ctx => { const id = savePlan(ctx, null); audit(db, ctx.user, 'fees.plan.create', 'plan', id, { name: ctx.body.name }, ctx.ip); ctx.status = 201; return planWithItems(id); });
  r.put('/api/fees/plans/:id', FEES, ctx => { const id = savePlan(ctx, v.int(ctx.params.id, 'id', { min: 1 })); audit(db, ctx.user, 'fees.plan.update', 'plan', id, null, ctx.ip); return planWithItems(id); });
  r.del('/api/fees/plans/:id', FEES, ctx => { const id = v.int(ctx.params.id, 'id', { min: 1 });
    if (db.prepare('SELECT 1 FROM vouchers WHERE plan_id=? LIMIT 1').get(id)) throw new HttpError(409, 'in_use', 'Vouchers were created from this plan. Mark it inactive instead.');
    db.prepare('DELETE FROM fee_plans WHERE id=?').run(id); audit(db, ctx.user, 'fees.plan.delete', 'plan', id, null, ctx.ip); return { ok: true }; });

  /* ----- vouchers ----- */
  r.post('/api/fees/plans/:id/generate', FEES, ctx => {
    const plan = planWithItems(v.int(ctx.params.id, 'id', { min: 1 })); if (!plan.active) throw bad('inactive', 'This plan is inactive');
    const sid = v.int(ctx.body.section_id, 'section_id', { min: 1 }); if (!db.prepare('SELECT 1 FROM sections WHERE id=?').get(sid)) throw notFound('Section not found');
    const due = v.date(ctx.body.due_date ?? addDays(today(), plan.due_days), 'due_date'), disc = v.int(ctx.body.discount ?? 0, 'discount', { min: 0, max: 100000000 });
    const studs = db.prepare("SELECT id,user_id FROM students WHERE section_id=? AND status='active' ORDER BY roll").all(sid);
    let created = 0, skipped = 0;
    tx(db, () => { for (const st of studs) {
      if (db.prepare("SELECT 1 FROM vouchers WHERE plan_id=? AND student_id=? AND status='open'").get(plan.id, st.id)) { skipped++; continue; }
      createVoucher(db, ctx.user, { student: st, plan_id: plan.id, title: plan.name, items: plan.items, discount: disc, due_date: due }); created++; } });
    audit(db, ctx.user, 'fees.generate', 'plan', plan.id, { section: sid, created, skipped }, ctx.ip); return { created, skipped };
  });
  r.post('/api/fees/vouchers', FEES, ctx => {
    const st = db.prepare("SELECT id,user_id FROM students WHERE id=? AND status='active'").get(v.int(ctx.body.student_id, 'student_id', { min: 1 })); if (!st) throw notFound('Student not found');
    const id = tx(db, () => createVoucher(db, ctx.user, { student: st, title: v.str(ctx.body.title, 'title', { min: 2, max: 80 }), items: parseItems(ctx.body.items), discount: v.int(ctx.body.discount ?? 0, 'discount', { min: 0 }), due_date: v.date(ctx.body.due_date, 'due_date'), note: v.str(ctx.body.note, 'note', { max: 200, optional: true }) }));
    audit(db, ctx.user, 'fees.voucher.create', 'voucher', id, null, ctx.ip); ctx.status = 201; return detail(db, id);
  });
  const filters = ctx => { const w = [], a = []; const q = ctx.query;
    if (q.q) { w.push('(st.roll LIKE ? OR st.name LIKE ? OR v.number LIKE ?)'); const l = '%' + String(q.q).slice(0, 40) + '%'; a.push(l, l, l); }
    if (q.section_id) { w.push('st.section_id=?'); a.push(v.int(q.section_id, 'section_id')); }
    if (q.plan_id) { w.push('v.plan_id=?'); a.push(v.int(q.plan_id, 'plan_id')); }
    return { w, a }; };
  const having = (st) => st === 'paid' ? 'balance<=0 AND status<>\'void\'' : st === 'unpaid' ? 'paid=0 AND balance>0 AND status<>\'void\'' : st === 'partial' ? 'paid>0 AND balance>0 AND status<>\'void\'' : st === 'overdue' ? `balance>0 AND status='open' AND due_date<'${today()}'` : st === 'void' ? "status='void'" : '1=1';
  const listSql = (ctx, limit, offset) => { const { w, a } = filters(ctx); const st = ctx.query.state ? v.oneOf(ctx.query.state, 'state', ['paid', 'unpaid', 'partial', 'overdue', 'void']) : null;
    const inner = `${VSEL} ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`;
    return { rows: db.prepare(`SELECT *, (due_total-paid) AS balance FROM (${inner}) WHERE ${having(st)} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...a, limit, offset),
      total: db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(due_total-paid),0) bal, COALESCE(SUM(paid),0) paid FROM (SELECT *, (due_total-paid) AS balance FROM (${inner})) WHERE ${having(st)}`).get(...a) }; };
  r.get('/api/fees/vouchers', FEES, ctx => { const lim = Math.min(+ctx.query.limit || 50, 200), off = Math.max(+ctx.query.offset || 0, 0); const { rows, total } = listSql(ctx, lim, off);
    return { total: total.c, balance: total.bal, collected: total.paid, items: rows.map(decorate) }; });
  r.get('/api/fees/vouchers.csv', FEES, ctx => { const { rows } = listSql(ctx, 100000, 0);
    const head = ['Voucher', 'Roll', 'Name', 'Section', 'Title', 'Total', 'Discount', 'Fine', 'Paid', 'Balance', 'Due date', 'Status'];
    const body = rows.map(decorate).map(x => [x.number, x.roll, x.student_name, x.section_name || '', x.title, x.gross, x.discount, x.fine, x.paid, x.balance, x.due_date, x.state].map(csvCell).join(','));
    return { __raw: true, type: 'text/csv; charset=utf-8', body: '﻿' + [head.map(csvCell).join(','), ...body].join('\r\n'), headers: { 'content-disposition': 'attachment; filename="fee-vouchers.csv"' } }; });
  r.get('/api/fees/vouchers/:id', FEES, ctx => detail(db, v.int(ctx.params.id, 'id', { min: 1 })));
  r.put('/api/fees/vouchers/:id', FEES, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }), d = detail(db, id), b = ctx.body, sets = [], vals = [];
    if (d.status === 'void') throw bad('void', 'This voucher is cancelled');
    if ('discount' in b) { const x = v.int(b.discount, 'discount', { min: 0 }); if (x > d.gross) throw bad('discount_too_big', 'Discount is larger than the total'); if (d.paid > d.gross - x + d.fine) throw bad('below_paid', 'Amount already paid is more than the new total'); sets.push('discount=?'); vals.push(x); }
    if ('due_date' in b) { sets.push('due_date=?'); vals.push(v.date(b.due_date, 'due_date')); }
    if ('fine' in b) { const x = v.int(b.fine, 'fine', { min: 0 }); sets.push('fine=?'); vals.push(x); }
    if ('note' in b) { sets.push('note=?'); vals.push(v.str(b.note, 'note', { max: 200, optional: true })); }
    if (b.void === true) { if (d.paid > 0) throw bad('has_payments', 'Reverse the payments before cancelling'); sets.push("status='void'"); }
    if (!sets.length) throw bad('nothing_to_update', 'No fields to update');
    db.prepare(`UPDATE vouchers SET ${sets.join(',')} WHERE id=?`).run(...vals, id); audit(db, ctx.user, 'fees.voucher.update', 'voucher', id, b, ctx.ip); return detail(db, id);
  });

  /* ----- payments ----- */
  function pay(user, ip, d, { amount, method, reference, paid_on, note }) {
    if (d.status === 'void') throw bad('void', 'This voucher is cancelled');
    if (amount > d.balance) throw bad('overpay', `Amount is more than the balance (Rs ${d.balance})`);
    try { const res = db.prepare('INSERT INTO payments(voucher_id,amount,method,reference,paid_on,recorded_by,recorded_at,note) VALUES (?,?,?,?,?,?,?,?)').run(d.id, amount, method, reference, paid_on, user.id, now(), note);
      audit(db, user, 'fees.payment', 'voucher', d.id, { amount, method, reference }, ip); return Number(res.lastInsertRowid); } catch (e) { throw dbErr(e); }
  }
  r.post('/api/fees/vouchers/:id/payments', FEES, ctx => {
    const d = detail(db, v.int(ctx.params.id, 'id', { min: 1 })), b = ctx.body;
    const p = { amount: v.int(b.amount, 'amount', { min: 1 }), method: v.oneOf(b.method ?? 'cash', 'method', ['cash', 'bank', 'online', 'other']), reference: v.str(b.reference, 'reference', { max: 60, optional: true }), paid_on: v.date(b.paid_on ?? today(), 'paid_on'), note: v.str(b.note, 'note', { max: 200, optional: true }) };
    if (p.method !== 'cash' && !p.reference) throw bad('reference_required', 'Enter the bank / transaction reference');
    tx(db, () => pay(ctx.user, ctx.ip, d, p));
    const st = db.prepare('SELECT user_id FROM students WHERE id=?').get(d.student_id); notify(db, st.user_id, 'Payment received', `Rs ${p.amount} received for ${d.title}.`);
    ctx.status = 201; return detail(db, d.id);
  });
  r.post('/api/fees/payments/:id/reverse', FEES, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }), reason = v.str(ctx.body.reason, 'reason', { min: 5, max: 200 });
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id); if (!p) throw notFound(); if (p.reversed_at) throw bad('already_reversed', 'Already reversed');
    db.prepare('UPDATE payments SET reversed_at=?, reversed_reason=?, reference=NULL WHERE id=?').run(now(), reason + (p.reference ? ` (ref ${p.reference})` : ''), id);   // free the reference so a corrected entry can reuse it
    audit(db, ctx.user, 'fees.payment.reverse', 'payment', id, { reason, amount: p.amount }, ctx.ip); return detail(db, p.voucher_id);
  });
  /** Bank statement import: rows are matched by voucher number. This is also the hook for a future 1Bill/bank feed. Safe to re-upload (method+reference is unique). */
  r.post('/api/fees/payments/import', FEES, ctx => {
    const rows = ctx.body.rows; if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw bad('invalid_rows', 'Send 1-5000 rows');
    const method = v.oneOf(ctx.body.method ?? 'bank', 'method', ['bank', 'online']); const out = { applied: 0, duplicate: 0, errors: [] };
    tx(db, () => rows.forEach((row, i) => { try {
      const num = v.str(String(row.number ?? ''), 'number', { max: 30, re: /^\d+$/ }), ref = v.str(String(row.reference ?? ''), 'reference', { max: 60 }), amount = v.int(Number(row.amount), 'amount', { min: 1 });
      if (db.prepare('SELECT 1 FROM payments WHERE method=? AND reference=?').get(method, ref)) { out.duplicate++; return; }
      const vo = db.prepare('SELECT id FROM vouchers WHERE number=?').get(num); if (!vo) throw bad('unknown_voucher', 'Voucher number not found');
      pay(ctx.user, ctx.ip, detail(db, vo.id), { amount, method, reference: ref, paid_on: v.date(row.paid_on ?? today(), 'paid_on'), note: 'Imported' }); out.applied++;
    } catch (e) { out.errors.push({ row: i + 1, error: e.message }); } }));
    audit(db, ctx.user, 'fees.import', 'payment', null, { applied: out.applied, duplicate: out.duplicate, errors: out.errors.length }, ctx.ip); return out;
  });
  r.post('/api/fees/fines/apply', FEES, ctx => {
    const per = +getS(db, 'late_fine_per_day', 0), cap = +getS(db, 'late_fine_cap', 0); if (!per) throw bad('no_fine_rule', 'Set a late fine per day in Fee settings first');
    let n = 0, total = 0; const t = today();
    tx(db, () => { for (const x of db.prepare(`${VSEL} WHERE v.status='open' AND v.fine=0 AND v.due_date < ?`).all(t)) {
      const d = decorate(x); if (d.balance <= 0) continue; const days = Math.floor((Date.parse(t) - Date.parse(x.due_date)) / 86400e3); let fine = per * days; if (cap) fine = Math.min(fine, cap);
      db.prepare('UPDATE vouchers SET fine=? WHERE id=?').run(fine, x.id); n++; total += fine; } });
    audit(db, ctx.user, 'fees.fines', 'voucher', null, { vouchers: n, total }, ctx.ip); return { vouchers: n, total };
  });
  r.get('/api/fees/payments.csv', FEES, ctx => {
    const from = v.date(ctx.query.from ?? '2000-01-01', 'from'), to = v.date(ctx.query.to ?? '2999-12-31', 'to');
    const rows = db.prepare(`SELECT p.*, v.number, st.roll, st.name FROM payments p JOIN vouchers v ON v.id=p.voucher_id JOIN students st ON st.id=v.student_id WHERE p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on, p.id`).all(from, to);
    const head = ['Date', 'Voucher', 'Roll', 'Name', 'Amount', 'Method', 'Reference', 'Reversed'];
    return { __raw: true, type: 'text/csv; charset=utf-8', body: '﻿' + [head.map(csvCell).join(','), ...rows.map(x => [x.paid_on, x.number, x.roll, x.name, x.amount, x.method, x.reference ?? '', x.reversed_at ? 'Yes' : ''].map(csvCell).join(','))].join('\r\n'),
      headers: { 'content-disposition': 'attachment; filename="payments.csv"' } };
  });
  r.get('/api/fees/summary', FEES, () => {
    const t = db.prepare(`SELECT COALESCE(SUM(due_total),0) billed, COALESCE(SUM(paid),0) collected FROM (${VSEL} WHERE v.status='open')`).get();
    const od = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(due_total-paid),0) amt FROM (${VSEL} WHERE v.status='open' AND v.due_date < ?) WHERE due_total-paid > 0`).get(today());
    return { billed: t.billed, collected: t.collected, outstanding: t.billed - t.collected, overdue_count: od.n, overdue_amount: od.amt };
  });

  /* ----- student ----- */
  r.get('/api/my/fees', STU, ctx => {
    const st = studentOfUser(db, ctx.user.id);
    const ids = db.prepare("SELECT id FROM vouchers WHERE student_id=? AND status='open' ORDER BY id DESC LIMIT 50").all(st.id);
    return { student: { roll: st.roll, name: st.name }, college: getS(db, 'college_name', 'Government Murray College'), instructions: getS(db, 'fee_instructions', ''), vouchers: ids.map(x => detail(db, x.id)) };
  });
}
