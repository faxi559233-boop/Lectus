import { v, bad, forbidden, now, csvCell } from '../lib/util.mjs';
import { audit } from '../lib/audit.mjs';
import { tx } from '../db.mjs';
import { loadOffering, canMark, canView, needMark, needView, studentOfUser } from '../lib/access.mjs';
import { getSettings, perStudentForOffering, decorate } from '../lib/stats.mjs';
import { getScale, validateScale, gradeFor, weightedTotal, gpa, round2 } from '../lib/grades.mjs';

const VIEW = { auth: ['teacher', 'hod', 'admin'], perm: 'exams' }, TEACH = { auth: ['teacher', 'admin'], perm: 'exams' }, APPROVE = { auth: ['hod', 'admin'], perm: 'exams' };
const ADMIN = { auth: ['admin'], perm: 'exams' }, STU = { auth: ['student'] };
const canApprove = (u, o) => u.role === 'admin' || (u.role === 'hod' && u.dept_id != null && u.dept_id === o.dept_id);

const stateOf = (db, id) => db.prepare('SELECT * FROM result_state WHERE offering_id=?').get(id) || { offering_id: id, status: 'draft', submitted_at: null, approved_by: null, approved_at: null, note: null };
const setState = (db, id, patch) => { const s = { ...stateOf(db, id), ...patch };
  db.prepare('INSERT INTO result_state(offering_id,status,submitted_at,approved_by,approved_at,note) VALUES (?,?,?,?,?,?) ON CONFLICT(offering_id) DO UPDATE SET status=excluded.status, submitted_at=excluded.submitted_at, approved_by=excluded.approved_by, approved_at=excluded.approved_at, note=excluded.note')
    .run(id, s.status, s.submitted_at, s.approved_by, s.approved_at, s.note); };
const roster = (db, offId) => db.prepare("SELECT st.id, st.roll, st.name, st.user_id FROM enrollments e JOIN students st ON st.id=e.student_id WHERE e.offering_id=? AND st.status='active' ORDER BY st.roll").all(offId);
const comps = (db, offId) => db.prepare('SELECT id,name,max_marks,weight,pos FROM components WHERE offering_id=? ORDER BY pos,id').all(offId);
const notify = (db, userId, title, body, url = '/portal/#/results') => { if (userId) db.prepare('INSERT INTO notifications(user_id,title,body,url,created_at) VALUES (?,?,?,?,?)').run(userId, title, body, url, now()); };

function sheet(db, o) {
  const cs = comps(db, o.id), rs = roster(db, o.id), set = getSettings(db), scale = getScale(db);
  const att = new Map(perStudentForOffering(db, o.id).map(x => [x.student_id, x]));
  const mm = new Map(); for (const m of db.prepare('SELECT m.* FROM marks m JOIN components c ON c.id=m.component_id WHERE c.offering_id=?').all(o.id)) mm.set(m.component_id + ':' + m.student_id, m);
  const wsum = round2(cs.reduce((a, c) => a + c.weight, 0));
  const rows = rs.map(st => {
    const byComp = new Map(cs.map(c => [c.id, mm.get(c.id + ':' + st.id) || null]).filter(([, m]) => m));
    const { total, missing } = weightedTotal(cs, byComp); const d = decorate(att.get(st.id) || { P: 0, A: 0, L: 0, T: 0, total: 0 }, o.min_pct, set);
    const g = wsum === 100 && !missing ? gradeFor(total, scale) : { grade: null, gp: null };
    return { id: st.id, roll: st.roll, name: st.name, marks: Object.fromEntries(cs.map(c => { const m = mm.get(c.id + ':' + st.id); return [c.id, m ? { obtained: m.obtained, absent: !!m.absent } : null]; })),
      total, missing, grade: g.grade, gp: g.gp, att_pct: d.pct, eligible: d.status !== 'bad' };
  });
  return { offering: { id: o.id, course_code: o.course_code, course_name: o.course_name, section_name: o.section_name, credits: db.prepare('SELECT credits FROM courses WHERE id=?').get(o.course_id).credits ?? 0, min_pct: o.min_pct || set.min_pct },
    state: stateOf(db, o.id), components: cs, weight_sum: wsum, rows, scale };
}

