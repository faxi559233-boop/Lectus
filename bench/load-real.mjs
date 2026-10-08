// Load test against the REAL server (auth, permissions, audit, idempotency all active). Usage: node load-real.mjs <data-dir> [baseUrl]
import autocannon from 'autocannon';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
const dir = process.argv[2] || './data-real', BASE = process.argv[3] || 'http://localhost:8788';
const T = JSON.parse(readFileSync(dir + '/tokens.json', 'utf8')); const rnd = n => Math.floor(Math.random() * n);
const run = o => new Promise((ok, no) => autocannon({ url: BASE, ...o }, (e, r) => (e ? no(e) : ok(r))));
const codeFor = (secret, b) => String(createHmac('sha256', secret).update(String(b)).digest().readUInt32BE(0) % 1000000).padStart(6, '0');
const show = (n, r, need) => console.log(`${n.padEnd(46)} ${String(Math.round(r.requests.average)).padStart(5)} req/s | p50 ${String(r.latency.p50).padStart(4)}ms p97.5 ${String(r.latency.p97_5).padStart(4)}ms p99 ${String(r.latency.p99).padStart(4)}ms max ${String(r.latency.max).padStart(5)}ms | 2xx ${r['2xx']} non2xx ${r.non2xx} err ${r.errors}${need ? ` | need ${need}/s` : ''}`);
const H = (tok, extra = {}) => ({ cookie: 'gmc_session=' + tok, 'x-gmc': '1', 'content-type': 'application/json', ...extra });
let i = 0;
// 1) QR/code check-in storm: every one of 30,000 students checks in once
show('check-in: 30,000 students (unique inserts)', await run({ connections: 100, amount: 30000, requests: [{ method: 'POST', path: '/api/checkin', setupRequest: r => { const s = T.students[i++ % T.students.length]; const sec = T.secrets[s.sec]; r.headers = H(s.tok); r.body = JSON.stringify({ code: codeFor(sec.secret, Math.floor(Date.now() / 30000)) }); return r; } }] }), 250);
// 2) 600 teachers submit a 50-student register at the same moment
let k = 0; const rosterFor = ti => { const sec = ti; return Array.from({ length: 50 }, (_, j) => ({ student_id: sec * 50 + j + 1, status: j % 7 === 0 ? 'A' : 'P' })); };
show('teacher marks: 600 registers x 50 rows', await run({ connections: 100, amount: 600, requests: [{ method: 'PUT', setupRequest: r => { const sec = k++ % 600, sess = T.secrets[sec]; const teacher = T.teachers.find(t => t.id === 1 + ((sec * 6) % 1500) + 0) || T.teachers[(sec * 6) % 1500]; r.path = `/api/sessions/${sess.sid}/marks`; r.headers = H(teacher.tok); r.body = JSON.stringify({ op_id: 'load-' + sec + '-' + Date.now() + '-' + k, marks: rosterFor(sec) }); return r; } }] }), 100);
// 3) 30,000 students open "my attendance"
i = 0; show('student dashboard: 30,000 views', await run({ connections: 100, amount: 30000, requests: [{ method: 'GET', setupRequest: r => { const s = T.students[i++ % T.students.length]; r.path = '/api/my/attendance'; r.headers = H(s.tok); return r; } }] }), 100);
// 4) teacher roster load
k = 0; show('teacher roster: 3,000 views', await run({ connections: 50, amount: 3000, requests: [{ method: 'GET', setupRequest: r => { const sec = k++ % 600; r.path = '/api/sessions/' + T.secrets[sec].sid; r.headers = H(T.teachers[(sec * 6) % 1500].tok); return r; } }] }));
// 5) worst case: all 30,000 check in within 10 s
i = 0; show('WORST CASE: 30,000 check-ins in 10 s', await run({ connections: 1000, duration: 10, overallRate: 3000, requests: [{ method: 'POST', path: '/api/checkin', setupRequest: r => { const s = T.students[i++ % T.students.length]; r.headers = H(s.tok); r.body = JSON.stringify({ code: codeFor(T.secrets[s.sec].secret, Math.floor(Date.now() / 30000)) }); return r; } }] }), 3000);
// 6) one HOD opens the department dashboard over ALL 7.2M rows (heaviest query)
const t0 = Date.now(); const res = await fetch(BASE + '/api/department/overview?dept_id=1', { headers: H(T.admin) }); console.log(`HOD overview, whole university: first call -> status ${res.status} in ${Date.now() - t0} ms (uses an admin/HOD token in real use)`);
