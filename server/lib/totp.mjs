/* RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s) for authenticator apps. No dependencies. */
import { createHmac, randomBytes } from 'node:crypto';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newSecret = () => { const b = randomBytes(20); let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; };
const decode = s => { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) throw new Error('bad base32'); bits += i.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export function hotp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', decode(secret)).update(buf).digest(), o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, '0');
}
/** Returns the matching time step (so the caller can refuse a replay) or null. Accepts one step either side for clock drift. */
export function verifyTotp(secret, code, now = Date.now(), after = 0) {
  if (!/^\d{6}$/.test(String(code))) return null; const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) { const c = step + d; if (c > after && hotp(secret, c) === code) return c; }
  return null;
}
export const otpauthUri = (secret, account, issuer = 'GMC Check-in') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
