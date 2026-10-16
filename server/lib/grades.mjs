/* Grade scale and GPA maths. The default scale is a common Pakistani 4-point table and is NOT confirmed to be the University of Gujrat's:
   the admin must enter the official table (Admin > Settings). Published results store their own snapshot, so changing the scale never rewrites history. */
import { bad } from './util.mjs';

export const DEFAULT_SCALE = [
  { min: 85, grade: 'A', gp: 4 }, { min: 80, grade: 'A-', gp: 3.66 }, { min: 75, grade: 'B+', gp: 3.33 }, { min: 71, grade: 'B', gp: 3 }, { min: 68, grade: 'B-', gp: 2.66 },
  { min: 64, grade: 'C+', gp: 2.33 }, { min: 61, grade: 'C', gp: 2 }, { min: 58, grade: 'C-', gp: 1.66 }, { min: 54, grade: 'D+', gp: 1.33 }, { min: 50, grade: 'D', gp: 1 }, { min: 0, grade: 'F', gp: 0 }];

export function getScale(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key='grade_scale'").get();
  if (row) { try { const s = JSON.parse(row.value); if (Array.isArray(s) && s.length) return s; } catch { /* fall back */ } }
  return DEFAULT_SCALE;
}
export function validateScale(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 20) throw bad('invalid_scale', 'Send 2-20 grade rows');
  const out = rows.map(r => {
    const min = Number(r.min), gp = Number(r.gp), grade = String(r.grade ?? '').trim();
    if (!Number.isFinite(min) || min < 0 || min > 100) throw bad('invalid_scale', 'min must be 0-100');
    if (!Number.isFinite(gp) || gp < 0 || gp > 4.5) throw bad('invalid_scale', 'gp must be 0-4.5');
    if (!grade || grade.length > 4) throw bad('invalid_scale', 'grade must be 1-4 characters');
    return { min, grade, gp };
  }).sort((a, b) => b.min - a.min);
  if (out[out.length - 1].min !== 0) throw bad('invalid_scale', 'The lowest row must start at 0');
  if (new Set(out.map(r => r.min)).size !== out.length) throw bad('invalid_scale', 'Two rows have the same minimum');
  for (let i = 1; i < out.length; i++) if (out[i].gp > out[i - 1].gp) throw bad('invalid_scale', 'Grade points must not increase as marks fall');
  return out;
}
export const gradeFor = (total, scale) => { const r = scale.find(x => total + 1e-9 >= x.min) || scale[scale.length - 1]; return { grade: r.grade, gp: r.gp }; };
export const round2 = x => Math.round(x * 100) / 100;

/** components: [{id,max_marks,weight}], marksByComp: Map(componentId -> {obtained, absent}) -> weighted total out of the sum of weights. */
export function weightedTotal(components, marksByComp) {
  let total = 0, missing = 0;
  for (const c of components) {
    const m = marksByComp.get(c.id);
    if (!m || (m.obtained === null && !m.absent)) { missing++; continue; }
    if (!m.absent) total += (m.obtained / c.max_marks) * c.weight;
  }
  return { total: round2(total), missing };
}
/** rows: [{gp, credits}] -> credit-weighted GPA (courses with 0 credits are ignored). */
export function gpa(rows) {
  let pts = 0, cr = 0;
  for (const r of rows) { if (!r.credits || r.gp === null || r.gp === undefined) continue; pts += r.gp * r.credits; cr += r.credits; }
  return { gpa: cr ? Math.round((pts / cr) * 100) / 100 : null, credits: cr };
}
