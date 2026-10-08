import { HttpError } from './util.mjs';
import { authenticate } from './auth.mjs';
import { config } from '../config.mjs';

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=(self)',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
export function clientIp(req) {
  if (config.trustProxy) { const x = req.headers['x-forwarded-for']; if (x) return String(x).split(',')[0].trim().slice(0, 64); }
  return (req.socket.remoteAddress || '').replace('::ffff:', '');
}

export class Router {
  constructor(db) { this.db = db; this.routes = []; }
  add(method, path, opts, handler) {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const keys = []; const re = new RegExp('^' + path.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, opts, handler });
  }
  get(p, o, h) { this.add('GET', p, o, h); } post(p, o, h) { this.add('POST', p, o, h); }
  put(p, o, h) { this.add('PUT', p, o, h); } del(p, o, h) { this.add('DELETE', p, o, h); }

  send(res, status, body, extra = {}) {
    const b = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(b), 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra });
    res.end(b);
  }
  /** Returns true when the request was an /api request and has been handled. */
  async handle(req, res) {
    const url = new URL(req.url, 'http://x'); if (!url.pathname.startsWith('/api/')) return false;
    const t0 = performance.now(); let status = 500;
    try {
      const route = this.routes.find(r => r.method === req.method && r.re.test(url.pathname));
      if (!route) { if (this.routes.some(r => r.re.test(url.pathname))) throw new HttpError(405, 'method_not_allowed'); throw new HttpError(404, 'not_found'); }
      const m = url.pathname.match(route.re); const params = {}; route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), ip: clientIp(req), db: this.db, body: null, user: null, headers: {} };
      const writes = req.method !== 'GET' && req.method !== 'HEAD';
      if (writes) {
        if (req.headers['x-gmc'] !== '1') throw new HttpError(403, 'csrf', 'Missing X-GMC header');
        ctx.body = await readJson(req);
      }
      if (route.opts.auth !== false) {
        ctx.user = authenticate(this.db, req);
        if (!ctx.user) throw new HttpError(401, 'unauthenticated', 'Please log in');
        if (ctx.user.must_change && !route.opts.allowMustChange) throw new HttpError(403, 'must_change_password', 'Change your password first');
        if (Array.isArray(route.opts.auth) && !route.opts.auth.includes(ctx.user.role)) throw new HttpError(403, 'forbidden', 'Your role cannot do this');
      }
      const out = await route.handler(ctx);
      status = ctx.status || 200;
      if (out && out.__raw) this.send(res, status, out.body, { 'content-type': out.type, ...(out.headers || {}), ...ctx.headers });
      else this.send(res, status, out ?? { ok: true }, ctx.headers);
    } catch (e) {
      if (e instanceof HttpError) { status = e.status; this.send(res, e.status, { error: { code: e.code, message: e.message } }, e.headers || {}); }
      else if (e && e.code === 'ERR_BODY_TOO_LARGE') { status = 413; res.on('finish', () => req.destroy()); this.send(res, 413, { error: { code: 'too_large', message: 'Request too large' } }, { connection: 'close' }); }
      else { status = 500; console.error('[error]', req.method, url.pathname, e && e.stack || e); this.send(res, 500, { error: { code: 'server_error', message: 'Something went wrong' } }); }
    } finally {
      if (config.logRequests) console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: url.pathname, s: status, ms: Math.round(performance.now() - t0) }));
    }
    return true;
  }
}
function readJson(req, limit = 1_000_000) {
  return new Promise((ok, no) => {
    const ct = req.headers['content-type'] || '';
    let size = 0, over = false; const chunks = [];
    req.on('data', c => { size += c.length; if (over) return; if (size > limit) { over = true; chunks.length = 0; const e = new Error('too large'); e.code = 'ERR_BODY_TOO_LARGE'; no(e); } else chunks.push(c); });   // keep draining (discarding) so the 413 can be delivered
    req.on('end', () => {
      if (over) return;
      if (!size) return ok({});
      if (!ct.includes('application/json')) return no(new HttpError(415, 'unsupported_media', 'JSON required'));
      try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { no(new HttpError(400, 'bad_json', 'Invalid JSON')); }
    });
    req.on('error', no);
  });
}
