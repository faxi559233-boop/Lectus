import { v, HttpError, now, notFound, bad } from '../lib/util.mjs';
import { hashPassword, generatePassword, checkPasswordPolicy, destroyAllSessions } from '../lib/auth.mjs';
import { audit } from '../lib/audit.mjs';
import { tx } from '../db.mjs';
import { backupNow, latestBackup } from '../lib/backup.mjs';
import { statSync } from 'node:fs';
import { config } from '../config.mjs';

const ADMIN = { auth: ['admin'] }, READ = { auth: ['admin', 'hod'] };
export function dbErr(e) {
  const m = String(e && e.message || '');
  if (/UNIQUE/i.test(m)) return new HttpError(409, 'duplicate', 'That value already exists');
  if (/FOREIGN KEY/i.test(m)) return new HttpError(409, 'in_use_or_missing', 'Referenced item is missing, or this item is still in use');
  if (/CHECK constraint/i.test(m)) return new HttpError(400, 'invalid', 'Invalid value');
  return e;
}
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
export function enrollSection(db, sectionId) {
  db.prepare(`INSERT OR IGNORE INTO enrollments(student_id, offering_id)
    SELECT s.id, o.id FROM students s JOIN offerings o ON o.section_id = s.section_id WHERE s.section_id = ? AND s.status='active'`).run(sectionId);
}
export function syncStudent(db, studentId) {
  const s = db.prepare('SELECT section_id, status FROM students WHERE id=?').get(studentId); if (!s) return;
  if (s.section_id == null || s.status !== 'active') { db.prepare('DELETE FROM enrollments WHERE student_id=?').run(studentId); return; }
  db.prepare('DELETE FROM enrollments WHERE student_id=? AND offering_id NOT IN (SELECT id FROM offerings WHERE section_id=?)').run(studentId, s.section_id);
  enrollSection(db, s.section_id);
}

const code = (x, f) => v.str(x, f, { min: 2, max: 30, re: /^[A-Za-z0-9._-]+$/ });
const SPECS = [
  { path: 'departments', table: 'departments', order: 'code', fields: { code: x => code(x, 'code'), name: x => v.str(x, 'name', { min: 2, max: 100 }) } },
  { path: 'programs', table: 'programs', order: 'code', fields: { dept_id: x => v.int(x, 'dept_id', { min: 1 }), code: x => code(x, 'code'), name: x => v.str(x, 'name', { min: 2, max: 100 }) } },
  { path: 'terms', table: 'terms', order: 'id DESC', fields: { name: x => v.str(x, 'name', { min: 2, max: 60 }), starts: x => v.date(x, 'starts', { optional: true }), ends: x => v.date(x, 'ends', { optional: true }), active: x => (x ? 1 : 0) } },
  { path: 'sections', table: 'sections', order: 'term_id DESC, program_id, name', fields: { program_id: x => v.int(x, 'program_id', { min: 1 }), term_id: x => v.int(x, 'term_id', { min: 1 }), name: x => v.str(x, 'name', { max: 40 }), semester_no: x => v.int(x, 'semester_no', { min: 1, max: 14, optional: true }) } },
  { path: 'courses', table: 'courses', order: 'code', fields: { dept_id: x => v.int(x, 'dept_id', { min: 1 }), code: x => code(x, 'code'), name: x => v.str(x, 'name', { min: 2, max: 120 }), credits: x => v.int(x, 'credits', { min: 0, max: 20, optional: true }) } },
  { path: 'offerings', table: 'offerings', order: 'id DESC', after: (db, id, row) => enrollSection(db, row.section_id),
    fields: { course_id: x => v.int(x, 'course_id', { min: 1 }), section_id: x => v.int(x, 'section_id', { min: 1 }), teacher_id: x => v.int(x, 'teacher_id', { min: 1, optional: true }), min_pct: x => v.int(x, 'min_pct', { min: 1, max: 99, optional: true }),
      room: x => v.str(x, 'room', { max: 40, optional: true }), days: x => v.str(x, 'days', { max: 20, optional: true, re: /^[0-6](,[0-6])*$/ }), start_time: x => v.str(x, 'start_time', { max: 5, optional: true, re: /^([01]\d|2[0-3]):[0-5]\d$/ }) },
    listSql: `SELECT o.*, c.code AS course_code, c.name AS course_name, c.dept_id, sec.name AS section_name, sec.term_id, p.code AS program_code, u.name AS teacher_name,
      (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id=o.id) AS enrolled
      FROM offerings o JOIN courses c ON c.id=o.course_id JOIN sections sec ON sec.id=o.section_id JOIN programs p ON p.id=sec.program_id LEFT JOIN users u ON u.id=o.teacher_id ORDER BY o.id DESC` },
];

