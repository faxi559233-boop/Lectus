import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.mjs';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const q = s => s.replace(/'/g, "''");
export function countRows(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    const ic = d.prepare('PRAGMA integrity_check').get().integrity_check;
    const n = t => d.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    return { integrity: ic, users: n('users'), students: n('students'), sessions: n('lecture_sessions'), attendance: n('attendance') };
  } finally { d.close(); }
}
/** Consistent online backup using VACUUM INTO, verified by re-opening it. */
export function backupNow(db, dir = config.backupDir, keepDays = config.backupKeepDays) {
  if (!dir) throw new Error('GMC_BACKUP_DIR is not configured');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `gmc-${stamp()}.db`);
  db.exec(`VACUUM INTO '${q(file)}'`);
  const check = countRows(file);
  if (check.integrity !== 'ok') throw new Error('Backup failed integrity check: ' + check.integrity);
  const cutoff = Date.now() - keepDays * 86400e3; let removed = 0;
  for (const f of readdirSync(dir)) { if (!/^gmc-.*\.db$/.test(f)) continue; const p = join(dir, f); if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); removed++; } }
  db.prepare("INSERT INTO settings(key,value) VALUES ('last_backup', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(Date.now()));
  return { file, size: statSync(file).size, ...check, removed };
}
export function latestBackup(dir = config.backupDir) {
  if (!dir || !existsSync(dir)) return null;
  const f = readdirSync(dir).filter(x => /^gmc-.*\.db$/.test(x)).sort().pop();
  return f ? join(dir, f) : null;
}
/** Restore drill: open the newest backup read-only and compare row counts with the live database. */
export function restoreDrill(db, dir = config.backupDir) {
  const f = latestBackup(dir); if (!f) throw new Error('No backup found');
  const b = countRows(f);
  const n = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  const live = { users: n('users'), students: n('students'), sessions: n('lecture_sessions'), attendance: n('attendance') };
  return { file: f, integrity: b.integrity, backup: b, live, ok: b.integrity === 'ok' && b.users <= live.users && b.attendance <= live.attendance };
}
export function scheduleBackups(db) {
  if (!config.backupDir) return null;
  const t = setInterval(() => {
    const d = new Date(); if (d.getHours() !== config.backupHour) return;
    const last = +(db.prepare("SELECT value FROM settings WHERE key='last_backup'").get()?.value || 0);
    if (Date.now() - last < 20 * 3600e3) return;
    try { const r = backupNow(db); console.log('[backup] ok', r.file, r.size); } catch (e) { console.error('[backup] FAILED', e.message); }
  }, 60e3); t.unref(); return t;
}
