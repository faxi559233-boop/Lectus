// Shared schema + tuning for the capacity benchmark (Node 22+, built-in node:sqlite).
export const PRAGMAS = `
  PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
  PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY;`;
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS att(
    student_id INTEGER NOT NULL, session_id INTEGER NOT NULL, status INTEGER NOT NULL, ts INTEGER NOT NULL,
    PRIMARY KEY(student_id, session_id)) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS att_session ON att(session_id);`;
// Model of one semester at a 30,000-student university:
//   600 sections x 50 students; every section has 6 subjects x 40 lectures => 144,000 sessions, 7.2M attendance rows.
export const STUDENTS = 30000, SECTION = 50, SUBJECTS = 6, LECTURES = 40;
export const sessionId = (sec, subj, lec) => (sec * SUBJECTS + subj) * LECTURES + lec + 1;
