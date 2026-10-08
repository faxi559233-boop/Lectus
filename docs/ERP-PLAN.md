# GMC Check-in → Campus ERP: complete plan (A to Z)

Status legend: ✅ built & tested in this repo · 🟡 built, needs real-VPS verification · ⬜ planned

## 0. Principles
1. **Attendance-first, ERP-second.** Ship the module people use daily; add others only when the previous one is stable.
2. **Offline-first.** Class Wi-Fi is unreliable; teachers must be able to mark and sync later.
3. **Measurable quality.** Every phase has numeric gates (Lighthouse ≥ 95, e2e 100 % pass, load test headroom ≥ ×5, restore drill passes).
4. **Least data, strongest control.** Collect only what attendance needs; role-based access; audit every change.
5. **Boring technology.** One Node process + SQLite (WAL) + Caddy. Evidence: `docs/SCALING.md` (30,000 students on one core, 0 errors).

## 1. Users and permissions
| Role | Can do |
|---|---|
| **Admin** (IT/registrar) | Everything: users, structure, imports, audit log, backups, settings |
| **HOD** | Read everything in own department; shortage lists; announcements; approve leave (phase 2) |
| **Teacher** | Own offerings only: open lectures, mark/edit attendance, open QR/code check-in, see own shortage list |
| **Student** | Own record only: attendance per course, outlook ("attend next N"), check-in with code, notifications |
Rules: no cross-department reads for HOD; teachers cannot read other teachers' offerings; students never see other students; every write is audited.

## 2. Modules roadmap
| # | Module | Phase | Status |
|---|---|---|---|
| 1 | Personal offline attendance app (single teacher) | 0 | ✅ live (GitHub Pages) |
| 2 | Auth, roles, sessions, audit log | 1 | ✅ |
| 3 | Academic structure: departments, programs, terms, sections, courses, offerings, enrollments | 1 | ✅ |
| 4 | Attendance online + idempotent offline sync | 1 | ✅ |
| 5 | Web portal UI: student, teacher, HOD, admin (EN/اردو, offline queue) — browser e2e `tests/portal-e2e.js` passes | 1 | ✅ |
| 6 | Code check-in (rotating 6-digit code, optional geofence) | 1 | ✅ |
| 7 | HOD dashboard, shortage lists, CSV export | 1 | ✅ |
| 8 | Bulk import (students/teachers) CSV/XLSX | 1 | ✅ |
| 9 | Web-push notifications + announcements | 1 | 🟡 (needs HTTPS + real devices) |
| 10 | Nightly backup + restore drill + health checks | 1 | ✅ / 🟡 off-site copy needs credentials |
| 11 | Leave applications & approval | 2 | ⬜ |
| 12 | Timetable clash checker, room allocation | 2 | ⬜ |
| 13 | Exam eligibility (auto from shortage rules) | 2 | ⬜ |
| 14 | Parent/guardian read-only access | 3 | ⬜ |
| 15 | Marks / results / GPA | 4 | ⬜ (sensitive: only after 1-3 are stable) |
| 16 | Fees / accounts | — | ⬜ integrate with an existing system instead of building |

## 3. Architecture
```
 Phone / PC browser (PWA, installable; Android via TWA later)
        │ HTTPS
   ┌────▼─────┐   static files, TLS, HTTP/2, gzip, security headers
   │  Caddy   │── /            → static app (index.html, portal/)
   └────┬─────┘── /api/*       → Node API (127.0.0.1:8787)
        │
   ┌────▼───────────────┐   Node 22, zero-framework router, node:sqlite
   │  gmc-server        │   scrypt passwords · hashed session tokens · RBAC
   │  (systemd service) │   audit log · rate limits · push queue · backups
   └────┬───────────────┘
        │
   SQLite (WAL, synchronous=NORMAL) ── nightly VACUUM INTO backup ── off-site copy (rclone / Litestream)
```
Why not Postgres/Supabase now: capacity is not the bottleneck (see SCALING.md); fewer moving parts = fewer outages on one VPS. Migration path exists (SQL is portable; add PgBouncer when a second app node is needed).

## 4. Data model (SQLite)
`users` · `auth_sessions` · `departments` · `programs` · `terms` · `sections` · `courses` · `offerings` (course × section × teacher) · `students` (roll no., linked to a user) · `enrollments` (student × offering) · `lecture_sessions` · `attendance` (session × student → P/A/L/T, who, when, method) · `audit_log` · `push_subs` · `announcements` · `ops` (idempotency keys) · `settings`.
Attendance keeps **current status + immutable audit trail of every change** (who, old → new, when). Offline retries are idempotent via `client_op_id`.

## 5. API (all JSON, cookie session, `/api/…`)
- `auth`: `POST login · logout · change-password`, `GET me`
- `admin`: CRUD `departments programs terms sections courses offerings users students`, `POST import/students`, `GET audit`, `GET stats`, `POST backup`
- `teacher`: `GET my/offerings`, `POST offerings/:id/sessions`, `GET sessions/:id`, `PUT sessions/:id/marks` (idempotent batch), `POST sessions/:id/checkin/open|close`, `GET offerings/:id/summary`
- `student`: `GET my/attendance`, `POST checkin {code, lat?, lon?}`
- `hod`: `GET department/overview`, `GET department/shortage`, `GET department/shortage.csv`
- `push`: `GET vapid-key`, `POST subscribe`, `DELETE subscribe`, `POST admin/announce`
- `ops`: `GET health` (public, minimal), `GET admin/stats`

