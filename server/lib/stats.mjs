import { config } from '../config.mjs';

export function getSettings(db) {
  const o = { min_pct: config.defaultMinPct, warn_pct: 80, leave_counts: 1, late_counts: 1 };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) if (r.key in o) o[r.key] = +r.value;
  return o;
}
export function pctOf(c, set) {
  const att = c.P + (set.leave_counts ? c.L : 0) + (set.late_counts ? c.T : 0);
  return { att, pct: c.total ? (att / c.total) * 100 : null };
}
export function statusOf(pct, min, warn) { return pct === null ? 'none' : pct < min ? 'bad' : pct < Math.min(100, min + Math.max(0, warn - config.defaultMinPct)) ? 'warn' : 'ok'; }
export function outlook(att, total, pct, min) {
  if (!total || min >= 100) return null;
  if (pct < min) return { need: Math.ceil((min * total - 100 * att) / (100 - min)) };
  return { spare: Math.max(0, Math.floor((100 * att) / min - total)) };
}
// Reads the trigger-maintained `stats` table (see db.mjs) instead of aggregating millions of attendance rows.
export const perStudentForOffering = (db, offeringId) => db.prepare('SELECT student_id, P, A, L, T, total FROM stats WHERE offering_id=?').all(offeringId);
export const perOfferingForStudent = (db, studentId) => db.prepare('SELECT offering_id, P, A, L, T, total FROM stats WHERE student_id=?').all(studentId);
export const perStudentForDept = (db, deptId) => db.prepare('SELECT st.offering_id, st.student_id, st.P, st.A, st.L, st.T, st.total FROM stats st JOIN offerings o ON o.id=st.offering_id JOIN courses c ON c.id=o.course_id WHERE c.dept_id=?').all(deptId);
export function decorate(c, minPct, set) {
  const { att, pct } = pctOf(c, set); const min = minPct || set.min_pct;
  return { P: c.P || 0, A: c.A || 0, L: c.L || 0, T: c.T || 0, total: c.total || 0, att, pct: pct === null ? null : Math.round(pct * 10) / 10, min, status: statusOf(pct, min, set.warn_pct), outlook: outlook(att, c.total || 0, pct, min) };
}
