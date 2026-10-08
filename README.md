# Lectus Attendance

Offline class-attendance manager (English / اردو). Installable from the browser — **no Play Store / App Store needed**.

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
| `icons.js` | Inline SVG icon set (works offline) |
| `ui.js` | Reusable primitives: buttons, modals, forms, tables, badges, charts, toasts |
| `app.js` | State, hash router, pages, exports |
| `i18n.js` | English + Urdu strings |
| `sw.js`, `manifest.webmanifest` | Offline PWA |

## Run locally
```
python3 -m http.server 8000   # open http://localhost:8000
```

## Deploy
Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`
(repo → Settings → Pages → Source: *GitHub Actions*).

> Data lives only in the browser of the phone that took attendance. Use *Settings → Data & backup → Download backup* regularly.
