import { v, bad, forbidden, notFound, now, today } from '../lib/util.mjs';
import { audit } from '../lib/audit.mjs';
import { tx } from '../db.mjs';
import { studentOfUser } from '../lib/access.mjs';

const STU = { auth: ['student'] }, DECIDE = { auth: ['hod', 'admin'] };
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3) + 1;
const SEL = `SELECT l.*, st.roll, st.name AS student_name, st.user_id AS student_user, p.dept_id FROM leaves l JOIN students st ON st.id=l.student_id
  LEFT JOIN sections sec ON sec.id=st.section_id LEFT JOIN programs p ON p.id=sec.program_id`;
const notify = (db, userId, title, body) => { if (userId) db.prepare('INSERT INTO notifications(user_id,title,body,url,created_at) VALUES (?,?,?,?,?)').run(userId, title, body, '/portal/#/leave', now()); };

export default function (r, db) {
  r.post('/api/leaves', STU, ctx => {
    const st = studentOfUser(db, ctx.user.id), from = v.date(ctx.body.from, 'from'), to = v.date(ctx.body.to, 'to'), reason = v.str(ctx.body.reason, 'reason', { min: 5, max: 500 });
    if (to < from) throw bad('bad_range', 'The end date is before the start date');
    if (days(from, to) > 60) throw bad('too_long', 'A leave can be at most 60 days. Split it.');
    if (from < new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)) throw bad('too_old', 'Leave can be requested for the last 30 days at most');
    if (db.prepare("SELECT 1 FROM leaves WHERE student_id=? AND status IN ('pending','approved') AND from_date<=? AND to_date>=?").get(st.id, to, from)) throw bad('overlap', 'You already have a leave in these dates');
    const id = Number(db.prepare('INSERT INTO leaves(student_id,from_date,to_date,reason,created_at) VALUES (?,?,?,?,?)').run(st.id, from, to, reason, now()).lastInsertRowid);
    audit(db, ctx.user, 'leave.create', 'leave', id, { from, to }, ctx.ip); ctx.status = 201; return { id };
  });
  r.get('/api/my/leaves', STU, ctx => db.prepare('SELECT id,from_date,to_date,reason,status,decision_note,created_at FROM leaves WHERE student_id=? ORDER BY id DESC LIMIT 50').all(studentOfUser(db, ctx.user.id).id));
  r.post('/api/leaves/:id/cancel', STU, ctx => {
    const st = studentOfUser(db, ctx.user.id), id = v.int(ctx.params.id, 'id', { min: 1 }), l = db.prepare('SELECT * FROM leaves WHERE id=? AND student_id=?').get(id, st.id);
    if (!l) throw notFound(); if (l.status !== 'pending') throw bad('wrong_state', 'Only pending requests can be cancelled');
    db.prepare("UPDATE leaves SET status='cancelled' WHERE id=?").run(id); audit(db, ctx.user, 'leave.cancel', 'leave', id, null, ctx.ip); return { ok: true };
  });
  r.get('/api/leaves', DECIDE, ctx => {
    const status = ctx.query.status ? v.oneOf(ctx.query.status, 'status', ['pending', 'approved', 'rejected', 'cancelled']) : 'pending';
    const where = ctx.user.role === 'hod' ? 'AND p.dept_id=?' : '', args = ctx.user.role === 'hod' ? [ctx.user.dept_id ?? -1] : [];
    return db.prepare(`${SEL} WHERE l.status=? ${where} ORDER BY l.from_date, l.id LIMIT 300`).all(status, ...args).map(x => ({ id: x.id, roll: x.roll, student_name: x.student_name, from_date: x.from_date, to_date: x.to_date, reason: x.reason, status: x.status, decision_note: x.decision_note, created_at: x.created_at }));
  });
  r.post('/api/leaves/:id/decide', DECIDE, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }), l = db.prepare(`${SEL} WHERE l.id=?`).get(id); if (!l) throw notFound();
    if (ctx.user.role === 'hod' && (ctx.user.dept_id == null || l.dept_id !== ctx.user.dept_id)) throw forbidden('Not your department');
    if (l.status !== 'pending') throw bad('wrong_state', 'This request was already decided');
    const decision = v.oneOf(ctx.body.decision, 'decision', ['approved', 'rejected']), note = v.str(ctx.body.note, 'note', { max: 300, optional: true });
    if (decision === 'rejected' && !note) throw bad('note_required', 'Write a short reason for the rejection');
    let converted = 0;
    tx(db, () => {
      db.prepare('UPDATE leaves SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?').run(decision, ctx.user.id, now(), note, id);
      if (decision === 'approved') {
        const where = "student_id=? AND status='A' AND session_id IN (SELECT id FROM lecture_sessions WHERE date BETWEEN ? AND ?)";
        converted = db.prepare(`SELECT COUNT(*) c FROM attendance WHERE ${where}`).get(l.student_id, l.from_date, l.to_date).c;   // counted first: changes() would also include trigger writes
        db.prepare(`UPDATE attendance SET status='L', updated_at=? WHERE ${where}`).run(now(), l.student_id, l.from_date, l.to_date);
      }
      notify(db, l.student_user, `Leave ${decision}`, `${l.from_date} to ${l.to_date}${note ? ': ' + note : ''}`);
    });
    audit(db, ctx.user, 'leave.' + decision, 'leave', id, { converted }, ctx.ip); return { status: decision, converted };
  });
}
