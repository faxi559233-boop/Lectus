import { DatabaseSync } from 'node:sqlite';
import { PRAGMAS, SCHEMA, STUDENTS, SECTION, SUBJECTS, LECTURES, sessionId } from './schema.mjs';
import { unlinkSync, existsSync } from 'node:fs';
const file = process.argv[2] || 'bench.db';
for (const f of [file, file + '-wal', file + '-shm']) if (existsSync(f)) unlinkSync(f);
const db = new DatabaseSync(file); db.exec(PRAGMAS); db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;'); db.exec(SCHEMA.replace('CREATE INDEX IF NOT EXISTS att_session ON att(session_id);', ''));
const ins = db.prepare('INSERT INTO att VALUES (?,?,?,?)');
const t0 = Date.now(); let n = 0; const now = Date.now();
db.exec('BEGIN');
for (let s = 0; s < STUDENTS; s++) {
  const sec = Math.floor(s / SECTION);
  for (let sub = 0; sub < SUBJECTS; sub++) for (let l = 0; l < LECTURES; l++) { ins.run(s, sessionId(sec, sub, l), (s + l) % 9 === 0 ? 0 : 1, now); n++; }
  if (s % 2000 === 1999) { db.exec('COMMIT'); db.exec('BEGIN'); }
}
db.exec('COMMIT');
console.log(`inserted ${n.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const t1 = Date.now(); db.exec('CREATE INDEX att_session ON att(session_id)'); console.log(`index built in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
db.exec('PRAGMA journal_mode=WAL; ANALYZE;'); db.close();