export default function (r, db) {
  for (const spec of SPECS) {
    const keys = Object.keys(spec.fields), base = `/api/admin/${spec.path}`;
    const one = id => db.prepare(`SELECT * FROM ${spec.table} WHERE id=?`).get(id);
    r.get(base, READ, () => db.prepare(spec.listSql || `SELECT * FROM ${spec.table} ORDER BY ${spec.order}`).all());
    r.post(base, ADMIN, ctx => {
      const vals = keys.map(k => spec.fields[k](ctx.body[k]));
      let id; try { id = tx(db, () => { const res = db.prepare(`INSERT INTO ${spec.table}(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...vals); const nid = Number(res.lastInsertRowid); if (spec.after) spec.after(db, nid, one(nid)); return nid; }); } catch (e) { throw dbErr(e); }
      audit(db, ctx.user, `${spec.path}.create`, spec.path, id, Object.fromEntries(keys.map((k, i) => [k, vals[i]])), ctx.ip);
      ctx.status = 201; return one(id);
    });
    r.put(`${base}/:id`, ADMIN, ctx => {
      const id = v.int(ctx.params.id, 'id', { min: 1 }); if (!one(id)) throw notFound();
      const given = keys.filter(k => k in ctx.body); if (!given.length) throw bad('nothing_to_update', 'No fields to update');
      const vals = given.map(k => spec.fields[k](ctx.body[k]));
      try { tx(db, () => { db.prepare(`UPDATE ${spec.table} SET ${given.map(k => k + '=?').join(',')} WHERE id=?`).run(...vals, id); if (spec.after) spec.after(db, id, one(id)); }); } catch (e) { throw dbErr(e); }
      audit(db, ctx.user, `${spec.path}.update`, spec.path, id, Object.fromEntries(given.map((k, i) => [k, vals[i]])), ctx.ip);
      return one(id);
    });
    r.del(`${base}/:id`, ADMIN, ctx => {
      const id = v.int(ctx.params.id, 'id', { min: 1 }); if (!one(id)) throw notFound();
      try { db.prepare(`DELETE FROM ${spec.table} WHERE id=?`).run(id); } catch (e) { throw dbErr(e); }
      audit(db, ctx.user, `${spec.path}.delete`, spec.path, id, null, ctx.ip); return { ok: true };
    });
  }

  /* ---------- users ---------- */
  const userCols = 'id,email,name,role,dept_id,phone,active,must_change,last_login,created_at';
  r.get('/api/admin/users', ADMIN, ctx => {
    const lim = Math.min(+ctx.query.limit || 100, 500), off = Math.max(+ctx.query.offset || 0, 0), where = [], args = [];
    if (ctx.query.role) { where.push('role=?'); args.push(v.oneOf(ctx.query.role, 'role', ['admin', 'hod', 'teacher', 'student'])); }
    if (ctx.query.q) { where.push('(name LIKE ? OR email LIKE ?)'); args.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return { total: db.prepare(`SELECT COUNT(*) c FROM users ${w}`).get(...args).c, items: db.prepare(`SELECT ${userCols} FROM users ${w} ORDER BY name LIMIT ? OFFSET ?`).all(...args, lim, off) };
  });
  const makeUser = async (b, ctx, defaults = {}) => {
    const email = v.email(b.email, 'email'), name = v.str(b.name, 'name', { min: 2, max: 100 }), role = v.oneOf(b.role ?? defaults.role, 'role', ['admin', 'hod', 'teacher', 'student']);
    const dept = v.int(b.dept_id, 'dept_id', { min: 1, optional: true }), phone = v.phone(b.phone);
    let pw = b.password, generated = false; if (!pw) { pw = generatePassword(); generated = true; } else checkPasswordPolicy(pw, email);
    const hash = await hashPassword(pw, { generated });
    try { const res = db.prepare('INSERT INTO users(email,name,role,pw_hash,must_change,dept_id,phone,created_at) VALUES (?,?,?,?,1,?,?,?)').run(email, name, role, hash, dept, phone, now()); return { id: Number(res.lastInsertRowid), email, name, role, password: pw, generated }; }
    catch (e) { throw dbErr(e); }
  };
  r.post('/api/admin/users', ADMIN, async ctx => {
    const u = await makeUser(ctx.body, ctx); audit(db, ctx.user, 'users.create', 'user', u.id, { email: u.email, role: u.role }, ctx.ip);
    ctx.status = 201; return { user: db.prepare(`SELECT ${userCols} FROM users WHERE id=?`).get(u.id), password: u.password };
  });
  r.post('/api/admin/import/users', ADMIN, async ctx => {
    const rows = ctx.body.rows; if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw bad('invalid_rows', 'Send 1-500 rows per request');
    const depts = new Map(db.prepare('SELECT code,id FROM departments').all().map(d => [d.code.toLowerCase(), d.id]));
    const out = { created: [], errors: [] };
    await mapLimit(rows.map((row, i) => [row, i]), 4, async ([row, i]) => {
      try {
        const dept = row.dept_code ? depts.get(String(row.dept_code).toLowerCase()) : null; if (row.dept_code && !dept) throw bad('invalid_dept', 'Unknown department code');
        const u = await makeUser({ ...row, dept_id: dept }, ctx, { role: 'teacher' });
        out.created.push({ row: i + 1, email: u.email, name: u.name, role: u.role, password: u.password });
      } catch (e) { out.errors.push({ row: i + 1, error: e.message }); }
    });
    audit(db, ctx.user, 'users.import', 'user', null, { created: out.created.length, errors: out.errors.length }, ctx.ip);
    return out;
  });
  r.put('/api/admin/users/:id', ADMIN, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }), u = db.prepare('SELECT * FROM users WHERE id=?').get(id); if (!u) throw notFound();
    const b = ctx.body, sets = [], vals = [];
    if ('name' in b) { sets.push('name=?'); vals.push(v.str(b.name, 'name', { min: 2, max: 100 })); }
    if ('role' in b) { if (id === ctx.user.id) throw bad('self_role', 'You cannot change your own role'); sets.push('role=?'); vals.push(v.oneOf(b.role, 'role', ['admin', 'hod', 'teacher', 'student'])); }
    if ('dept_id' in b) { sets.push('dept_id=?'); vals.push(v.int(b.dept_id, 'dept_id', { min: 1, optional: true })); }
    if ('phone' in b) { sets.push('phone=?'); vals.push(v.phone(b.phone)); }
    if ('active' in b) { if (id === ctx.user.id) throw bad('self_deactivate', 'You cannot deactivate yourself'); sets.push('active=?'); vals.push(b.active ? 1 : 0); }
    if (!sets.length) throw bad('nothing_to_update', 'No fields to update');
    try { db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...vals, id); } catch (e) { throw dbErr(e); }
    if ('active' in b && !b.active) destroyAllSessions(db, id);
    if ('role' in b) destroyAllSessions(db, id);
    audit(db, ctx.user, 'users.update', 'user', id, b, ctx.ip);
    return db.prepare(`SELECT ${userCols} FROM users WHERE id=?`).get(id);
  });
  r.post('/api/admin/users/:id/reset-password', ADMIN, async ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }); if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) throw notFound();
    const pw = generatePassword(); db.prepare('UPDATE users SET pw_hash=?, must_change=1, failed=0, locked_until=0 WHERE id=?').run(await hashPassword(pw, { generated: true }), id);
    destroyAllSessions(db, id); audit(db, ctx.user, 'users.reset_password', 'user', id, null, ctx.ip); return { password: pw };
  });

  /* ---------- students ---------- */
  const stuFields = {
    roll: x => v.str(x, 'roll', { min: 2, max: 40, re: /^[A-Za-z0-9._\/-]+$/ }), name: x => v.str(x, 'name', { min: 2, max: 100 }), phone: x => v.phone(x),
    section_id: x => v.int(x, 'section_id', { min: 1, optional: true }), status: x => v.oneOf(x, 'status', ['active', 'left', 'frozen']) };
  r.get('/api/admin/students', READ, ctx => {
    const lim = Math.min(+ctx.query.limit || 100, 500), off = Math.max(+ctx.query.offset || 0, 0), where = [], args = [];
    if (ctx.user.role === 'hod') { where.push('s.section_id IN (SELECT sec.id FROM sections sec JOIN programs p ON p.id=sec.program_id WHERE p.dept_id=?)'); args.push(ctx.user.dept_id); }
    if (ctx.query.section_id) { where.push('s.section_id=?'); args.push(v.int(ctx.query.section_id, 'section_id')); }
    if (ctx.query.q) { where.push('(s.name LIKE ? OR s.roll LIKE ?)'); args.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return { total: db.prepare(`SELECT COUNT(*) c FROM students s ${w}`).get(...args).c,
      items: db.prepare(`SELECT s.id,s.roll,s.name,s.phone,s.section_id,s.status,(s.user_id IS NOT NULL) AS has_login, sec.name AS section_name FROM students s LEFT JOIN sections sec ON sec.id=s.section_id ${w} ORDER BY s.roll LIMIT ? OFFSET ?`).all(...args, lim, off) };
  });
  r.post('/api/admin/students', ADMIN, ctx => {
    const b = ctx.body, row = { roll: stuFields.roll(b.roll), name: stuFields.name(b.name), phone: stuFields.phone(b.phone), section_id: stuFields.section_id(b.section_id) };
    let id; try { id = tx(db, () => { const res = db.prepare('INSERT INTO students(roll,name,phone,section_id,created_at) VALUES (?,?,?,?,?)').run(row.roll, row.name, row.phone, row.section_id, now()); const nid = Number(res.lastInsertRowid); syncStudent(db, nid); return nid; }); } catch (e) { throw dbErr(e); }
    audit(db, ctx.user, 'students.create', 'student', id, row, ctx.ip); ctx.status = 201; return db.prepare('SELECT * FROM students WHERE id=?').get(id);
  });
  r.put('/api/admin/students/:id', ADMIN, ctx => {
    const id = v.int(ctx.params.id, 'id', { min: 1 }); if (!db.prepare('SELECT 1 FROM students WHERE id=?').get(id)) throw notFound();
    const given = Object.keys(stuFields).filter(k => k in ctx.body); if (!given.length) throw bad('nothing_to_update', 'No fields to update');
    const vals = given.map(k => stuFields[k](ctx.body[k]));
    try { tx(db, () => { db.prepare(`UPDATE students SET ${given.map(k => k + '=?').join(',')} WHERE id=?`).run(...vals, id); syncStudent(db, id); }); } catch (e) { throw dbErr(e); }
    audit(db, ctx.user, 'students.update', 'student', id, ctx.body, ctx.ip); return db.prepare('SELECT * FROM students WHERE id=?').get(id);
  });
  r.post('/api/admin/import/students', ADMIN, ctx => {
    const rows = ctx.body.rows; if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw bad('invalid_rows', 'Send 1-5000 rows per request');
    const defSection = v.int(ctx.body.section_id, 'section_id', { min: 1, optional: true });
    const sections = new Set(db.prepare('SELECT id FROM sections').all().map(s => s.id));
    if (defSection && !sections.has(defSection)) throw bad('invalid_section', 'Unknown section');
    const out = { created: 0, updated: 0, errors: [] }, touched = new Set();
    tx(db, () => {
      const find = db.prepare('SELECT id FROM students WHERE roll=?'), ins = db.prepare('INSERT INTO students(roll,name,phone,section_id,created_at) VALUES (?,?,?,?,?)'), upd = db.prepare('UPDATE students SET name=?, phone=COALESCE(?,phone), section_id=? WHERE id=?');
      rows.forEach((row, i) => {
        try {
          const roll = stuFields.roll(row.roll), name = stuFields.name(row.name), phone = stuFields.phone(row.phone), sec = row.section_id != null ? stuFields.section_id(row.section_id) : defSection;
          if (sec && !sections.has(sec)) throw bad('invalid_section', 'Unknown section');
          const ex = find.get(roll);
          if (ex) { upd.run(name, phone, sec ?? null, ex.id); out.updated++; touched.add(ex.id); } else { const res = ins.run(roll, name, phone, sec ?? null, now()); touched.add(Number(res.lastInsertRowid)); out.created++; }
        } catch (e) { out.errors.push({ row: i + 1, error: e.message }); }
      });
      for (const id of touched) syncStudent(db, id);
    });
    audit(db, ctx.user, 'students.import', 'student', null, { created: out.created, updated: out.updated, errors: out.errors.length }, ctx.ip);
    return out;
  });
  /** Generate logins (roll number + random password) for every student of a section that has none. Hashing is done here, not at import time, so a 30,000-row import stays fast. */
  r.post('/api/admin/sections/:id/create-logins', ADMIN, async ctx => {
    const sid = v.int(ctx.params.id, 'id', { min: 1 }); if (!db.prepare('SELECT 1 FROM sections WHERE id=?').get(sid)) throw notFound();
    const list = db.prepare("SELECT id,roll,name,phone FROM students WHERE section_id=? AND user_id IS NULL AND status='active' ORDER BY roll LIMIT 500").all(sid);
    const creds = await mapLimit(list, 4, async s => { const pw = generatePassword(); return { s, pw, hash: await hashPassword(pw, { generated: true }) }; });
    const out = [];
    tx(db, () => {
      for (const { s, pw, hash } of creds) {
        const email = `${s.roll.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}@student.local`;
        const res = db.prepare("INSERT INTO users(email,name,role,pw_hash,must_change,phone,created_at) VALUES (?,?,'student',?,1,?,?)").run(email, s.name, hash, s.phone, now());
        db.prepare('UPDATE students SET user_id=? WHERE id=?').run(Number(res.lastInsertRowid), s.id);
        out.push({ roll: s.roll, name: s.name, login: s.roll, password: pw });
      }
    });
    audit(db, ctx.user, 'students.create_logins', 'section', sid, { count: out.length }, ctx.ip);
    return { created: out.length, remaining: db.prepare("SELECT COUNT(*) c FROM students WHERE section_id=? AND user_id IS NULL AND status='active'").get(sid).c, credentials: out };
  });

  /* ---------- ops ---------- */
  r.get('/api/admin/audit', ADMIN, ctx => {
    const lim = Math.min(+ctx.query.limit || 100, 500), where = [], args = [];
    if (ctx.query.before) { where.push('a.id < ?'); args.push(v.int(ctx.query.before, 'before')); }
    if (ctx.query.action) { where.push('a.action LIKE ?'); args.push(String(ctx.query.action).slice(0, 40) + '%'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return db.prepare(`SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ${w} ORDER BY a.id DESC LIMIT ?`).all(...args, lim);
  });
  r.get('/api/admin/stats', ADMIN, () => {
    const n = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; const lb = db.prepare("SELECT value FROM settings WHERE key='last_backup'").get();
    const bf = latestBackup();
    let size = null; try { size = statSync(db.name || '').size; } catch { /* in-memory */ }
    return { users: n('users'), students: n('students'), offerings: n('offerings'), sessions: n('lecture_sessions'), attendance: n('attendance'), push_subs: n('push_subs'), db_bytes: size,
      last_backup: lb ? +lb.value : null, latest_backup_file: bf, backup_configured: !!config.backupDir };
  });
  r.post('/api/admin/backup', ADMIN, ctx => { if (!config.backupDir) throw bad('no_backup_dir', 'GMC_BACKUP_DIR is not set'); const res = backupNow(db); audit(db, ctx.user, 'backup.run', 'db', null, { size: res.size }, ctx.ip); return { ok: true, size: res.size, students: res.students, attendance: res.attendance }; });
  r.get('/api/admin/settings', ADMIN, () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(s => [s.key, s.value])));
  r.put('/api/admin/settings', ADMIN, ctx => {
    const allowed = { min_pct: [1, 99], warn_pct: [1, 100], leave_counts: [0, 1], late_counts: [0, 1] };
    for (const [k, [lo, hi]] of Object.entries(allowed)) if (k in ctx.body) db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v.int(ctx.body[k], k, { min: lo, max: hi })));
    audit(db, ctx.user, 'settings.update', 'settings', null, ctx.body, ctx.ip); return { ok: true };
  });
}
