import { v, bad, notFound, now } from '../lib/util.mjs';
import { audit } from '../lib/audit.mjs';
import { tx } from '../db.mjs';
import { studentOfUser } from '../lib/access.mjs';
import { enrollSection, syncStudent } from './admin.mjs';
import { runWarnings } from '../lib/warnings.mjs';

const ADMIN = { auth: ['admin'] }, ANY = { auth: ['admin', 'hod', 'teacher', 'student'], shared: true };
const mins = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const SEL = `SELECT o.id, o.room, o.days, o.start_time, o.duration_min, o.teacher_id, o.section_id, c.code AS course_code, c.name AS course_name, c.dept_id, sec.name AS section_name, sec.term_id, p.code AS program_code, u.name AS teacher_name
  FROM offerings o JOIN courses c ON c.id=o.course_id JOIN sections sec ON sec.id=o.section_id JOIN programs p ON p.id=sec.program_id LEFT JOIN users u ON u.id=o.teacher_id`;

/** Clashes among offerings of the active term(s): same day, overlapping time, and the same teacher, room or section. */
export function findClashes(db) {
  const list = db.prepare(`${SEL} JOIN terms tm ON tm.id=sec.term_id WHERE tm.active=1 AND o.days IS NOT NULL AND o.days<>'' AND o.start_time IS NOT NULL`).all();
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j]; const shared = a.days.split(',').filter(d => b.days.split(',').includes(d)); if (!shared.length) continue;
    const a0 = mins(a.start_time), b0 = mins(b.start_time); if (!(a0 < b0 + b.duration_min && b0 < a0 + a.duration_min)) continue;
    const kinds = []; if (a.teacher_id && a.teacher_id === b.teacher_id) kinds.push('teacher'); if (a.room && a.room.toLowerCase() === (b.room || '').toLowerCase()) kinds.push('room'); if (a.section_id === b.section_id) kinds.push('section');
    for (const kind of kinds) out.push({ kind, days: shared, a: { id: a.id, label: `${a.course_code} ${a.section_name}`, start: a.start_time }, b: { id: b.id, label: `${b.course_code} ${b.section_name}`, start: b.start_time }, who: kind === 'teacher' ? a.teacher_name : kind === 'room' ? a.room : a.section_name });
  }
  return out;
}

export default function (r, db) {
  r.get('/api/timetable', ANY, ctx => {
    const u = ctx.user; let where = '', args = [];
    if (u.role === 'teacher') { where = 'o.teacher_id=?'; args = [u.id]; }
    else if (u.role === 'student') { where = 'o.id IN (SELECT offering_id FROM enrollments WHERE student_id=?)'; args = [studentOfUser(db, u.id).id]; }
    else if (u.role === 'hod') { where = 'c.dept_id=?'; args = [u.dept_id ?? -1]; }
    else if (u.perms !== 'all') return [];
    return db.prepare(`${SEL} JOIN terms tm ON tm.id=sec.term_id WHERE tm.active=1 AND o.days IS NOT NULL AND o.days<>'' ${where ? 'AND ' + where : ''} ORDER BY o.start_time LIMIT 500`).all(...args);
  });
  r.get('/api/admin/timetable/clashes', { auth: ['admin', 'hod'] }, ctx => { const all = findClashes(db); return ctx.user.role === 'hod' ? all.filter(c => db.prepare('SELECT 1 FROM offerings o JOIN courses c ON c.id=o.course_id WHERE o.id=? AND c.dept_id=?').get(c.a.id, ctx.user.dept_id ?? -1)) : all; });

  /** Move a whole term's sections forward: creates matching sections in the new term (semester +1) and moves their active students. Old offerings, attendance and results stay as they were. */
  r.post('/api/admin/rollover', ADMIN, ctx => {
    const from = v.int(ctx.body.from_term_id, 'from_term_id', { min: 1 }), to = v.int(ctx.body.to_term_id, 'to_term_id', { min: 1 });
    if (from === to) throw bad('same_term', 'Choose two different terms');
    for (const id of [from, to]) if (!db.prepare('SELECT 1 FROM terms WHERE id=?').get(id)) throw notFound('Term not found');
    const only = Array.isArray(ctx.body.section_ids) ? new Set(ctx.body.section_ids.map(Number)) : null;
    const secs = db.prepare('SELECT * FROM sections WHERE term_id=?').all(from).filter(s => !only || only.has(s.id));
    const out = { sections: 0, students: 0, graduated: 0 };
    tx(db, () => { for (const s of secs) {
      const maxSem = +(db.prepare("SELECT value FROM settings WHERE key='max_semester'").get()?.value || 8), next = s.semester_no ? s.semester_no + 1 : null;
      const moving = db.prepare("SELECT id FROM students WHERE section_id=? AND status='active'").all(s.id);
      if (next && next > maxSem) { for (const st of moving) { db.prepare("UPDATE students SET status='left' WHERE id=?").run(st.id); out.graduated++; } continue; }
      let nid = db.prepare('SELECT id FROM sections WHERE program_id=? AND term_id=? AND name=?').get(s.program_id, to, s.name)?.id;
      if (!nid) nid = Number(db.prepare('INSERT INTO sections(program_id,term_id,name,semester_no) VALUES (?,?,?,?)').run(s.program_id, to, s.name, next).lastInsertRowid);
      for (const st of moving) { db.prepare('UPDATE students SET section_id=? WHERE id=?').run(nid, st.id); syncStudent(db, st.id); out.students++; }
      out.sections++;
    } });
    audit(db, ctx.user, 'rollover', 'term', to, { from, ...out }, ctx.ip); return out;
  });
  r.post('/api/admin/warnings/run', ADMIN, ctx => { const res = runWarnings(db); audit(db, ctx.user, 'warnings.run', 'system', null, res, ctx.ip); return res; });
}
