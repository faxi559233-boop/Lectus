// All runtime configuration comes from environment variables (see deploy/gmc.env.example).
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
export const config = {
  port: +(env.PORT || 8787),
  host: env.HOST || '127.0.0.1',
  dataDir: resolve(env.GMC_DATA || resolve(here, 'data')),
  staticDir: resolve(env.GMC_STATIC || resolve(here, '..')),
  backupDir: env.GMC_BACKUP_DIR ? resolve(env.GMC_BACKUP_DIR) : null,
  backupKeepDays: +(env.GMC_BACKUP_KEEP_DAYS || 14),
  backupHour: +(env.GMC_BACKUP_HOUR || 2),
  secureCookies: env.GMC_INSECURE_COOKIES !== '1',        // set to 1 only for plain-HTTP local testing
  trustProxy: env.GMC_TRUST_PROXY === '1',                // behind Caddy: read client IP from X-Forwarded-For
  scryptN: +(env.GMC_SCRYPT_N || 32768),                   // 2^15: used for passwords people choose themselves
  scryptNGenerated: +(env.GMC_SCRYPT_N_GENERATED || 1024),   // system-generated passwords carry 96 bits of entropy, so a fast hash is safe and keeps first-day login storms cheap
  maxPendingAuth: +(env.GMC_MAX_AUTH_QUEUE || 120),         // password checks allowed to wait; beyond this we answer 503 instead of freezing
  sessionIdleMs: 12 * 3600e3,
  sessionMaxMs: 30 * 24 * 3600e3,
  defaultMinPct: +(env.GMC_MIN_PCT || 75),
  pushRatePerSec: +(env.GMC_PUSH_RATE || 40),
  pushContact: env.GMC_PUSH_CONTACT || 'mailto:admin@example.com',
  logRequests: env.GMC_LOG !== '0',
};
