# GMC Attendance

Offline class-attendance manager (English / اردو). Installable from the browser — **no Play Store / App Store needed**.

## What's new in v3
- **Late** status (counts as present by default, switch in Settings) · per-subject minimum %.
- **Outlook calculator:** "Attend next N lectures to reach 75%" / "Can miss N more", per student and subject.
- **Timetable:** days/time/room per subject → "Today's lectures" on the dashboard. **Topic** per lecture.
- **Student profile** page with per-subject stats and a 16-week calendar heatmap; reports heatmap too.
- **Excel (.xlsx)** import & export (own zero-dependency reader/writer, works offline) + template download; CSV; improved printable PDF register.
- **WhatsApp reminders** to shortage students (phone numbers starting `03…` are treated as +92).
- **Undo** after deleting a student, subject, lecture or semester. **Getting-started checklist.** Weekly **backup reminder** and "share backup" (WhatsApp / Drive) on phones.

## Screens
Dashboard · Students · Attendance (subjects → mark → history) · Semesters · Reports · Settings

- Desktop: collapsible sidebar. Tablet: icon rail. Mobile: bottom navigation with a "More" sheet.
- Light / dark / system theme, full RTL layout for Urdu.
- Keyboard-friendly marking: focus a row, press **P / A / L**, use **↑ ↓** to move.
- Shortage tracking with configurable minimum % and warning % (Settings → Academic).
- Export: CSV (Excel), printable PDF register, WhatsApp / share text.
- Backup & restore as a JSON file. All data stays on the device (`localStorage`).

## Project layout (no build step)
| File | Purpose |
|---|---|
| `index.html` | App shell + loading skeleton |
| `styles.css` | Design tokens + all components (light/dark, responsive) |
| `xlsx.js` | Dependency-free .xlsx reader/writer |
| `icons.js` | Inline SVG icon set (works offline) |
| `ui.js` | Reusable primitives: buttons, modals, forms, tables, badges, charts, toasts |
| `app.js` | State, hash router, pages, exports |
| `i18n.js` | English + Urdu strings |
| `sw.js`, `manifest.webmanifest` | Offline PWA |

## Tests
```
npm i playwright            # once
python3 -m http.server 8123 &
node tests/e2e.js           # full flow, exits non-zero on failure
```

## Run locally
```
python3 -m http.server 8000   # open http://localhost:8000
```

## Deploy
Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`
(repo → Settings → Pages → Source: *GitHub Actions*).

> Data lives only in the browser of the phone that took attendance. Use *Settings → Data & backup → Download backup* regularly.
