import { v, bad, forbidden, csvCell } from '../lib/util.mjs';
import { getSettings, perStudentForDept, decorate } from '../lib/stats.mjs';

const HOD = { auth: ['hod', 'admin'] };
function deptOf(ctx) {
  const id = ctx.user.role === 'hod' ? ctx.user.dept_id : v.int(ctx.query.dept_id, 'dept_id', { min: 1 });
  if (id == null) throw forbidden('No department is assigned to your account'); return id;
}
function shortageRows(db, deptId, offeringId) {
  const set = getSettings(db);
  const offs = new Map(db.prepare(`SELECT o.id, o.min_pct, c.code AS course_code, c.name AS course_name, sec.name AS section_name FROM offerings o JOIN courses c ON c.id=o.course_id JOIN sections sec ON sec.id=o.section_id WHERE c.dept_id=?`).all(deptId).map(o => [o.id, o]));
  const studs = new Map(db.prepare('SELECT id,roll,name,phone FROM students').all().map(s => [s.id, s]));
  const rows = []; let agg = new Map();
  for (const x of perStudentForDept(db, deptId)) {
    const o = offs.get(x.offering_id); if (!o || (offeringId && o.id !== offeringId)) continue;
    const d = decorate(x, o.min_pct, set); const a = agg.get(o.id) || { att: 0, total: 0, short: 0, students: 0 }; a.att += d.att; a.total += d.total; a.students++; if (d.status === 'bad') a.short++; agg.set(o.id, a);
    if (d.status === 'bad') { const s = studs.get(x.student_id); rows.push({ offering_id: o.id, course_code: o.course_code, course_name: o.course_name, section_name: o.section_name, roll: s.roll, name: s.name, phone: s.phone, pct: d.pct, min: d.min, outlook: d.outlook }); }
  }
  rows.sort((a, b) => a.pct - b.pct);
  return { rows, agg, offs, set };
}
export default function (r, db) {
  r.get('/api/department/overview', HOD, ctx => {
    const dept = deptOf(ctx); const { agg, offs, set } = shortageRows(db, dept);
    const enrolled = new Map(db.prepare('SELECT offering_id, COUNT(*) c FROM enrollments GROUP BY offering_id').all().map(e => [e.offering_id, e.c]));
    const held = new Map(db.prepare('SELECT offering_id, COUNT(*) c FROM lecture_sessions GROUP BY offering_id').all().map(e => [e.offering_id, e.c]));
    const items = [...offs.values()].map(o => { const a = agg.get(o.id) || { att: 0, total: 0, short: 0 };
      return { offering_id: o.id, course_code: o.course_code, course_name: o.course_name, section_name: o.section_name, enrolled: enrolled.get(o.id) || 0, lectures: held.get(o.id) || 0, rate: a.total ? Math.round((a.att / a.total) * 1000) / 10 : null, shortage: a.short }; });
    const tot = items.reduce((s, i) => ({ shortage: s.shortage + i.shortage, lectures: s.lectures + i.lectures }), { shortage: 0, lectures: 0 });
    const all = [...agg.values()].reduce((s, a) => ({ att: s.att + a.att, total: s.total + a.total }), { att: 0, total: 0 });
    return { department: db.prepare('SELECT id,code,name FROM departments WHERE id=?').get(dept), rate: all.total ? Math.round((all.att / all.total) * 1000) / 10 : null, ...tot, min_pct: set.min_pct, items };
  });
  r.get('/api/department/shortage', HOD, ctx => {
    const dept = deptOf(ctx); const off = ctx.query.offering_id ? v.int(ctx.query.offering_id, 'offering_id') : null;
    return { items: shortageRows(db, dept, off).rows.slice(0, 2000) };
  });
  r.get('/api/department/shortage.csv', HOD, ctx => {
    const dept = deptOf(ctx); const { rows } = shortageRows(db, dept, ctx.query.offering_id ? v.int(ctx.query.offering_id, 'offering_id') : null);
    const head = ['Roll', 'Name', 'Course', 'Section', 'Attendance %', 'Minimum %', 'Lectures needed'];
    const body = rows.map(x => [x.roll, x.name, x.course_code, x.section_name, x.pct, x.min, x.outlook && x.outlook.need != null ? x.outlook.need : ''].map(csvCell).join(','));
    return { __raw: true, type: 'text/csv; charset=utf-8', body: '﻿' + [head.map(csvCell).join(','), ...body].join('\r\n'), headers: { 'content-disposition': 'attachment; filename="shortage.csv"' } };
  });
}
