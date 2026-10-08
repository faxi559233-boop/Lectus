// Worst cases: all 30,000 students check in within 10 s (3,000 req/s) and 5,000 simultaneous connections.
import autocannon from 'autocannon';
import { STUDENTS, SECTION } from './schema.mjs';
const run = opts => new Promise((ok, no) => autocannon({ url: 'http://localhost:8199', ...opts }, (e, r) => (e ? no(e) : ok(r))));
const show = (n, r) => console.log(`${n.padEnd(40)} ${Math.round(r.requests.average)} req/s | p50 ${r.latency.p50}ms p97.5 ${r.latency.p97_5}ms p99 ${r.latency.p99}ms max ${r.latency.max}ms | 2xx ${r['2xx']} non2xx ${r.non2xx} err ${r.errors} timeouts ${r.timeouts}`);
let c = 0; const mk = base => ({ method: 'POST', path: '/checkin', headers: { 'content-type': 'application/json' }, setupRequest: r => { const s = c++ % STUDENTS; r.body = JSON.stringify({ s, sess: base + Math.floor(s / SECTION) }); return r; } });
show('30,000 check-ins in 10 s (3,000 req/s)', await run({ connections: 1000, duration: 10, overallRate: 3000, requests: [mk(1100000)] }));
c = 0; show('5,000 simultaneous connections', await run({ connections: 5000, amount: 30000, timeout: 30, requests: [mk(1200000)] }));
