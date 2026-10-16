/* Certificates with public verification, complaints, anonymous teacher feedback, student data export/anonymise, at-risk list. */
import { randomInt } from 'node:crypto';
import { v, bad, forbidden, notFound, HttpError, now, today } from '../lib/util.mjs';
import { audit } from '../lib/audit.mjs';
import { tx } from '../db.mjs';
import { notify } from '../lib/notify.mjs';
import { studentOfUser } from '../lib/access.mjs';
import { Limiter, destroyAllSessions } from '../lib/auth.mjs';
import { getSettings, perOfferingForStudent, perStudentForDept, decorate } from '../lib/stats.mjs';

const STU = { auth: ['student'] }, STAFF = { auth: ['admin', 'hod'] }, ADMIN = { auth: ['admin'] };
const verifyLimit = new Limiter(30, 60e3), complaintLimit = new Limiter(5, 24 * 3600e3);
setInterval(() => { verifyLimit.sweep(); complaintLimit.sweep(); }, 60e3).unref();
export const CERT_KINDS = ['bonafide', 'character', 'fee_clearance', 'attendance'];
export const SURVEY_QUESTIONS = ['prepared', 'clear', 'punctual', 'fair', 'respect', 'overall'];
const MIN_ANSWERS = 5;                                           // below this a teacher's report is hidden so nobody can be identified
const SAFE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => SAFE[randomInt(SAFE.length)]).join('')).join('-');
const setting = (db, k, d) => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? d;

const studentCtx = (db, id) => db.prepare(`SELECT st.*, sec.name AS section_name, sec.semester_no, tm.name AS term_name, p.name AS program_name, p.dept_id, d.name AS dept_name FROM students st
  LEFT JOIN sections sec ON sec.id=st.section_id LEFT JOIN terms tm ON tm.id=sec.term_id LEFT JOIN programs p ON p.id=sec.program_id LEFT JOIN departments d ON d.id=p.dept_id WHERE st.id=?`).get(id);
const openBalance = (db, studentId) => db.prepare(`SELECT COALESCE(SUM(v.gross - v.discount + v.fine - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.voucher_id=v.id AND p.reversed_at IS NULL),0)),0) AS b FROM vouchers v WHERE v.student_id=? AND v.status='open'`).get(studentId).b;

