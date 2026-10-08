import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GMC_SCRYPT_N = '2048'; process.env.GMC_SCRYPT_N_GENERATED = '1024'; process.env.GMC_INSECURE_COOKIES = '1'; process.env.GMC_LOG = '0';
process.env.GMC_DATA = mkdtempSync(join(tmpdir(), 'gmc-test-'));
const { createApp } = await import('../index.mjs');
const { seedDemo } = await import('../lib/seed.mjs');
export { seedDemo };
export const PW = 'demo-Password-123';

export async function boot({ seed = { students: 20 }, file, ...opts } = {}) {
  const app = await createApp({ dbFile: file || ':memory:', workers: false, ...opts });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  app.base = `http://127.0.0.1:${app.server.address().port}`;
  app.demo = seed ? await seedDemo(app.db, seed) : null;
  return app;
}
export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, path, body, { raw = false, headers = {}, csrf = true, ctype = 'application/json' } = {}) {
    const h = { ...headers }; if (this.cookie) h.cookie = this.cookie; if (csrf && method !== 'GET') h['x-gmc'] = '1';
    let payload; if (body !== undefined) { payload = typeof body === 'string' ? body : JSON.stringify(body); h['content-type'] = ctype; }
    const res = await fetch(this.base + path, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : []; for (const c of sc) { const kv = c.split(';')[0]; if (kv.endsWith('=')) this.cookie = ''; else this.cookie = kv; }
    if (raw) return res; const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  get(p, o) { return this.req('GET', p, undefined, o); } post(p, b = {}, o) { return this.req('POST', p, b, o); }
  put(p, b = {}, o) { return this.req('PUT', p, b, o); } del(p, o) { return this.req('DELETE', p, {}, o); }
  async login(id, pw = PW) { const r = await this.post('/api/auth/login', { email: id, password: pw }); return r; }
}
export async function as(app, id, pw = PW) { const c = new Client(app.base); const r = await c.login(id, pw); if (r.status !== 200) throw new Error(`login ${id} failed: ${r.status} ${r.text}`); return c; }
