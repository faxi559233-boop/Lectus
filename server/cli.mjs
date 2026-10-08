// Operator commands:  node --no-warnings cli.mjs <command> [args]
import { openDb } from './db.mjs';
import { hashPassword, generatePassword, destroyAllSessions } from './lib/auth.mjs';
import { backupNow, restoreDrill } from './lib/backup.mjs';
import { seedDemo } from './lib/seed.mjs';
import { config } from './config.mjs';
import { audit } from './lib/audit.mjs';

const [cmd, ...args] = process.argv.slice(2);
const db = openDb();
const out = o => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
try {
  switch (cmd) {
    case 'create-admin': {
      const email = (args[0] || '').toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: create-admin <email> [name]');
      const pw = process.env.GMC_ADMIN_PASSWORD || generatePassword();
      db.prepare("INSERT INTO users(email,name,role,pw_hash,must_change,created_at) VALUES (?,?,'admin',?,1,?)").run(email, args[1] || 'Administrator', await hashPassword(pw), Date.now());
      audit(db, null, 'cli.create_admin', 'user', email, null, 'cli');
      out(`\nAdmin created.\n  login:    ${email}\n  password: ${pw}\n(You must change it at first login. This password is shown only once.)\n`); break;
    }
    case 'reset-password': {
      const u = db.prepare('SELECT id FROM users WHERE email=?').get((args[0] || '').toLowerCase()); if (!u) throw new Error('No such user');
      const pw = generatePassword(); db.prepare('UPDATE users SET pw_hash=?, must_change=1, failed=0, locked_until=0 WHERE id=?').run(await hashPassword(pw), u.id); destroyAllSessions(db, u.id);
      audit(db, null, 'cli.reset_password', 'user', u.id, null, 'cli'); out(`New one-time password: ${pw}`); break;
    }
    case 'seed-demo': out(await seedDemo(db, { students: +args[0] || 60, lectures: +args[1] || 0, password: process.env.GMC_DEMO_PASSWORD || 'demo-Password-123' })); break;
    case 'backup': out(backupNow(db)); break;
    case 'restore-drill': { const r = restoreDrill(db); out(r); if (!r.ok) process.exitCode = 1; break; }
    case 'stats': out(Object.fromEntries(['users', 'students', 'offerings', 'lecture_sessions', 'attendance', 'audit_log'].map(t => [t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]))); break;
    case 'migrate': out(`schema version ${db.prepare('PRAGMA user_version').get().user_version} (data: ${config.dataDir})`); break;
    default: out('Commands: create-admin <email> [name] | reset-password <email> | seed-demo [students] [lectures] | backup | restore-drill | stats | migrate');
  }
} catch (e) { console.error('Error:', e.message); process.exitCode = 1; } finally { db.close(); }