export default function (r, db) {
  /* ----- certificates ----- */
  r.post('/api/certificates', STU, ctx => {
    const st = studentOfUser(db, ctx.user.id), kind = v.oneOf(ctx.body.kind, 'kind', CERT_KINDS), purpose = v.str(ctx.body.purpose, 'purpose', { max: 150, optional: true });
    if (db.prepare("SELECT COUNT(*) c FROM cert_requests WHERE student_id=? AND status='pending'").get(st.id).c >= 3) throw bad('too_many', 'You already have 3 pending requests');
    const id = Number(db.prepare('INSERT INTO cert_requests(student_id,kind,purpose,created_at) VALUES (?,?,?,?)').run(st.id, kind, purpose, now()).lastInsertRowid); audit(db, ctx.user, 'cert.request', 'cert', id, { kind }, ctx.ip); ctx.status = 201; return { id };
  });
  r.get('/api/my/certificates', STU, ctx => db.prepare('SELECT id,kind,purpose,status,code,issued_at,decision_note,created_at FROM cert_requests WHERE student_id=? ORDER BY id DESC LIMIT 50').all(studentOfUser(db, ctx.user.id).id));
  r.get('/api/certificate-requests', STAFF, ctx => { const st = ctx.query.status ? v.oneOf(ctx.query.status, 'status', ['pending', 'issued', 'rejected']) : 'pending';
    const dept = ctx.user.role === 'hod' ? ' AND p.dept_id=?' : '', args = ctx.user.role === 'hod' ? [ctx.user.dept_id ?? -1] : [];
    return db.prepare(`SELECT c.id,c.kind,c.purpose,c.status,c.code,c.created_at,c.issued_at,stu.roll,stu.name AS student_name FROM cert_requests c JOIN students stu ON stu.id=c.student_id LEFT JOIN sections sec ON sec.id=stu.section_id LEFT JOIN programs p ON p.id=sec.program_id WHERE c.status=?${dept} ORDER BY c.id DESC LIMIT 200`).all(st, ...args); });
  r.post('/api/certificate-requests/:id/decide', STAFF, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }), c = db.prepare('SELECT * FROM cert_requests WHERE id=?').get(id); if (!c) throw notFound(); if (c.status !== 'pending') throw bad('wrong_state', 'Already decided');
    const s = studentCtx(db, c.student_id); if (ctx.user.role === 'hod' && (ctx.user.dept_id == null || s.dept_id !== ctx.user.dept_id)) throw forbidden('Not your department');
    const decision = v.oneOf(ctx.body.decision, 'decision', ['issued', 'rejected']), note = v.str(ctx.body.note, 'note', { max: 300, optional: true }); if (decision === 'rejected' && !note) throw bad('note_required', 'Write a short reason');
    let code = null, snapshot = null;
    if (decision === 'issued') {
      if (c.kind === 'fee_clearance') { const b = openBalance(db, s.id); if (b > 0) throw bad('fees_due', `The student still owes Rs ${b}`); }
      code = newCode(); const snap = { college: setting(db, 'college_name', 'Government Murray College'), name: s.name, roll: s.roll, program: s.program_name, department: s.dept_name, section: s.section_name, term: s.term_name, semester_no: s.semester_no, guardian: s.guardian_name, kind: c.kind, purpose: c.purpose, issued_on: today(), issued_by: ctx.user.name };
      if (c.kind === 'attendance') { const set = getSettings(db), stats = new Map(perOfferingForStudent(db, s.id).map(x => [x.offering_id, x]));
        snap.attendance = db.prepare('SELECT o.id, o.min_pct, cr.code, cr.name FROM enrollments e JOIN offerings o ON o.id=e.offering_id JOIN courses cr ON cr.id=o.course_id WHERE e.student_id=? ORDER BY cr.code').all(s.id).map(o => { const d = decorate(stats.get(o.id) || { P: 0, A: 0, L: 0, T: 0, total: 0 }, o.min_pct, set); return { code: o.code, name: o.name, pct: d.pct, total: d.total }; }); }
      snapshot = JSON.stringify(snap);
    }
    db.prepare('UPDATE cert_requests SET status=?, code=?, issued_by=?, issued_at=?, decision_note=?, snapshot=? WHERE id=?').run(decision, code, ctx.user.id, now(), note, snapshot, id);
    notify(db, s.user_id, decision === 'issued' ? 'Certificate ready' : 'Certificate request rejected', decision === 'issued' ? 'You can view and print it now.' : note, '/portal/#/certificates'); audit(db, ctx.user, 'cert.' + decision, 'cert', id, { kind: c.kind }, ctx.ip); return { status: decision, code };
  });
  r.get('/api/certificates/:id', { auth: ['student', 'admin', 'hod'] }, ctx => {
    const c = db.prepare("SELECT * FROM cert_requests WHERE id=? AND status='issued'").get(v.int(ctx.params.id, 'id', { min: 1 })); if (!c) throw notFound();
    if (ctx.user.role === 'student' && c.student_id !== studentOfUser(db, ctx.user.id).id) throw notFound();
    if (ctx.user.role === 'hod' && studentCtx(db, c.student_id).dept_id !== ctx.user.dept_id) throw forbidden('Not your department');
    return { id: c.id, code: c.code, ...JSON.parse(c.snapshot) };
  });
  /** Public: anyone holding a certificate can check it. Shows the least needed to confirm it is genuine. */
  r.get('/api/verify/:code', { auth: false }, ctx => {
    if (!verifyLimit.hit(ctx.ip)) throw new HttpError(429, 'too_many', 'Too many checks. Try again in a minute.');
    const code = String(ctx.params.code).toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') ?? ''; const c = db.prepare("SELECT kind,snapshot,issued_at FROM cert_requests WHERE code=? AND status='issued'").get(code);
    if (!c) return { valid: false }; const s = JSON.parse(c.snapshot); return { valid: true, kind: c.kind, name: s.name, roll: s.roll, program: s.program, college: s.college, issued_on: s.issued_on };
  });

  /* ----- complaints ----- */
  r.post('/api/complaints', STU, ctx => {
    const st = studentOfUser(db, ctx.user.id); if (!complaintLimit.hit(st.id)) throw new HttpError(429, 'too_many', 'You can send 5 messages a day');
    const category = v.oneOf(ctx.body.category, 'category', ['academic', 'fees', 'harassment', 'facilities', 'other']), body = v.str(ctx.body.body, 'body', { min: 10, max: 1500 });
    const id = Number(db.prepare('INSERT INTO complaints(student_id,hide_name,category,body,created_at) VALUES (?,?,?,?,?)').run(st.id, ctx.body.hide_name === true ? 1 : 0, category, body, now()).lastInsertRowid); audit(db, ctx.user, 'complaint.create', 'complaint', id, { category }, ctx.ip); ctx.status = 201; return { id };
  });
  r.get('/api/my/complaints', STU, ctx => db.prepare('SELECT id,category,body,status,response,created_at,updated_at FROM complaints WHERE student_id=? ORDER BY id DESC LIMIT 50').all(studentOfUser(db, ctx.user.id).id));
  const compScope = u => (u.role === 'admin' ? ['1=1', []] : ["c.category IN ('academic','facilities','other','fees') AND p.dept_id=?", [u.dept_id ?? -1]]);    // harassment goes to the admin only
  r.get('/api/complaints', STAFF, ctx => { const [w, a] = compScope(ctx.user), st = ctx.query.status ? v.oneOf(ctx.query.status, 'status', ['open', 'in_progress', 'resolved']) : 'open';
    return db.prepare(`SELECT c.id,c.category,c.body,c.status,c.response,c.created_at,c.hide_name, CASE WHEN c.hide_name=1 THEN NULL ELSE stu.roll END AS roll, CASE WHEN c.hide_name=1 THEN NULL ELSE stu.name END AS student_name
      FROM complaints c LEFT JOIN students stu ON stu.id=c.student_id LEFT JOIN sections sec ON sec.id=stu.section_id LEFT JOIN programs p ON p.id=sec.program_id WHERE c.status=? AND ${w} ORDER BY c.id DESC LIMIT 200`).all(st, ...a); });
  r.post('/api/complaints/:id/respond', STAFF, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }), [w, a] = compScope(ctx.user);
    const c = db.prepare(`SELECT c.*, stu.user_id AS uid FROM complaints c LEFT JOIN students stu ON stu.id=c.student_id LEFT JOIN sections sec ON sec.id=stu.section_id LEFT JOIN programs p ON p.id=sec.program_id WHERE c.id=? AND ${w}`).get(id, ...a); if (!c) throw notFound();
    const status = v.oneOf(ctx.body.status, 'status', ['in_progress', 'resolved']), response = v.str(ctx.body.response, 'response', { min: 3, max: 600 });
    db.prepare('UPDATE complaints SET status=?, response=?, handled_by=?, updated_at=? WHERE id=?').run(status, response, ctx.user.id, now(), id); notify(db, c.uid, 'Reply to your message', response, '/portal/#/complaints'); audit(db, ctx.user, 'complaint.respond', 'complaint', id, { status }, ctx.ip); return { status };
  });

  /* ----- anonymous teacher feedback ----- */
  r.post('/api/admin/surveys', ADMIN, ctx => {
    const title = v.str(ctx.body.title, 'title', { min: 3, max: 100 }), opens = v.date(ctx.body.opens, 'opens'), closes = v.date(ctx.body.closes, 'closes'), term = v.int(ctx.body.term_id, 'term_id', { min: 1, optional: true });
    if (closes < opens) throw bad('bad_range', 'Closing date is before the opening date');
    const id = Number(db.prepare('INSERT INTO surveys(title,term_id,opens,closes,created_at) VALUES (?,?,?,?,?)').run(title, term, opens, closes, now()).lastInsertRowid); audit(db, ctx.user, 'survey.create', 'survey', id, { title }, ctx.ip); ctx.status = 201; return { id };
  });
  r.get('/api/admin/surveys', ADMIN, () => db.prepare('SELECT s.*, (SELECT COUNT(*) FROM survey_answers a WHERE a.survey_id=s.id) AS answers FROM surveys s ORDER BY s.id DESC LIMIT 50').all());
  const openSurveys = () => db.prepare('SELECT * FROM surveys WHERE opens<=? AND closes>=? ORDER BY id DESC').all(today(), today());
  r.get('/api/my/surveys', STU, ctx => {
    const st = studentOfUser(db, ctx.user.id);
    return openSurveys().map(s => ({ id: s.id, title: s.title, closes: s.closes, courses: db.prepare(`SELECT o.id AS offering_id, c.code, c.name, u.name AS teacher_name, EXISTS(SELECT 1 FROM survey_done d WHERE d.survey_id=? AND d.offering_id=o.id AND d.student_id=?) AS done
      FROM enrollments e JOIN offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id JOIN sections sec ON sec.id=o.section_id LEFT JOIN users u ON u.id=o.teacher_id WHERE e.student_id=? ${s.term_id ? 'AND sec.term_id=?' : 'AND sec.term_id IN (SELECT id FROM terms WHERE active=1)'} ORDER BY c.code`).all(s.id, st.id, st.id, ...(s.term_id ? [s.term_id] : [])).map(x => ({ ...x, done: !!x.done })) }));
  });
  r.post('/api/surveys/:id/respond', STU, ctx => {
    const st = studentOfUser(db, ctx.user.id), sv = openSurveys().find(s => s.id === v.int(ctx.params.id, 'id', { min: 1 })); if (!sv) throw bad('closed', 'This survey is not open');
    const off = v.int(ctx.body.offering_id, 'offering_id', { min: 1 }); if (!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND offering_id=?').get(st.id, off)) throw forbidden('You are not enrolled in this course');
    const rt = ctx.body.ratings || {}, ratings = {}; for (const q of SURVEY_QUESTIONS) ratings[q] = v.int(rt[q], q, { min: 1, max: 5 });
    const comment = v.str(ctx.body.comment, 'comment', { max: 500, optional: true });
    tx(db, () => { const done = db.prepare('INSERT OR IGNORE INTO survey_done(survey_id,offering_id,student_id) VALUES (?,?,?)').run(sv.id, off, st.id); if (!done.changes) throw new HttpError(409, 'duplicate', 'You already answered for this course');
      db.prepare('INSERT INTO survey_answers(survey_id,offering_id,ratings,comment,day) VALUES (?,?,?,?,?)').run(sv.id, off, JSON.stringify(ratings), comment, today()); });   // the answer row carries no student id, only the date
    return { ok: true };
  });
  r.get('/api/surveys', { auth: ['teacher', 'hod', 'admin'] }, () => db.prepare('SELECT id,title,opens,closes FROM surveys ORDER BY id DESC LIMIT 30').all());
  r.get('/api/surveys/:id/report', { auth: ['teacher', 'hod', 'admin'] }, ctx => {
    const sid = v.int(ctx.params.id, 'id', { min: 1 }), u = ctx.user;
    const offs = db.prepare(`SELECT o.id, c.code, c.name, sec.name AS section_name, o.teacher_id, c.dept_id, t.name AS teacher_name FROM offerings o JOIN courses c ON c.id=o.course_id JOIN sections sec ON sec.id=o.section_id LEFT JOIN users t ON t.id=o.teacher_id
      WHERE o.id IN (SELECT DISTINCT offering_id FROM survey_answers WHERE survey_id=?)`).all(sid).filter(o => u.role === 'admin' || (u.role === 'teacher' && o.teacher_id === u.id) || (u.role === 'hod' && o.dept_id === u.dept_id));
    return offs.map(o => { const rows = db.prepare('SELECT ratings, comment FROM survey_answers WHERE survey_id=? AND offering_id=?').all(sid, o.id), n = rows.length;
      if (n < MIN_ANSWERS) return { offering_id: o.id, course: `${o.code} ${o.section_name}`, teacher: o.teacher_name, n, hidden: true };
      const avg = Object.fromEntries(SURVEY_QUESTIONS.map(q => [q, Math.round(rows.reduce((a, x) => a + JSON.parse(x.ratings)[q], 0) / n * 100) / 100]));
      return { offering_id: o.id, course: `${o.code} ${o.section_name}`, teacher: o.teacher_name, n, hidden: false, avg, comments: rows.map(x => x.comment).filter(Boolean) }; });
  });

  /* ----- privacy tools: a student's data on request ----- */
  r.get('/api/admin/students/:id/export', ADMIN, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }), s = db.prepare('SELECT * FROM students WHERE id=?').get(id); if (!s) throw notFound();
    const q = (sql, ...a) => db.prepare(sql).all(...a); audit(db, ctx.user, 'student.export', 'student', id, null, ctx.ip);
    return { exported_at: new Date().toISOString(), student: s, user: s.user_id ? q('SELECT id,email,name,role,created_at,last_login FROM users WHERE id=?', s.user_id)[0] : null,
      attendance: q('SELECT a.session_id, ls.date, a.status, a.method FROM attendance a JOIN lecture_sessions ls ON ls.id=a.session_id WHERE a.student_id=? ORDER BY ls.date', id), marks: q('SELECT m.component_id, m.obtained, m.absent FROM marks m WHERE m.student_id=?', id),
      results: q('SELECT * FROM results WHERE student_id=?', id), vouchers: q('SELECT * FROM vouchers WHERE student_id=?', id), payments: q('SELECT p.* FROM payments p JOIN vouchers v ON v.id=p.voucher_id WHERE v.student_id=?', id),
      leaves: q('SELECT * FROM leaves WHERE student_id=?', id), corrections: q('SELECT * FROM corrections WHERE student_id=?', id), certificates: q('SELECT id,kind,purpose,status,code,created_at FROM cert_requests WHERE student_id=?', id), complaints: q('SELECT id,category,body,status,response,created_at FROM complaints WHERE student_id=?', id) };
  });
  /** Removes personal details but keeps the academic and financial record the college must retain (results, attendance totals, vouchers). */
  r.post('/api/admin/students/:id/anonymize', ADMIN, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }), reason = v.str(ctx.body.reason, 'reason', { min: 5, max: 200 }), s = db.prepare('SELECT * FROM students WHERE id=?').get(id); if (!s) throw notFound();
    tx(db, () => {
      db.prepare("UPDATE students SET name='Anonymized student', roll=?, phone=NULL, email=NULL, guardian_name=NULL, guardian_phone=NULL, address=NULL, status='left', user_id=NULL WHERE id=?").run('ANON-' + id, id);
      if (s.user_id) { destroyAllSessions(db, s.user_id); db.prepare('DELETE FROM push_subs WHERE user_id=?').run(s.user_id); db.prepare('DELETE FROM notifications WHERE user_id=?').run(s.user_id); db.prepare('DELETE FROM users WHERE id=?').run(s.user_id); }
      db.prepare("UPDATE complaints SET body='[removed on request]', response=NULL WHERE student_id=?").run(id); db.prepare("UPDATE leaves SET reason='[removed]' WHERE student_id=?").run(id); db.prepare("UPDATE corrections SET note='[removed]' WHERE student_id=?").run(id);
      db.prepare('UPDATE cert_requests SET purpose=NULL, snapshot=NULL WHERE student_id=?').run(id);
    });
    audit(db, ctx.user, 'student.anonymize', 'student', id, { reason }, ctx.ip); return { ok: true };
  });

  /* ----- early warning for HODs ----- */
  r.get('/api/department/at-risk', STAFF, ctx => {
    const dept = ctx.user.role === 'hod' ? ctx.user.dept_id : v.int(ctx.query.dept_id, 'dept_id', { min: 1 }); if (dept == null) throw forbidden('No department is assigned to your account');
    const set = getSettings(db), offs = new Map(db.prepare('SELECT o.id, o.min_pct FROM offerings o JOIN courses c ON c.id=o.course_id WHERE c.dept_id=?').all(dept).map(o => [o.id, o])), risk = new Map();
    const add = (sid, k) => { const x = risk.get(sid) || { low: 0, near: 0, fails: 0 }; x[k]++; risk.set(sid, x); };
    for (const x of perStudentForDept(db, dept)) { const o = offs.get(x.offering_id); if (!o) continue; const d = decorate(x, o.min_pct, set); if (d.status === 'bad') add(x.student_id, 'low'); else if (d.pct !== null && d.pct < d.min + 5) add(x.student_id, 'near'); }
    for (const x of db.prepare('SELECT r.student_id FROM results r JOIN offerings o ON o.id=r.offering_id JOIN courses c ON c.id=o.course_id WHERE c.dept_id=? AND r.gp=0').all(dept)) add(x.student_id, 'fails');
    const names = new Map(db.prepare("SELECT id,roll,name,phone FROM students WHERE status='active'").all().map(s => [s.id, s]));
    return [...risk].filter(([sid]) => names.has(sid)).map(([sid, x]) => ({ ...names.get(sid), ...x, score: x.low * 3 + x.fails * 3 + x.near })).sort((a, b) => b.score - a.score).slice(0, 200);
  });
}
