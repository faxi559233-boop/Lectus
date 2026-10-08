import { HttpError, forbidden, notFound } from './util.mjs';

export function loadOffering(db, id) {
  const o = db.prepare(`SELECT o.*, c.code AS course_code, c.name AS course_name, c.dept_id, sec.name AS section_name, sec.program_id, sec.term_id,
      p.code AS program_code, t.name AS teacher_name
    FROM offerings o JOIN courses c ON c.id=o.course_id JOIN sections sec ON sec.id=o.section_id JOIN programs p ON p.id=sec.program_id
    LEFT JOIN users t ON t.id=o.teacher_id WHERE o.id=?`).get(id);
  if (!o) throw notFound('Offering not found');
  return o;
}
/** Who may mark attendance: admin, or the teacher assigned to the offering. */
export const canMark = (u, o) => u.role === 'admin' || (u.role === 'teacher' && o.teacher_id === u.id);
/** Who may read an offering's data: marking rights, or the HOD of the owning department. */
export const canView = (u, o) => canMark(u, o) || (u.role === 'hod' && u.dept_id != null && o.dept_id === u.dept_id);
export function needMark(u, o) { if (!canMark(u, o)) throw forbidden('You do not teach this course'); }
export function needView(u, o) { if (!canView(u, o)) throw forbidden('You cannot view this course'); }

export function loadSession(db, id) {
  const s = db.prepare('SELECT * FROM lecture_sessions WHERE id=?').get(id);
  if (!s) throw notFound('Lecture not found');
  return s;
}
export function studentOfUser(db, userId) {
  const s = db.prepare('SELECT * FROM students WHERE user_id=?').get(userId);
  if (!s) throw new HttpError(404, 'no_student_profile', 'No student record is linked to this account');
  return s;
}
