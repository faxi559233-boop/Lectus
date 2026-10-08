// Builds a university-sized database with the REAL schema: 30,000 students, 1,500 teachers, 600 sections x 6 offerings, 40 lectures each (7.2M attendance rows).
// Usage: node --no-warnings seed-real.mjs <data-dir>
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
process.env.GMC_SCRYPT_N = '1024';
const dir = process.argv[2] || './data-real'; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const { openDb, STATS_TRIGGERS, STATS_BACKFILL } = await import('../server/db.mjs');
const db = openDb(join(dir, 'gmc.db')); db.exec('PRAGMA synchronous=OFF; PRAGMA journal_mode=OFF;');
for (const t of ['att_stats_ai', 'att_stats_au', 'att_stats_ad']) db.exec(`DROP TRIGGER ${t}`);   // bulk load: rebuild stats once at the end instead of per row
const STUDENTS = 30000, SECTIONS = 600, PER = 50, TEACHERS = 1500, LECT = 40, OFF_PER = 6, t = Date.now();
const sha = s => createHash('sha256').update(s).digest('hex'); const tokens = { students: [], teachers: [] };
const t0 = Date.now();
db.exec('BEGIN');
db.prepare("INSERT INTO departments(code,name) VALUES ('ALL','University')").run(); db.prepare("INSERT INTO programs(dept_id,code,name) VALUES (1,'P1','Program')").run(); db.prepare("INSERT INTO terms(name,active) VALUES ('Fall',1)").run();
const insU = db.prepare("INSERT INTO users(email,name,role,pw_hash,must_change,dept_id,created_at) VALUES (?,?,?,?,0,1,?)"), insS = db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,last_seen,expires_at) VALUES (?,?,?,?,?)');
const tokOf = uid => { const tok = randomBytes(18).toString('base64url'); insS.run(sha(tok), uid, t, t, t + 864e5 * 30); return tok; };
for (let i = 0; i < TEACHERS; i++) { const id = Number(insU.run(`t${i}@x.local`, `Teacher ${i}`, 'teacher', 'scrypt$x', t).lastInsertRowid); tokens.teachers.push({ id, tok: tokOf(id) }); }
for (let c = 0; c < OFF_PER; c++) db.prepare('INSERT INTO courses(dept_id,code,name) VALUES (1,?,?)').run('C' + c, 'Course ' + c);
for (let s = 0; s < SECTIONS; s++) { db.prepare('INSERT INTO sections(program_id,term_id,name) VALUES (1,1,?)').run('S' + s); for (let c = 0; c < OFF_PER; c++) db.prepare('INSERT INTO offerings(course_id,section_id,teacher_id) VALUES (?,?,?)').run(c + 1, s + 1, tokens.teachers[(s * OFF_PER + c) % TEACHERS].id); }
const insSt = db.prepare("INSERT INTO students(user_id,roll,name,section_id,created_at) VALUES (?,?,?,?,?)"), insE = db.prepare('INSERT INTO enrollments(student_id,offering_id) VALUES (?,?)');
for (let i = 0; i < STUDENTS; i++) {
  const uid = Number(insU.run(`s${i}@student.local`, `Student ${i}`, 'student', 'scrypt$x', t).lastInsertRowid), sec = Math.floor(i / PER);
  const sid = Number(insSt.run(uid, `R${String(i).padStart(5, '0')}`, `Student ${i}`, sec + 1, t).lastInsertRowid); tokens.students.push({ id: sid, sec, tok: tokOf(uid) });
  for (let c = 0; c < OFF_PER; c++) insE.run(sid, sec * OFF_PER + c + 1);
}
db.exec('COMMIT'); console.log(`orgs+users+enrollments: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const t1 = Date.now(); db.exec('BEGIN');
const insL = db.prepare('INSERT INTO lecture_sessions(offering_id,date,topic,created_by,created_at) VALUES (?,?,?,?,?)'), insA = db.prepare("INSERT INTO attendance(session_id,student_id,status,method,marked_by,marked_at,updated_at) VALUES (?,?,?,'manual',1,?,?)");
let rows = 0;
for (let o = 1; o <= SECTIONS * OFF_PER; o++) {
  const sec = Math.floor((o - 1) / OFF_PER), first = sec * PER + 1;
  for (let l = 0; l < LECT; l++) { const sid = Number(insL.run(o, `2026-09-${String((l % 28) + 1).padStart(2, '0')}`, null, 1, t).lastInsertRowid); for (let k = 0; k < PER; k++) { insA.run(sid, first + k, (k + l + o) % 9 === 0 ? 'A' : 'P', t, t); rows++; } }
  if (o % 300 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
}
db.exec('COMMIT'); console.log(`attendance: ${rows.toLocaleString()} rows in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
// one OPEN check-in window per section (offering 1 of each section) with a known secret, and the code students will type
const secrets = []; const open = db.prepare('UPDATE lecture_sessions SET code_secret=?, code_until=? WHERE id=?');
const mkSess = db.prepare('INSERT INTO lecture_sessions(offering_id,date,topic,created_by,created_at) VALUES (?,?,?,?,?)');
for (let s = 0; s < SECTIONS; s++) { const sec = randomBytes(8).toString('hex'); const sid = Number(mkSess.run(s * OFF_PER + 1, '2026-10-08', 'live', 1, t).lastInsertRowid); open.run(sec, t + 3600e3 * 24 * 365, sid); secrets.push({ sid, secret: sec, off: s * OFF_PER + 1 }); }
const tS = Date.now(); db.exec('BEGIN'); db.exec(STATS_BACKFILL); db.exec('COMMIT'); db.exec(STATS_TRIGGERS); console.log(`stats backfill (${db.prepare('SELECT COUNT(*) c FROM stats').get().c.toLocaleString()} rows): ${((Date.now() - tS) / 1000).toFixed(1)}s`);
db.exec('ANALYZE'); db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE)'); db.close();
import('node:fs').then(fs => fs.writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ students: tokens.students, teachers: tokens.teachers, secrets })));
console.log('done');