function termReport(db, studentId) {
  const rows = db.prepare(`SELECT r.offering_id, r.total, r.grade, r.gp, r.credits, r.eligible, c.code, c.name, t.id AS term_id, t.name AS term_name, sec.semester_no
    FROM results r JOIN offerings o ON o.id=r.offering_id JOIN courses c ON c.id=o.course_id JOIN sections sec ON sec.id=o.section_id JOIN terms t ON t.id=sec.term_id
    WHERE r.student_id=? ORDER BY t.id, c.code`).all(studentId);
  const terms = new Map();
  for (const r of rows) { if (!terms.has(r.term_id)) terms.set(r.term_id, { term_id: r.term_id, term: r.term_name, semester_no: r.semester_no, courses: [] }); terms.get(r.term_id).courses.push({ code: r.code, name: r.name, credits: r.credits, total: r.total, grade: r.grade, gp: r.gp, eligible: !!r.eligible }); }
  const out = [...terms.values()].map(t => ({ ...t, ...gpa(t.courses) }));
  const all = gpa(rows);
  return { terms: out, cgpa: all.gpa, credits: all.credits };
}

export default function (r, db) {
  r.get('/api/offerings/:id/assessment', VIEW, ctx => { const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); needView(ctx.user, o); return sheet(db, o); });

  r.put('/api/offerings/:id/components', TEACH, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); needMark(ctx.user, o);
    if (stateOf(db, o.id).status !== 'draft') throw bad('locked', 'Results are submitted or published. Ask the HOD to send them back first.');
    const list = ctx.body.components; if (!Array.isArray(list) || !list.length || list.length > 12) throw bad('invalid_components', 'Send 1-12 components');
    const parsed = list.map((c, i) => ({ name: v.str(c.name, 'name', { max: 40 }), max: v.num(c.max_marks, 'max_marks', { min: 0.5, max: 1000 }), weight: v.num(c.weight, 'weight', { min: 0.5, max: 100 }), pos: i }));
    if (new Set(parsed.map(p => p.name.toLowerCase())).size !== parsed.length) throw bad('duplicate', 'Component names must be different');
    if (round2(parsed.reduce((a, p) => a + p.weight, 0)) > 100) throw bad('weight_over', 'Weights add up to more than 100');
    tx(db, () => {
      const have = new Map(db.prepare('SELECT id,name FROM components WHERE offering_id=?').all(o.id).map(c => [c.name.toLowerCase(), c.id]));
      for (const p of parsed) { const id = have.get(p.name.toLowerCase());
        if (id) { db.prepare('UPDATE components SET name=?, max_marks=?, weight=?, pos=? WHERE id=?').run(p.name, p.max, p.weight, p.pos, id); have.delete(p.name.toLowerCase()); }
        else db.prepare('INSERT INTO components(offering_id,name,max_marks,weight,pos) VALUES (?,?,?,?,?)').run(o.id, p.name, p.max, p.weight, p.pos); }
      for (const id of have.values()) db.prepare('DELETE FROM components WHERE id=?').run(id);
    });
    audit(db, ctx.user, 'results.components', 'offering', o.id, { components: parsed.map(p => `${p.name}:${p.max}/${p.weight}`) }, ctx.ip);
    return sheet(db, o);
  });

  r.put('/api/offerings/:id/marks', TEACH, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); needMark(ctx.user, o);
    if (stateOf(db, o.id).status !== 'draft') throw bad('locked', 'Results are submitted or published, marks cannot be changed.');
    const opId = v.str(ctx.body.op_id, 'op_id', { min: 8, max: 64, optional: true, re: /^[A-Za-z0-9_-]+$/ });
    if (opId) { const prev = db.prepare('SELECT result FROM ops WHERE op_id=? AND user_id=?').get(opId, ctx.user.id); if (prev) return { ...JSON.parse(prev.result), replayed: true }; }
    const list = ctx.body.entries; if (!Array.isArray(list) || !list.length || list.length > 3000) throw bad('invalid_entries', 'Send 1-3000 entries');
    const cs = new Map(comps(db, o.id).map(c => [c.id, c])), enrolled = new Set(roster(db, o.id).map(s => s.id));
    const parsed = list.map(e => { const c = cs.get(v.int(e.component_id, 'component_id', { min: 1 })); if (!c) throw bad('unknown_component', 'Component does not belong to this course');
      const sid = v.int(e.student_id, 'student_id', { min: 1 }); if (!enrolled.has(sid)) throw bad('not_enrolled', 'Student is not enrolled in this course');
      const absent = e.absent === true; const ob = absent || e.obtained === null || e.obtained === undefined || e.obtained === '' ? null : v.num(e.obtained, 'obtained', { min: 0, max: c.max_marks });
      return { cid: c.id, sid, ob, absent }; });
    const t = now(); let n = 0;
    tx(db, () => {
      const up = db.prepare('INSERT INTO marks(component_id,student_id,obtained,absent,updated_by,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(component_id,student_id) DO UPDATE SET obtained=excluded.obtained, absent=excluded.absent, updated_by=excluded.updated_by, updated_at=excluded.updated_at');
      const del = db.prepare('DELETE FROM marks WHERE component_id=? AND student_id=?');
      for (const p of parsed) { if (p.ob === null && !p.absent) del.run(p.cid, p.sid); else up.run(p.cid, p.sid, p.ob, p.absent ? 1 : 0, ctx.user.id, t); n++; }
      audit(db, ctx.user, 'results.marks', 'offering', o.id, { entries: n }, ctx.ip);
      if (opId) db.prepare('INSERT OR IGNORE INTO ops(op_id,user_id,ts,result) VALUES (?,?,?,?)').run(opId, ctx.user.id, t, JSON.stringify({ saved: n }));
    });
    return { saved: n };
  });

  r.post('/api/offerings/:id/results/submit', TEACH, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); needMark(ctx.user, o);
    if (stateOf(db, o.id).status !== 'draft') throw bad('wrong_state', 'Results are already submitted or published');
    const s = sheet(db, o);
    if (!s.components.length) throw bad('no_components', 'Add the assessment components first');
    if (s.weight_sum !== 100) throw bad('weight_not_100', `Weights add up to ${s.weight_sum}, they must add up to 100`);
    const missing = s.rows.filter(x => x.missing).length; if (missing) throw bad('marks_missing', `${missing} student(s) still have missing marks. Enter marks or mark them absent.`);
    setState(db, o.id, { status: 'submitted', submitted_at: now(), note: null }); audit(db, ctx.user, 'results.submit', 'offering', o.id, null, ctx.ip);
    return { status: 'submitted' };
  });
  r.post('/api/offerings/:id/results/reject', APPROVE, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); if (!canApprove(ctx.user, o)) throw forbidden('Not your department');
    if (stateOf(db, o.id).status !== 'submitted') throw bad('wrong_state', 'Only submitted results can be sent back');
    const note = v.str(ctx.body.note, 'note', { min: 3, max: 300 });
    setState(db, o.id, { status: 'draft', note }); audit(db, ctx.user, 'results.reject', 'offering', o.id, { note }, ctx.ip);
    notify(db, o.teacher_id, `Results sent back: ${o.course_code}`, note, '/portal/#/course/' + o.id); return { status: 'draft' };
  });
  r.post('/api/offerings/:id/results/approve', APPROVE, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); if (!canApprove(ctx.user, o)) throw forbidden('Not your department');
    if (stateOf(db, o.id).status !== 'submitted') throw bad('wrong_state', 'Only submitted results can be published');
    const s = sheet(db, o); if (s.weight_sum !== 100 || s.rows.some(x => x.missing)) throw bad('incomplete', 'Marks or weights changed and are incomplete');
    const credits = s.offering.credits; const t = now();
    tx(db, () => {
      db.prepare('DELETE FROM results WHERE offering_id=?').run(o.id);
      const ins = db.prepare('INSERT INTO results(offering_id,student_id,total,grade,gp,credits,eligible) VALUES (?,?,?,?,?,?,?)');
      for (const x of s.rows) ins.run(o.id, x.id, x.total, x.grade, x.gp, credits, x.eligible ? 1 : 0);
      setState(db, o.id, { status: 'approved', approved_by: ctx.user.id, approved_at: t, note: null });
      for (const st of roster(db, o.id)) notify(db, st.user_id, `Result published: ${o.course_code}`, `${o.course_name} result is now available.`);
    });
    audit(db, ctx.user, 'results.approve', 'offering', o.id, { students: s.rows.length }, ctx.ip); return { status: 'approved', students: s.rows.length };
  });
  r.post('/api/offerings/:id/results/reopen', ADMIN, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); const reason = v.str(ctx.body.reason, 'reason', { min: 5, max: 300 });
    if (stateOf(db, o.id).status !== 'approved') throw bad('wrong_state', 'Only published results can be reopened');
    tx(db, () => { db.prepare('DELETE FROM results WHERE offering_id=?').run(o.id); setState(db, o.id, { status: 'draft', approved_by: null, approved_at: null, note: 'Reopened: ' + reason }); });
    audit(db, ctx.user, 'results.reopen', 'offering', o.id, { reason }, ctx.ip); notify(db, o.teacher_id, `Results reopened: ${o.course_code}`, reason, '/portal/#/course/' + o.id); return { status: 'draft' };
  });
  r.get('/api/offerings/:id/results.csv', VIEW, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); needView(ctx.user, o); const s = sheet(db, o);
    const head = ['Roll', 'Name', ...s.components.map(c => `${c.name} (/${c.max_marks})`), 'Total', 'Grade', 'GP', 'Attendance %', 'Eligible'];
    const body = s.rows.map(x => [x.roll, x.name, ...s.components.map(c => { const m = x.marks[c.id]; return m ? (m.absent ? 'AB' : m.obtained) : ''; }), x.total, x.grade ?? '', x.gp ?? '', x.att_pct ?? '', x.eligible ? 'Yes' : 'No'].map(csvCell).join(','));
    return { __raw: true, type: 'text/csv; charset=utf-8', body: '﻿' + [head.map(csvCell).join(','), ...body].join('\r\n'), headers: { 'content-disposition': `attachment; filename="${o.course_code}-${o.section_name}-results.csv"` } };
  });

  r.get('/api/my/results', STU, ctx => { const st = studentOfUser(db, ctx.user.id); return { student: { roll: st.roll, name: st.name }, ...termReport(db, st.id) }; });
  r.get('/api/students/:id/transcript', { auth: ['admin', 'hod'], perm: 'exams' }, ctx => {
    const st = db.prepare('SELECT st.*, p.dept_id, p.name AS program_name FROM students st LEFT JOIN sections sec ON sec.id=st.section_id LEFT JOIN programs p ON p.id=sec.program_id WHERE st.id=?').get(v.int(ctx.params.id, 'id', { min: 1 }));
    if (!st) throw bad('not_found', 'Student not found');
    if (ctx.user.role === 'hod' && (ctx.user.dept_id == null || st.dept_id !== ctx.user.dept_id)) throw forbidden('Not your department');
    return { student: { id: st.id, roll: st.roll, name: st.name, program: st.program_name }, ...termReport(db, st.id) };
  });

  r.get('/api/admin/grade-scale', ADMIN, () => ({ scale: getScale(db), is_default: !db.prepare("SELECT 1 FROM settings WHERE key='grade_scale'").get() }));
  r.put('/api/admin/grade-scale', ADMIN, ctx => {
    const scale = validateScale(ctx.body.scale);
    db.prepare("INSERT INTO settings(key,value) VALUES ('grade_scale',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(scale));
    audit(db, ctx.user, 'settings.grade_scale', 'settings', null, { rows: scale.length }, ctx.ip); return { scale };
  });
}
