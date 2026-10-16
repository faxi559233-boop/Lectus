/* Attendance warning ladder: one notification per student per course per level, never repeated.
   level 1 = within 5 points of the minimum, level 2 = below the minimum. Needs at least 3 lectures so the first week does not alarm everyone. */
import { getSettings, decorate } from './stats.mjs';
import { now } from './util.mjs';
import { tx } from '../db.mjs';

export function runWarnings(db, { minLectures = 3 } = {}) {
  const set = getSettings(db), t = now(); let l1 = 0, l2 = 0;
  const rows = db.prepare(`SELECT st.offering_id, st.student_id, st.P, st.A, st.L, st.T, st.total, o.min_pct, c.code, c.name, s.user_id
    FROM stats st JOIN offerings o ON o.id=st.offering_id JOIN courses c ON c.id=o.course_id JOIN students s ON s.id=st.student_id
    JOIN sections sec ON sec.id=o.section_id JOIN terms tm ON tm.id=sec.term_id
    WHERE st.total >= ? AND s.status='active' AND s.user_id IS NOT NULL AND tm.active=1`).all(minLectures);
  const seen = db.prepare('SELECT 1 FROM warn_log WHERE offering_id=? AND student_id=? AND level=?'), mark = db.prepare('INSERT INTO warn_log(offering_id,student_id,level,ts) VALUES (?,?,?,?)');
  const note = db.prepare('INSERT INTO notifications(user_id,title,body,url,created_at) VALUES (?,?,?,?,?)');
  tx(db, () => { for (const r of rows) {
    const d = decorate(r, r.min_pct, set); if (d.pct === null) continue;
    const level = d.pct < d.min ? 2 : d.pct < d.min + 5 ? 1 : 0; if (!level || seen.get(r.offering_id, r.student_id, level)) continue;
    mark.run(r.offering_id, r.student_id, level, t);
    if (level === 2) { l2++; const need = d.outlook && d.outlook.need ? ` Attend the next ${d.outlook.need} lectures to reach ${d.min}%.` : ''; note.run(r.user_id, `Attendance below minimum: ${r.code}`, `Your attendance in ${r.name} is ${d.pct}% (minimum ${d.min}%).${need}`, '/portal/#/me', t); }
    else { l1++; note.run(r.user_id, `Attendance getting low: ${r.code}`, `Your attendance in ${r.name} is ${d.pct}%, close to the ${d.min}% minimum. Try not to miss more lectures.`, '/portal/#/me', t); }
  } });
  return { level1: l1, level2: l2, checked: rows.length };
}
