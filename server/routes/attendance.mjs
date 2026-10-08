import { createHmac, randomBytes } from 'node:crypto';
import { v, HttpError, now, today, bad, notFound } from '../lib/util.mjs';
import { audit } from '../lib/audit.mjs';
import { tx } from '../db.mjs';
import { loadOffering, loadSession, canView, needMark, needView } from '../lib/access.mjs';
import { getSettings, perStudentForOffering, decorate } from '../lib/stats.mjs';

const TEACH = { auth: ['teacher', 'admin'] }, VIEW = { auth: ['teacher', 'admin', 'hod'] };
export const BUCKET_MS = 30000;
export const codeFor = (secret, bucket) => String(createHmac('sha256', secret).update(String(bucket)).digest().readUInt32BE(0) % 1000000).padStart(6, '0');

export default function (r, db) {
  r.get('/api/my/offerings', VIEW, ctx => {
    const u = ctx.user; const where = u.role === 'teacher' ? 'o.teacher_id=?' : u.role === 'hod' ? 'c.dept_id=?' : '1=1'; const args = u.role === 'admin' ? [] : [u.role === 'teacher' ? u.id : u.dept_id];
    return db.prepare(`SELECT o.id, o.room, o.days, o.start_time, o.min_pct, c.code AS course_code, c.name AS course_name, sec.name AS section_name, p.code AS program_code, t.name AS teacher_name,
        (SELECT COUNT(*) FROM enrollments e WHERE e.offering_id=o.id) AS enrolled, (SELECT COUNT(*) FROM lecture_sessions s WHERE s.offering_id=o.id) AS lectures,
        (SELECT MAX(date) FROM lecture_sessions s WHERE s.offering_id=o.id) AS last_date
      FROM offerings o JOIN courses c ON c.id=o.course_id JOIN sections sec ON sec.id=o.section_id JOIN programs p ON p.id=sec.program_id LEFT JOIN users t ON t.id=o.teacher_id
      WHERE ${where} ORDER BY c.code, sec.name LIMIT 500`).all(...args);
  });
  r.get('/api/offerings/:id/sessions', VIEW, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); needView(ctx.user, o);
    return { offering: o, sessions: db.prepare(`SELECT s.id, s.date, s.topic, s.code_until,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id=s.id) AS marked, (SELECT COUNT(*) FROM attendance a WHERE a.session_id=s.id AND a.status IN ('P','T')) AS present
      FROM lecture_sessions s WHERE s.offering_id=? ORDER BY s.date DESC, s.id DESC LIMIT 300`).all(o.id) };
  });
  r.post('/api/offerings/:id/sessions', TEACH, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); needMark(ctx.user, o);
    const date = v.date(ctx.body.date ?? today(), 'date'), topic = v.str(ctx.body.topic, 'topic', { max: 160, optional: true });
    if (date > new Date(Date.now() + 86400e3).toISOString().slice(0, 10)) throw bad('future_date', 'Date cannot be in the future');
    const res = db.prepare('INSERT INTO lecture_sessions(offering_id,date,topic,created_by,created_at) VALUES (?,?,?,?,?)').run(o.id, date, topic, ctx.user.id, now());
    const id = Number(res.lastInsertRowid); audit(db, ctx.user, 'session.create', 'session', id, { offering: o.id, date }, ctx.ip); ctx.status = 201; return { id, date, topic };
  });
  r.get('/api/sessions/:id', VIEW, ctx => {
    const s = loadSession(db, v.int(ctx.params.id, 'id', { min: 1 })), o = loadOffering(db, s.offering_id); needView(ctx.user, o);
    const roster = db.prepare(`SELECT st.id, st.roll, st.name, a.status, a.method FROM enrollments e JOIN students st ON st.id=e.student_id
      LEFT JOIN attendance a ON a.session_id=? AND a.student_id=st.id WHERE e.offering_id=? AND st.status='active' ORDER BY st.roll`).all(s.id, o.id);
    return { session: { id: s.id, offering_id: o.id, date: s.date, topic: s.topic, checkin_open: s.code_until > now(), checkin_until: s.code_until || null, geo: s.geo_lat != null }, offering: { id: o.id, course_code: o.course_code, course_name: o.course_name, section_name: o.section_name }, roster };
  });
  r.put('/api/sessions/:id', TEACH, ctx => {
    const s = loadSession(db, v.int(ctx.params.id, 'id', { min: 1 })), o = loadOffering(db, s.offering_id); needMark(ctx.user, o);
    const date = 'date' in ctx.body ? v.date(ctx.body.date, 'date') : s.date, topic = 'topic' in ctx.body ? v.str(ctx.body.topic, 'topic', { max: 160, optional: true }) : s.topic;
    db.prepare('UPDATE lecture_sessions SET date=?, topic=? WHERE id=?').run(date, topic, s.id); audit(db, ctx.user, 'session.update', 'session', s.id, { date, topic }, ctx.ip); return { ok: true };
  });
  r.del('/api/sessions/:id', TEACH, ctx => {
    const s = loadSession(db, v.int(ctx.params.id, 'id', { min: 1 })), o = loadOffering(db, s.offering_id); needMark(ctx.user, o);
    const n = db.prepare('SELECT COUNT(*) c FROM attendance WHERE session_id=?').get(s.id).c;
    tx(db, () => { db.prepare('DELETE FROM attendance WHERE session_id=?').run(s.id); db.prepare('DELETE FROM lecture_sessions WHERE id=?').run(s.id); });   // delete children first so the stats triggers can still see the parent
    audit(db, ctx.user, 'session.delete', 'session', s.id, { offering: o.id, date: s.date, records: n }, ctx.ip); return { ok: true };
  });

  /** Idempotent batch save. Offline clients retry with the same op_id and get the first result back. */
  r.put('/api/sessions/:id/marks', TEACH, ctx => {
    const s = loadSession(db, v.int(ctx.params.id, 'id', { min: 1 })), o = loadOffering(db, s.offering_id); needMark(ctx.user, o);
    const opId = v.str(ctx.body.op_id, 'op_id', { min: 8, max: 64, optional: true, re: /^[A-Za-z0-9_-]+$/ });
    if (opId) { const prev = db.prepare('SELECT result FROM ops WHERE op_id=? AND user_id=?').get(opId, ctx.user.id); if (prev) return { ...JSON.parse(prev.result), replayed: true }; }
    const marks = ctx.body.marks; if (!Array.isArray(marks) || !marks.length || marks.length > 600) throw bad('invalid_marks', 'Send 1-600 marks');
    const parsed = marks.map(m => ({ id: v.int(m.student_id, 'student_id', { min: 1 }), st: v.oneOf(m.status, 'status', ['P', 'A', 'L', 'T']) }));
    const enrolled = new Set(db.prepare('SELECT student_id FROM enrollments WHERE offering_id=?').all(o.id).map(x => x.student_id));
    const stranger = parsed.filter(p => !enrolled.has(p.id)).map(p => p.id); if (stranger.length) throw bad('not_enrolled', `Students not enrolled in this course: ${stranger.slice(0, 5).join(', ')}`);
    const t = now(); let saved = 0, changed = 0;
    tx(db, () => {
      const get = db.prepare('SELECT status FROM attendance WHERE session_id=? AND student_id=?'), ins = db.prepare("INSERT INTO attendance(session_id,student_id,status,method,marked_by,marked_at,updated_at) VALUES (?,?,?,'manual',?,?,?)"),
        upd = db.prepare("UPDATE attendance SET status=?, method='manual', marked_by=?, updated_at=? WHERE session_id=? AND student_id=?");
      for (const p of parsed) {
        const ex = get.get(s.id, p.id);
        if (!ex) { ins.run(s.id, p.id, p.st, ctx.user.id, t, t); saved++; }
        else if (ex.status !== p.st) { upd.run(p.st, ctx.user.id, t, s.id, p.id); changed++; audit(db, ctx.user, 'attendance.change', 'attendance', `${s.id}:${p.id}`, { from: ex.status, to: p.st }, ctx.ip); }
      }
      audit(db, ctx.user, 'attendance.mark', 'session', s.id, { saved, changed, total: parsed.length }, ctx.ip);
      const result = { saved, changed, total: parsed.length };
      if (opId) db.prepare('INSERT OR IGNORE INTO ops(op_id,user_id,ts,result) VALUES (?,?,?,?)').run(opId, ctx.user.id, t, JSON.stringify(result));
    });
    return { saved, changed, total: parsed.length };
  });

  /* ---------- rotating check-in code ---------- */
  r.post('/api/sessions/:id/checkin/open', TEACH, ctx => {
    const s = loadSession(db, v.int(ctx.params.id, 'id', { min: 1 })), o = loadOffering(db, s.offering_id); needMark(ctx.user, o);
    const minutes = v.int(ctx.body.minutes ?? 10, 'minutes', { min: 1, max: 60 });
    const lat = v.num(ctx.body.lat, 'lat', { min: -90, max: 90, optional: true }), lon = v.num(ctx.body.lon, 'lon', { min: -180, max: 180, optional: true }), radius = v.int(ctx.body.radius ?? 150, 'radius', { min: 20, max: 5000 });
    if ((lat == null) !== (lon == null)) throw bad('geo', 'Send both lat and lon, or neither');
    const until = now() + minutes * 60e3;
    db.prepare('UPDATE lecture_sessions SET code_secret=?, code_until=?, geo_lat=?, geo_lon=?, geo_radius=? WHERE id=?').run(randomBytes(24).toString('hex'), until, lat, lon, lat == null ? null : radius, s.id);
    audit(db, ctx.user, 'checkin.open', 'session', s.id, { minutes, geo: lat != null }, ctx.ip); return { until, geo: lat != null };
  });
  r.post('/api/sessions/:id/checkin/close', TEACH, ctx => {
    const s = loadSession(db, v.int(ctx.params.id, 'id', { min: 1 })), o = loadOffering(db, s.offering_id); needMark(ctx.user, o);
    db.prepare('UPDATE lecture_sessions SET code_until=0 WHERE id=?').run(s.id); audit(db, ctx.user, 'checkin.close', 'session', s.id, null, ctx.ip); return { ok: true };
  });
  r.get('/api/sessions/:id/checkin', TEACH, ctx => {
    const s = loadSession(db, v.int(ctx.params.id, 'id', { min: 1 })), o = loadOffering(db, s.offering_id); needMark(ctx.user, o);
    if (!s.code_secret || s.code_until <= now()) return { open: false };
    const t = now(), bucket = Math.floor(t / BUCKET_MS);
    const present = db.prepare("SELECT COUNT(*) c FROM attendance WHERE session_id=? AND method='code'").get(s.id).c;
    return { open: true, code: codeFor(s.code_secret, bucket), expires_in_ms: (bucket + 1) * BUCKET_MS - t, until: s.code_until, checked_in: present };
  });

  /* ---------- per-course summary & reminders ---------- */
  r.get('/api/offerings/:id/summary', VIEW, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); needView(ctx.user, o); const set = getSettings(db);
    const stats = new Map(perStudentForOffering(db, o.id).map(x => [x.student_id, x]));
    const items = db.prepare("SELECT st.id, st.roll, st.name, st.phone FROM enrollments e JOIN students st ON st.id=e.student_id WHERE e.offering_id=? AND st.status='active' ORDER BY st.roll").all(o.id)
      .map(st => ({ ...st, ...decorate(stats.get(st.id) || { P: 0, A: 0, L: 0, T: 0, total: 0 }, o.min_pct, set) }));
    return { offering: { id: o.id, course_code: o.course_code, course_name: o.course_name, section_name: o.section_name, min: o.min_pct || set.min_pct }, items };
  });
  r.post('/api/offerings/:id/remind', TEACH, ctx => {
    const o = loadOffering(db, v.int(ctx.params.id, 'id', { min: 1 })); needMark(ctx.user, o); const set = getSettings(db);
    const stats = new Map(perStudentForOffering(db, o.id).map(x => [x.student_id, x]));
    const targets = db.prepare("SELECT st.id, st.user_id, st.name FROM enrollments e JOIN students st ON st.id=e.student_id WHERE e.offering_id=? AND st.status='active'").all(o.id)
      .map(st => ({ st, d: decorate(stats.get(st.id) || { P: 0, A: 0, L: 0, T: 0, total: 0 }, o.min_pct, set) })).filter(x => x.d.status === 'bad');
    let sent = 0, noAccount = 0; const t = now();
    tx(db, () => { for (const { st, d } of targets) { if (!st.user_id) { noAccount++; continue; }
      db.prepare('INSERT INTO notifications(user_id,title,body,url,created_at) VALUES (?,?,?,?,?)').run(st.user_id, `Attendance warning: ${o.course_code}`, `Your attendance in ${o.course_name} is ${d.pct}% (minimum ${d.min}%).${d.outlook && d.outlook.need ? ` Attend the next ${d.outlook.need} lectures to reach it.` : ''}`, '/portal/#/me', t); sent++; } });
    audit(db, ctx.user, 'attendance.remind', 'offering', o.id, { sent, noAccount }, ctx.ip); return { shortage: targets.length, sent, no_account: noAccount };
  });
}
