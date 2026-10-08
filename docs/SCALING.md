# Scaling notes — can GMC Check-in carry 30,000 students?

Measured, not guessed. Reproduce with `bench/` (Node 22+, `npm i` inside `bench/`).

## Model (one semester, whole university)
30,000 students · 600 sections × 50 · 6 subjects × 40 lectures → 144,000 lecture sessions, **7.2 M attendance rows (~230 MB SQLite)**.

## Test rig
- Server: Node 22 + built-in `node:sqlite`, WAL, `synchronous=NORMAL`, **pinned to ONE CPU core** (`taskset -c 0`) to imitate a 1-vCPU VPS.
- Load generator: autocannon on the other cores of the same machine (no real network, no TLS).
- The API is a *minimal* stand-in (no auth, validation, audit log). A real backend will be slower — see "Caveats".

## Results (server on 1 core, 7.2 M-row DB)
| Scenario | Needed | Measured | p99 latency | Errors |
|---|---|---|---|---|
| 30,000 QR check-ins within 2 min | 250 req/s | ≥ 6,000 req/s (x24 headroom) | 44 ms | 0 |
| 1,000 teachers submit a 50-student register at once | ~100 req/s | ~500 req/s = 25,000 rows/s | 251 ms | 0 |
| 30,000 students open "my attendance" | ~100 req/s | ≥ 6,000 req/s | 28 ms | 0 |
| Mixed peak (250 check-ins/s + 20 batches/s + 100 reads/s, 60 s) | — | held steadily | 43–56 ms | 0 |
| **Worst case: all 30,000 check in within 10 s** (3,000 req/s) | 3,000 req/s | 3,226 req/s | 304 ms | 0 |
| 5,000 simultaneous connections | — | 6,001 req/s | 1.2 s | 0 |

Server RSS stayed ≈ 160-200 MB; ~6 CPU-seconds used by the whole stress run.

## Caveats (read before trusting these numbers)
1. Local loopback: real mobile networks add 50-500 ms and packet loss; TLS/reverse proxy costs a little CPU.
2. Stand-in API: real auth, validation, row-level permissions, audit logging and JSON schemas will cost maybe 2-5×. Even at 1/10 of the numbers above the QR burst keeps ×2 headroom.
3. `synchronous=NORMAL` can lose the *last few commits* on power loss/OS crash (never corrupts). Use Litestream or WAL shipping for off-box copies.
4. One server = one point of failure. No failover tested.
5. Not tested: push fan-out to 30k devices, long soak (days), disk-full, backup restore drills, realistic 4G latency.
6. Sandbox disk ≠ a $7 VPS disk; re-run `bench/` on the real VPS before committing.

## Design rules this implies
- Writes are tiny and idempotent (`INSERT OR IGNORE` on `(student, session)`); batch teacher submissions in ONE transaction.
- Reads are index range scans (`PRIMARY KEY(student_id, session_id)` WITHOUT ROWID + `session_id` index).
- Keep attendance as append-only events + explicit corrections (audit trail, conflict-free offline sync).
- Cache static app on a CDN; the API only carries tiny JSON.
