import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { config } from '../config.mjs';
import { SECURITY_HEADERS } from './router.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xlsx': 'application/octet-stream' };
const TOP = new Set(['index.html', 'styles.css', 'app.js', 'ui.js', 'icons.js', 'xlsx.js', 'i18n.js', 'sw.js', 'manifest.webmanifest']);
const DIRS = ['icons', 'portal'];

/** Only an explicit allow-list of public files is ever served (never server/, data/, docs/, .git). */
export function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400, SECURITY_HEADERS); return res.end(); }
  if (p === '/') p = '/index.html';
  if (p === '/portal' || p === '/portal/') p = '/portal/index.html';
  const rel = normalize(p).replace(/^[/\\]+/, '');
  const first = rel.split(sep)[0];
  const allowed = (rel.includes(sep) ? DIRS.includes(first) : TOP.has(rel)) && !rel.includes('..') && !rel.split(sep).some(s => s.startsWith('.'));
  const file = join(config.staticDir, rel);
  let st; try { st = allowed && file.startsWith(config.staticDir) ? statSync(file) : null; } catch { st = null; }
  if (!st || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain', ...SECURITY_HEADERS }); return res.end('Not found'); }
  const type = TYPES[extname(file)] || 'application/octet-stream'; const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
  const headers = { 'content-type': type, etag, ...SECURITY_HEADERS, 'cache-control': /\.html$|sw\.js$|manifest/.test(file) ? 'no-cache' : 'public, max-age=3600' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  const gz = /text|javascript|json|svg|manifest/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gz) { headers['content-encoding'] = 'gzip'; headers.vary = 'Accept-Encoding'; } else headers['content-length'] = st.size;
  res.writeHead(200, headers); if (req.method === 'HEAD') return res.end();
  const s = createReadStream(file); gz ? s.pipe(createGzip()).pipe(res) : s.pipe(res);
}
