import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.mjs';
import { now, HttpError } from './util.mjs';
const scryptAsync = promisify(scrypt);
const KEYLEN = 32;

export async function hashPassword(pw, { generated = false } = {}) {
  const salt = randomBytes(16), N = generated ? config.scryptNGenerated : config.scryptN;
  const key = await scryptAsync(pw, salt, KEYLEN, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
  return `scrypt$${N}$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scryptAsync(pw, Buffer.from(salt, 'base64'), KEYLEN, { N: +N, r: +r, p: +p, maxmem: 256 * +N * +r });
  const want = Buffer.from(hash, 'base64');
  return key.length === want.length && timingSafeEqual(key, want);
}
let DUMMY; export async function dummyVerify(pw) { DUMMY ||= await hashPassword('dummy-password-for-timing'); await verifyPassword(pw, DUMMY); }

const COMMON = new Set(['password', 'password1', '1234567890', 'qwertyuiop', 'iloveyou12', 'letmein123', 'admin12345', 'welcome123', 'changeme123', 'pakistan123']);
export function checkPasswordPolicy(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'weak_password', 'Password must be at least 10 characters');
  if (pw.length > 200) throw new HttpError(400, 'weak_password', 'Password too long');
  if (COMMON.has(pw.toLowerCase()) || (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase()) && email.length > 3))
    throw new HttpError(400, 'weak_password', 'Password is too easy to guess');
}
export const generatePassword = () => randomBytes(12).toString('base64url');   // 96 bits

/** Load shedding for the expensive part: if too many password checks are already waiting, fail fast with 503. */
let pendingAuth = 0;
export async function withAuthSlot(fn) {
  if (pendingAuth >= config.maxPendingAuth) { const e = new HttpError(503, 'busy', 'The server is busy signing people in. Please try again in a minute.'); e.headers = { 'retry-after': '20' }; throw e; }
  pendingAuth++; try { return await fn(); } finally { pendingAuth--; }
}
export const pendingAuthCount = () => pendingAuth;

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function createSession(db, userId, ip, ua) {
  const token = newToken(), t = now();
  db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,last_seen,expires_at,ip,ua) VALUES (?,?,?,?,?,?,?)')
    .run(sha256(token), userId, t, t, t + config.sessionMaxMs, ip || null, (ua || '').slice(0, 200));
  return token;
}
export function cookieHeader(token, maxAgeMs) {
  const parts = [`gmc_session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}
export const clearCookie = () => cookieHeader('', 0);
export function parseCookies(h = '') { const o = {}; for (const p of h.split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); } return o; }

/* last_seen is touched in memory and flushed in ONE transaction every few seconds (cheap even when 30,000 students arrive together) */
const seen = new Map(); const stmts = new WeakMap();
const prep = (db, k, sql) => { let m = stmts.get(db); if (!m) stmts.set(db, m = {}); return m[k] || (m[k] = db.prepare(sql)); };
export function flushSeen(db) {
  if (!seen.size) return; const batch = [...seen]; seen.clear();
  try { db.exec('BEGIN'); const u = db.prepare('UPDATE auth_sessions SET last_seen=? WHERE token_hash=?'); for (const [h, t] of batch) u.run(t, h); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch { /* none */ } }
}
export function startSeenFlusher(db) { const t = setInterval(() => flushSeen(db), 5000); t.unref(); return t; }
/** Returns the user for a request or null. */
export function authenticate(db, req) {
  const tok = parseCookies(req.headers.cookie).gmc_session; if (!tok || tok.length > 100) return null;
  const h = sha256(tok), t = now();
  const row = prep(db, 'auth', `SELECT s.last_seen, s.expires_at, u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(h);
  const last = Math.max(row ? row.last_seen : 0, seen.get(h) || 0);
  if (!row || !row.active || row.expires_at < t || last < t - config.sessionIdleMs) return null;
  if (t - last > 60000) seen.set(h, t);
  return { id: row.id, email: row.email, name: row.name, role: row.role, dept_id: row.dept_id, must_change: !!row.must_change, tokenHash: h };
}
export const destroySession = (db, tokenHash) => db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash);
export const destroyAllSessions = (db, userId) => db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId);

/* tiny fixed-window limiter (memory only; resets on restart) */
export class Limiter {
  constructor(max, windowMs) { this.max = max; this.win = windowMs; this.m = new Map(); }
  hit(key) { const t = now(), e = this.m.get(key); if (!e || e.reset < t) { this.m.set(key, { n: 1, reset: t + this.win }); return true; } e.n++; return e.n <= this.max; }
  peek(key) { const e = this.m.get(key); return !e || e.reset < now() || e.n < this.max; }
  sweep() { const t = now(); for (const [k, e] of this.m) if (e.reset < t) this.m.delete(k); }
}
