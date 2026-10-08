import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';

export const STATS_TRIGGERS = `
CREATE TRIGGER att_stats_ai AFTER INSERT ON attendance BEGIN
  INSERT INTO stats(offering_id,student_id,P,A,L,T,total)
    SELECT offering_id, NEW.student_id, NEW.status='P', NEW.status='A', NEW.status='L', NEW.status='T', 1 FROM lecture_sessions WHERE id=NEW.session_id
  ON CONFLICT(offering_id,student_id) DO UPDATE SET P=P+excluded.P, A=A+excluded.A, L=L+excluded.L, T=T+excluded.T, total=total+1;
END;
CREATE TRIGGER att_stats_au AFTER UPDATE OF status ON attendance WHEN OLD.status<>NEW.status BEGIN
  UPDATE stats SET P=P-(OLD.status='P')+(NEW.status='P'), A=A-(OLD.status='A')+(NEW.status='A'), L=L-(OLD.status='L')+(NEW.status='L'), T=T-(OLD.status='T')+(NEW.status='T')
    WHERE student_id=NEW.student_id AND offering_id=(SELECT offering_id FROM lecture_sessions WHERE id=NEW.session_id);
END;
CREATE TRIGGER att_stats_ad AFTER DELETE ON attendance BEGIN
  UPDATE stats SET P=P-(OLD.status='P'), A=A-(OLD.status='A'), L=L-(OLD.status='L'), T=T-(OLD.status='T'), total=total-1
    WHERE student_id=OLD.student_id AND offering_id=(SELECT offering_id FROM lecture_sessions WHERE id=OLD.session_id);
END;
`;
export const STATS_BACKFILL = `
INSERT OR REPLACE INTO stats(offering_id,student_id,P,A,L,T,total)
  SELECT s.offering_id, a.student_id, SUM(a.status='P'), SUM(a.status='A'), SUM(a.status='L'), SUM(a.status='T'), COUNT(*)
  FROM attendance a JOIN lecture_sessions s ON s.id=a.session_id GROUP BY s.offering_id, a.student_id;
`;
const MIGRATIONS = [`
CREATE TABLE departments(id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE users(
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','hod','teacher','student')),
  pw_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
  dept_id INTEGER REFERENCES departments(id), phone TEXT,
  failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_login INTEGER);
CREATE TABLE auth_sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, ua TEXT) WITHOUT ROWID;
CREATE INDEX auth_user ON auth_sessions(user_id);
CREATE TABLE programs(id INTEGER PRIMARY KEY, dept_id INTEGER NOT NULL REFERENCES departments(id), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE terms(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, starts TEXT, ends TEXT, active INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sections(
  id INTEGER PRIMARY KEY, program_id INTEGER NOT NULL REFERENCES programs(id), term_id INTEGER NOT NULL REFERENCES terms(id),
  name TEXT NOT NULL, semester_no INTEGER, UNIQUE(program_id, term_id, name));
CREATE TABLE courses(id INTEGER PRIMARY KEY, dept_id INTEGER NOT NULL REFERENCES departments(id), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, credits INTEGER);
CREATE TABLE offerings(
  id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id), section_id INTEGER NOT NULL REFERENCES sections(id),
  teacher_id INTEGER REFERENCES users(id), min_pct INTEGER, room TEXT, days TEXT, start_time TEXT, UNIQUE(course_id, section_id));
CREATE INDEX off_teacher ON offerings(teacher_id);
CREATE INDEX off_section ON offerings(section_id);
CREATE TABLE students(
  id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL, roll TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  phone TEXT, section_id INTEGER REFERENCES sections(id), status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL);
CREATE INDEX stu_section ON students(section_id);
CREATE TABLE enrollments(
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE, offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  PRIMARY KEY(offering_id, student_id)) WITHOUT ROWID;
CREATE INDEX enr_student ON enrollments(student_id);
CREATE TABLE lecture_sessions(
  id INTEGER PRIMARY KEY, offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE, date TEXT NOT NULL, topic TEXT,
  created_by INTEGER REFERENCES users(id), created_at INTEGER NOT NULL,
  code_secret TEXT, code_until INTEGER NOT NULL DEFAULT 0, geo_lat REAL, geo_lon REAL, geo_radius INTEGER);
CREATE INDEX ls_off ON lecture_sessions(offering_id, date);
CREATE INDEX ls_open ON lecture_sessions(code_until);
CREATE TABLE attendance(
  session_id INTEGER NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('P','A','L','T')), method TEXT NOT NULL DEFAULT 'manual', marked_by INTEGER,
  marked_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(session_id, student_id)) WITHOUT ROWID;
CREATE INDEX att_student ON attendance(student_id, session_id);
CREATE TABLE audit_log(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT);
CREATE INDEX audit_ts ON audit_log(ts);
CREATE TABLE push_subs(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0);
CREATE INDEX push_user ON push_subs(user_id);
CREATE TABLE notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL,
  url TEXT, created_at INTEGER NOT NULL, read_at INTEGER, pushed_at INTEGER);
CREATE INDEX notif_user ON notifications(user_id, created_at);
CREATE INDEX notif_pending ON notifications(pushed_at) WHERE pushed_at IS NULL;
CREATE TABLE announcements(
  id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('all','dept','section')), scope_id INTEGER,
  title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE ops(op_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, ts INTEGER NOT NULL, result TEXT) WITHOUT ROWID;
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
`,`
-- check-in lookups only ever need windows that are open right now; a sweeper clears code_until when a window expires
DROP INDEX IF EXISTS ls_open;
CREATE INDEX ls_open_p ON lecture_sessions(offering_id) WHERE code_until > 0;
`,`
-- running totals per (course offering, student): dashboards read this small table instead of scanning millions of attendance rows
CREATE TABLE stats(
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  P INTEGER NOT NULL DEFAULT 0, A INTEGER NOT NULL DEFAULT 0, L INTEGER NOT NULL DEFAULT 0, T INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(offering_id, student_id)) WITHOUT ROWID;
CREATE INDEX stats_student ON stats(student_id);
${STATS_TRIGGERS}${STATS_BACKFILL}`];

export function openDb(file) {
  if (!file) { mkdirSync(config.dataDir, { recursive: true, mode: 0o700 }); file = join(config.dataDir, 'gmc.db'); }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY;');
  const cur = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = cur; i < MIGRATIONS.length; i++) { db.exec('BEGIN'); try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version=${i + 1}`); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } }
  return db;
}
export const schemaVersion = MIGRATIONS.length;
export function tx(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ } throw e; } }
