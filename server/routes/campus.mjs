/* Calendar and holidays, attendance correction requests, student contact details. */
import { v, bad, forbidden, notFound, HttpError, now, today } from '../lib/util.mjs';
import { audit } from '../lib/audit.mjs';
import { tx } from '../db.mjs';
import { notify } from '../lib/notify.mjs';
import { loadOffering, studentOfUser } from '../lib/access.mjs';

const ADMIN = { auth: ['admin'] }, STU = { auth: ['student'] }, ANY = { auth: ['admin', 'hod', 'teacher', 'student'], shared: true }, DECIDE = { auth: ['teacher', 'hod', 'admin'] };
const KINDS = ['holiday', 'exam', 'event', 'deadline'];
export const holidayOn = (db, date) => db.prepare("SELECT title FROM calendar_events WHERE kind='holiday' AND date<=? AND COALESCE(end_date,date)>=? LIMIT 1").get(date, date);

export default function (r, db) {
  /* ----- calendar ----- */
  r.get('/api/calendar', ANY, ctx => {
    const from = v.date(ctx.query.from ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), 'from'), to = v.date(ctx.query.to ?? new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10), 'to');
    return db.prepare('SELECT id,date,end_date,title,kind FROM calendar_events WHERE COALESCE(end_date,date)>=? AND date<=? ORDER BY date,id LIMIT 500').all(from, to);
  });
  const evBody = b => { const date = v.date(b.date, 'date'), end = v.date(b.end_date, 'end_date', { optional: true }); if (end && end < date) throw bad('bad_range', 'The end date is before the start date');
    return { date, end, title: v.str(b.title, 'title', { min: 2, max: 120 }), kind: v.oneOf(b.kind ?? 'event', 'kind', KINDS) }; };
  r.post('/api/admin/calendar', ADMIN, ctx => { const e = evBody(ctx.body); const id = Number(db.prepare('INSERT INTO calendar_events(date,end_date,title,kind,created_by,created_at) VALUES (?,?,?,?,?,?)').run(e.date, e.end, e.title, e.kind, ctx.user.id, now()).lastInsertRowid);
    audit(db, ctx.user, 'calendar.create', 'calendar', id, e, ctx.ip); ctx.status = 201; return { id }; });
  r.put('/api/admin/calendar/:id', ADMIN, ctx => { const id = v.int(ctx.params.id, 'id', { min: 1 }); if (!db.prepare('SELECT 1 FROM calendar_events WHERE id=?').get(id)) throw notFound(); const e = evBody(ctx.body);
    db.prepare('UPDATE calendar_events SET date=?, end_date=?, title=?, kind=? WHERE id=?').run(e.date, e.end, e.title, e.kind, id); audit(db, ctx.user, 'calendar.update', 'calendar', id, e, ctx.ip); return { ok: true }; });
  r.del('/api/admin/calendar/:id', ADMIN, ctx => { const id = v.int(ctx.params.id, 'id', { min: 1 }); db.prepare('DELETE FROM calendar_events WHERE id=?').run(id); audit(db, ctx.user, 'calendar.delete', 'calendar', id, null, ctx.ip); return { ok: true }; });

  /* ----- attendance corrections: a student says "I was present", the course teacher decides ----- */
  r.post('/api/corrections', STU, ctx => {
    const st = studentOfUser(db, ctx.user.id), sid = v.int(ctx.body.session_id, 'session_id', { min: 1 }), want = v.oneOf(ctx.body.status ?? 'P', 'status', ['P', 'L', 'T']), note = v.str(ctx.body.note, 'note', { min: 5, max: 300 });
    const row = db.prepare(`SELECT s.date, a.status FROM lecture_sessions s JOIN enrollments e ON e.offering_id=s.offering_id AND e.student_id=? LEFT JOIN attendance a ON a.session_id=s.id AND a.student_id=e.student_id WHERE s.id=?`).get(st.id, sid);
    if (!row) throw notFound('Lecture not found'); if (row.status !== 'A') throw bad('not_absent', 'Corrections are only for lectures where you are marked absent');
    if (row.date < new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)) throw bad('too_old', 'Corrections can be requested within 7 days of the lecture');
    try { const id = Number(db.prepare('INSERT INTO corrections(session_id,student_id,requested_status,note,created_at) VALUES (?,?,?,?,?)').run(sid, st.id, want, note, now()).lastInsertRowid);
      const t = db.prepare('SELECT o.teacher_id, c.code FROM lecture_sessions s JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id WHERE s.id=?').get(sid); notify(db, t.teacher_id, `Attendance correction: ${t.code}`, `${st.roll} says they were present on ${row.date}.`, '/portal/#/corrections');
      audit(db, ctx.user, 'correction.create', 'correction', id, { sid }, ctx.ip); ctx.status = 201; return { id }; }
    catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'duplicate', 'You already sent a correction for this lecture'); throw e; }
  });
  r.get('/api/my/corrections', STU, ctx => db.prepare(`SELECT k.id, k.session_id, k.requested_status, k.note, k.status, k.decision_note, s.date, c.code AS course_code FROM corrections k JOIN lecture_sessions s ON s.id=k.session_id JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id WHERE k.student_id=? ORDER BY k.id DESC LIMIT 50`).all(studentOfUser(db, ctx.user.id).id));
  const scopeSql = u => (u.role === 'teacher' ? ['o.teacher_id=?', [u.id]] : u.role === 'hod' ? ['c.dept_id=?', [u.dept_id ?? -1]] : ['1=1', []]);
  r.get('/api/corrections', DECIDE, ctx => { const [w, a] = scopeSql(ctx.user), st = ctx.query.status ? v.oneOf(ctx.query.status, 'status', ['pending', 'approved', 'rejected']) : 'pending';
    return db.prepare(`SELECT k.id, k.requested_status, k.note, k.status, k.decision_note, s.date, c.code AS course_code, sec.name AS section_name, stu.roll, stu.name AS student_name FROM corrections k JOIN lecture_sessions s ON s.id=k.session_id JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id JOIN sections sec ON sec.id=o.section_id JOIN students stu ON stu.id=k.student_id WHERE k.status=? AND ${w} ORDER BY s.date DESC LIMIT 200`).all(st, ...a); });
  r.post('/api/corrections/:id/decide', DECIDE, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }), k = db.prepare(`SELECT k.*, s.offering_id, s.date, stu.user_id AS student_user FROM corrections k JOIN lecture_sessions s ON s.id=k.session_id JOIN students stu ON stu.id=k.student_id WHERE k.id=?`).get(id); if (!k) throw notFound();
    const o = loadOffering(db, k.offering_id), u = ctx.user; if (!(u.role === 'admin' || (u.role === 'teacher' && o.teacher_id === u.id) || (u.role === 'hod' && u.dept_id != null && o.dept_id === u.dept_id))) throw forbidden('Not your course');
    if (k.status !== 'pending') throw bad('wrong_state', 'Already decided'); const decision = v.oneOf(ctx.body.decision, 'decision', ['approved', 'rejected']), note = v.str(ctx.body.note, 'note', { max: 300, optional: true });
    if (decision === 'rejected' && !note) throw bad('note_required', 'Write a short reason');
    tx(db, () => {
      db.prepare('UPDATE corrections SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?').run(decision, u.id, now(), note, id);
      if (decision === 'approved') { const cur = db.prepare('SELECT status FROM attendance WHERE session_id=? AND student_id=?').get(k.session_id, k.student_id);
        db.prepare("UPDATE attendance SET status=?, method='manual', marked_by=?, updated_at=? WHERE session_id=? AND student_id=?").run(k.requested_status, u.id, now(), k.session_id, k.student_id);
        audit(db, u, 'attendance.change', 'attendance', `${k.session_id}:${k.student_id}`, { from: cur && cur.status, to: k.requested_status, via: 'correction' }, ctx.ip); }
      notify(db, k.student_user, `Correction ${decision}`, `${o.course_code} on ${k.date}${note ? ': ' + note : ''}`, '/portal/#/me');
    });
    audit(db, u, 'correction.' + decision, 'correction', id, null, ctx.ip); return { status: decision };
  });

  /* ----- student contact details ----- */
  r.get('/api/my/profile', STU, ctx => { const s = studentOfUser(db, ctx.user.id); const x = db.prepare('SELECT st.roll, st.name, st.phone, st.email, st.guardian_name, st.guardian_phone, st.address, sec.name AS section_name, p.name AS program_name FROM students st LEFT JOIN sections sec ON sec.id=st.section_id LEFT JOIN programs p ON p.id=sec.program_id WHERE st.id=?').get(s.id); return x; });
  r.put('/api/my/profile', STU, ctx => {
    const s = studentOfUser(db, ctx.user.id), b = ctx.body, sets = [], vals = [];
    const f = { phone: x => v.phone(x), email: x => (x === '' || x == null ? null : v.email(x, 'email')), guardian_name: x => v.str(x, 'guardian_name', { max: 100, optional: true }), guardian_phone: x => v.phone(x), address: x => v.str(x, 'address', { max: 200, optional: true }) };
    for (const k of Object.keys(f)) if (k in b) { sets.push(k + '=?'); vals.push(f[k](b[k])); }
    if (!sets.length) throw bad('nothing_to_update', 'No fields to update'); db.prepare(`UPDATE students SET ${sets.join(',')} WHERE id=?`).run(...vals, s.id); audit(db, ctx.user, 'profile.update', 'student', s.id, { fields: Object.keys(b) }, ctx.ip); return { ok: true };
  });
}
