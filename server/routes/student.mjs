import { v, HttpError, now, haversine, bad } from '../lib/util.mjs';
import { audit } from '../lib/audit.mjs';
import { studentOfUser } from '../lib/access.mjs';
import { getSettings, perOfferingForStudent, decorate } from '../lib/stats.mjs';
import { Limiter } from '../lib/auth.mjs';
import { codeFor, BUCKET_MS } from './attendance.mjs';

const STU = { auth: ['student'] };
const tries = new Limiter(10, 60e3);               // check-in attempts per student per minute
setInterval(() => tries.sweep(), 60e3).unref();

export default function (r, db) {
  r.get('/api/my/attendance', STU, ctx => {
    const st = studentOfUser(db, ctx.user.id), set = getSettings(db);
    const stats = new Map(perOfferingForStudent(db, st.id).map(x => [x.offering_id, x]));
    const offerings = db.prepare(`SELECT o.id AS offering_id, o.min_pct, c.code AS course_code, c.name AS course_name, t.name AS teacher_name,
        (SELECT COUNT(*) FROM lecture_sessions ls WHERE ls.offering_id=o.id) AS lectures_held
      FROM enrollments e JOIN offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id LEFT JOIN users t ON t.id=o.teacher_id WHERE e.student_id=? ORDER BY c.code`).all(st.id)
      .map(o => ({ ...o, ...decorate(stats.get(o.offering_id) || { P: 0, A: 0, L: 0, T: 0, total: 0 }, o.min_pct, set) }));
    const recent = db.prepare(`SELECT s.date, c.code AS course_code, c.name AS course_name, a.status FROM attendance a JOIN lecture_sessions s ON s.id=a.session_id
      JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id WHERE a.student_id=? ORDER BY s.date DESC, s.id DESC LIMIT 20`).all(st.id);
    const open = db.prepare(`SELECT s.id, c.code AS course_code, c.name AS course_name, s.code_until, (s.geo_lat IS NOT NULL) AS needs_location FROM lecture_sessions s JOIN enrollments e ON e.offering_id=s.offering_id
      JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id WHERE e.student_id=? AND s.code_until>0 AND s.code_until>?`).all(st.id, now());
    const tot = offerings.reduce((a, o) => ({ P: a.P + o.P, A: a.A + o.A, L: a.L + o.L, T: a.T + o.T, total: a.total + o.total }), { P: 0, A: 0, L: 0, T: 0, total: 0 });
    return { student: { roll: st.roll, name: st.name }, overall: decorate(tot, null, set), offerings, recent, open_checkins: open.map(o => ({ ...o, needs_location: !!o.needs_location })), min_pct: set.min_pct };
  });

  /** Student enters the rotating 6-digit code shown by the teacher. Accepts the current and previous 30 s window. */
  r.post('/api/checkin', STU, ctx => {
    if (!tries.hit(ctx.user.id)) throw new HttpError(429, 'too_many_attempts', 'Too many tries. Wait a minute.');
    const st = studentOfUser(db, ctx.user.id); const code = v.str(ctx.body.code, 'code', { min: 6, max: 6, re: /^\d{6}$/ });
    const lat = v.num(ctx.body.lat, 'lat', { min: -90, max: 90, optional: true }), lon = v.num(ctx.body.lon, 'lon', { min: -180, max: 180, optional: true });
    const t = now(), b = Math.floor(t / BUCKET_MS);
    const open = db.prepare(`SELECT s.* FROM lecture_sessions s JOIN enrollments e ON e.offering_id=s.offering_id WHERE e.student_id=? AND s.code_until>0 AND s.code_until>? AND s.code_secret IS NOT NULL`).all(st.id, t);
    const hit = open.find(s => code === codeFor(s.code_secret, b) || code === codeFor(s.code_secret, b - 1));
    if (!hit) throw new HttpError(400, 'invalid_code', 'Wrong or expired code');
    if (hit.geo_lat != null) {
      if (lat == null || lon == null) throw new HttpError(400, 'location_required', 'Turn on location to check in');
      const d = haversine(lat, lon, hit.geo_lat, hit.geo_lon); if (d > hit.geo_radius) throw new HttpError(403, 'too_far', 'You are not in the classroom area');
    }
    const ins = db.prepare("INSERT OR IGNORE INTO attendance(session_id,student_id,status,method,marked_by,marked_at,updated_at) VALUES (?,?,'P','code',?,?,?)").run(hit.id, st.id, ctx.user.id, t, t);
    if (!ins.changes) { const ex = db.prepare('SELECT status FROM attendance WHERE session_id=? AND student_id=?').get(hit.id, st.id); return { ok: true, already: true, status: ex.status, session_id: hit.id }; }
    // no audit row here: the attendance row itself (method='code', marked_by, marked_at) is the record, and this path must stay cheap
    return { ok: true, status: 'P', session_id: hit.id };
  });
}
