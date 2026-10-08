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


---

# Part 2 — the REAL backend (`server/`), measured

The numbers above came from a minimal stand-in. After building the real server (login, cookie sessions, role checks, enrolment checks, audit log, idempotency keys, triggers) the same questions were re-measured with `bench/seed-real.mjs` + `bench/load-real.mjs`:
30,000 students · 1,500 teachers · 600 sections · 3,600 course offerings · 7.2 M attendance rows (400 MB) · server pinned to **one CPU core** · load generator on the other cores · loopback, no TLS.

| Scenario | Needed | Measured | p99 | Errors |
|---|---|---|---|---|
| 30,000 students check in with the 6-digit code (2-minute window) | 250/s | **1,875/s (×7.5)** | 102 ms | 0 |
| 600 teachers submit a 50-student register at once | ~100/s | 600/s | 102 ms | 0 |
| 30,000 students open "my attendance" | ~100/s | **1,154/s (×11)** | 148 ms | 0 |
| Teacher opens the roster (3,000) | — | 1,500/s | 53 ms | 0 |
| Department dashboard over *all* 7.2 M rows (heaviest query) | — | 2.0 s once (was 8.2 s) | — | 0 |
| **All 30,000 check in within 10 s (3,000/s)** | 3,000/s | ~2,100-2,800/s | 2-7 s | **some timeouts** |

## What the measurements changed
1. **Aggregates were scanning millions of rows** and — because `node:sqlite` is synchronous — blocked every other request for 5-8 s. Fixed with a trigger-maintained `stats` table (one row per course × student); a test proves it always equals a fresh recount. Whole-university dashboard 8.2 s → 2.0 s; a normal department (~1/10) is ~0.2 s.
2. **Check-in scanned ~246 old lectures per request.** Fixed with a partial index on *currently open* windows + a 30 s sweeper.
3. **Writing `last_seen` on every first request** cost 17 % of CPU. Now batched in memory and flushed in one transaction every 5 s.
4. **Per-check-in audit row removed** (the attendance row itself, `method='code'`, is the record).
5. Profile: remaining time is SQLite work in the check-in handler (~240 µs) and session lookup.

## Honest limits
- One core sustains **~2,000 check-ins/s**. A realistic class check-in (30,000 students over ≥ 30 s) is ×4-7 inside that; **everyone within 10 s is not**. Mitigations: the code stays valid 30-60 s, the portal retries with jitter, and a 2-vCPU VPS can run a second process for reads. Teachers rarely all start at the same second anyway (600 sections have staggered timetables).
- **Login is the other burst, and it is CPU-bound.** Measured on one core: scrypt N=2¹⁵ (the strong setting) = **~9 logins/s** (~20/s on two cores); N=2¹⁴ = ~21/s; N=2¹⁰ = **~368/s**. So: (1) system-generated passwords carry 96 bits of entropy and are stored with the fast N=2¹⁰ hash, so a first-day login storm is cheap; (2) the strong hash applies only to passwords people choose themselves (forced change at first login) — ~0.1-0.14 s CPU each, so **roll out section by section** (a 50-student section ≈ 6 s, a 500-seat hall at once ≈ 1 minute); (3) if more than 120 password checks are queued the server answers **503 + Retry-After** instead of freezing (tested). Sessions last 30 days, so logins are one-off per device.
- Memory: ~600 MB RSS while serving the 7.2 M-row database under load (page cache + JS arrays). A 2 GB VPS is the sensible minimum for the full university; 1 GB is fine for a department.
- All numbers are loopback on a sandbox disk. **Re-run `bench/` on the real VPS** (`deploy/README.md` §Verify) before announcing capacity.