## 6. Security and privacy
| Threat | Control |
|---|---|
| Password theft/guessing | scrypt (N=2¹⁵), min length 10, lockout (5 fails/15 min per account+IP), forced change of generated passwords |
| Session theft | random 256-bit tokens, only SHA-256 stored, HttpOnly + Secure + SameSite=Strict cookie, 12 h idle / 30 d absolute |
| CSRF | SameSite=Strict + require `Content-Type: application/json` + `X-GMC: 1` header on writes |
| Injection | prepared statements only; strict input validation; 1 MB body cap |
| Privilege escalation | server-side RBAC on every route; ownership checks (teacher↔offering, HOD↔department, student↔self) |
| Fake attendance | rotating 30 s code, enrollment check, optional geofence, per-student rate limit, audit |
| Data loss | WAL, nightly `VACUUM INTO`, 14-day retention, off-site copy, **monthly restore drill** |
| Tampering | append-only audit log, shown to admins |
| Privacy | collect only roll no., name, phone (optional), enrolment; no biometrics; export/delete on request; Pakistan has no comprehensive data-protection law yet (verify current status) — design for compliance anyway |
| Transport | HTTPS only (Caddy auto-TLS), HSTS, CSP, no third-party scripts in portal |
Open items: written approval from the college; retention period; who is data controller; incident-response contact.

## 7. Offline and sync
- Portal teacher screen queues submissions in `localStorage` with `client_op_id`; retries on `online` and every 20 s; server de-duplicates.
- Students need connectivity only for check-in/view; last view is cached.
- Conflicts: last server-time write wins **but every change is audited**, so nothing is silently lost.

## 8. Notifications
Web Push (VAPID). Android Chrome: reliable. iPhone: only after Add-to-Home-Screen on iOS ≥ 16.4 and less reliable → keep in-app notice list + WhatsApp tap-to-send fallback. Sending is queued with a rate limit (default 40/s) and backoff on 406/429/5xx; dead endpoints (404/410) are removed.

## 9. Quality gates (a phase is "done" only if all pass)
| Gate | Target |
|---|---|
| Unit/integration tests (`server/test`) | 100 % pass |
| Browser e2e (`tests/`) | 100 % pass, 0 console errors |
| Lighthouse (mobile) | ≥ 95 (portal login measured: perf 98, a11y 100 after fix, best-practices 96; SEO intentionally low: private portal is noindex) |
| Load test on the real VPS (`bench/`) | check-in burst ≥ ×5 headroom, p99 < 500 ms |
| Backup restore drill | restore completes, row counts match |
| Security checklist (§6) | every control verified by a test or a manual step recorded here |

## 10. Deployment on your VPS (A to Z)
Assumes Ubuntu 22.04/24.04, a domain pointing to the VPS (A record), ports 80/443 open.
1. **DNS**: `check.yourdomain.pk → VPS IP`.
2. **Server user & firewall**: `adduser gmc`, `ufw allow 22,80,443`, `ufw enable`; SSH keys only.
3. **Install**: run `sudo bash deploy/install.sh check.yourdomain.pk` (installs Node 22, Caddy, creates user, systemd unit, env file, backup timer).
4. **Create the first admin**: `sudo -u gmc node /opt/gmc/server/cli.mjs create-admin you@college.edu.pk` (prints a one-time password).
5. **Verify**: open `https://check.yourdomain.pk/portal/`, login, change password; `curl https://…/api/health`.
6. **Import**: Admin → Users → Import students (XLSX/CSV).
7. **Backups**: confirm `/var/backups/gmc/` fills nightly; configure `rclone` for off-site; run the restore drill (`server/cli.mjs restore-drill`).
8. **Updates**: `sudo bash deploy/update.sh` (git pull, migrate, restart, health-check, auto-rollback on failure).
9. **Monitoring**: free uptime monitor on `/api/health`; `journalctl -u gmc -f`.
See `deploy/README.md`.

## 11. Rollout
1. **Pilot (2-4 weeks)**: your class + 2-3 teachers. Collect issues daily.
2. **Department**: HOD dashboard, leave module, exam-eligibility lists.
3. **College**: more departments, training sessions, support rota.
4. **Android app** via Trusted Web Activity (needs domain + Play account; organisation account avoids the 12-tester rule).
Each step needs written approval and a rollback plan.

## 12. Operations
Runbooks: restart, restore from backup, rotate secrets, add a department, disable a compromised account, handle a data-deletion request. On-call: one named owner. Capacity review each term using `bench/` on a copy of production data.

## 13. Risks
| Risk | Mitigation |
|---|---|
| Single VPS fails | off-site backups + documented rebuild (< 1 h); later a warm standby |
| Admin account compromise | strong password, forced rotation, audit alerts; 2FA planned (phase 2) |
| Low adoption | keep marking ≤ 2 taps/student, train teachers, show HOD value (live shortage list) |
| Scope creep | modules gated by §9; marks/fees deliberately last |
| Legal/approval | written permission before any real student data is loaded |

## 14. What this repository contains now
`/` personal PWA · `server/` API + tests · `portal/` web portal · `deploy/` installer, Caddy, systemd, backup · `bench/` capacity test · `docs/`.
