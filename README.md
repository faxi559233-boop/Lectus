# Lectus Attendance

Offline class-attendance app (English / اردو). Installable on any phone from the browser — **no Play Store / App Store needed**.

## Features
- Semesters → subjects (6-7 each) → 50+ students
- Fast attendance: tap P / A / L, "All present", search, date, edit past lectures
- Per-student % per subject, shortage list (min % and warning % are configurable in Settings)
- Share with the teacher: PDF register (print → Save as PDF), Excel/CSV, WhatsApp text
- Works fully offline; data stored on the phone. Backup / restore as a JSON file
- Light / dark / auto theme, RTL Urdu UI

## Run locally
```
python3 -m http.server 8000   # then open http://localhost:8000
```

## Put it online (free) so everyone can open a link
GitHub → repo **Settings → Pages → Deploy from branch → `main` / root**. Share the resulting
`https://<user>.github.io/Lectus/` link. On the phone open it in Chrome / Safari →
menu → **Add to Home Screen**. It then works offline like a normal app.

> Data lives only in the browser of the phone that took attendance. Use *Settings → Download backup* regularly.
