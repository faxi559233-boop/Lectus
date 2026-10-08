// Usage: node load.mjs   (server must already be running on :8199)
import autocannon from 'autocannon';
import { STUDENTS, SECTION } from './schema.mjs';
const BASE = 'http://localhost:8199';
const run = opts => new Promise((ok, no) => autocannon({ url: BASE, ...opts }, (e, r) => (e ? no(e) : ok(r))));
const fmt = (name, r, need) => console.log(`${name.padEnd(34)} ${String(Math.round(r.requests.average)).padStart(6)} req/s | p50 ${String(r.latency.p50).padStart(4)}ms p97.5 ${String(r.latency.p97_5).padStart(4)}ms p99 ${String(r.latency.p99).padStart(4)}ms max ${String(r.latency.max).padStart(5)}ms | non2xx ${r.non2xx} err ${r.errors} timeouts ${r.timeouts}${need ? ` | needed ${need} req/s -> headroom x${(r.requests.average / need).toFixed(0)}` : ''}`);
const rnd = n => Math.floor(Math.random() * n);

// 1) Student QR check-in storm: all 30,000 students check in within ~2 minutes (= 250 req/s needed). Each request is a unique new row.
let c = 0;
fmt('QR check-in, 30,000 unique inserts', await run({ connections: 100, amount: 30000, requests: [{ method: 'POST', path: '/checkin', headers: { 'content-type': 'application/json' }, setupRequest: r => { const s = c++ % STUDENTS; r.body = JSON.stringify({ s, sess: 500000 + Math.floor(s / SECTION) }); return r; } }] }), 250);

// 2) 1,000 teachers submit a 50-student register at the same moment (each = one transaction of 50 rows).
let t = 0; const marks = Array.from({ length: 50 }, (_, i) => [i, i % 7 === 0 ? 0 : 1]);
fmt('Teacher batch x1,000 (50 rows each)', await run({ connections: 100, amount: 1000, requests: [{ method: 'POST', path: '/batch', headers: { 'content-type': 'application/json' }, setupRequest: r => { const k = t++; r.body = JSON.stringify({ sess: 700000 + k, marks: marks.map(([s, st]) => [(k % 600) * 50 + s, st]) }); return r; } }] }), 100);

// 3) Student dashboards: 30,000 students open "my attendance" (7.2M-row table, ~240 rows per student).
fmt('Student summary reads x30,000', await run({ connections: 100, amount: 30000, requests: [{ method: 'GET', setupRequest: r => { r.path = '/student/' + rnd(STUDENTS); return r; } }] }), 100);

// 4) Teacher live view of a session
fmt('Teacher session view x10,000', await run({ connections: 50, amount: 10000, requests: [{ method: 'GET', setupRequest: r => { r.path = '/session/' + (1 + rnd(144000)); return r; } }] }));

// 5) Realistic peak mix for 60 s: 250 check-ins/s + 20 batches/s + 100 reads/s together
const mix = [
  run({ connections: 40, duration: 60, overallRate: 250, requests: [{ method: 'POST', path: '/checkin', headers: { 'content-type': 'application/json' }, setupRequest: r => { const s = rnd(STUDENTS); r.body = JSON.stringify({ s, sess: 900000 + rnd(2000) }); return r; } }] }),
  run({ connections: 10, duration: 60, overallRate: 20, requests: [{ method: 'POST', path: '/batch', headers: { 'content-type': 'application/json' }, setupRequest: r => { const k = rnd(1e6); r.body = JSON.stringify({ sess: 1000000 + k, marks: marks.map(([s, st]) => [(k % 600) * 50 + s, st]) }); return r; } }] }),
  run({ connections: 20, duration: 60, overallRate: 100, requests: [{ method: 'GET', setupRequest: r => { r.path = '/student/' + rnd(STUDENTS); return r; } }] })
];
const [a, b, d] = await Promise.all(mix);
console.log('--- mixed peak, 60 s, all at once ---'); fmt('  check-ins @250/s', a); fmt('  teacher batches @20/s', b); fmt('  student reads @100/s', d);
