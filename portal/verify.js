/* Public certificate check: no sign-in. Shows only what is needed to confirm the certificate is genuine. */
'use strict';
const KIND = { bonafide: 'Bonafide certificate', character: 'Character certificate', fee_clearance: 'Fee clearance certificate', attendance: 'Attendance certificate' };
const out = document.getElementById('out'), code = document.getElementById('code');
const show = (cls, ...lines) => { out.className = 'notice ' + cls; out.replaceChildren(...lines.map(l => { const p = document.createElement('p'); p.style.margin = '2px 0'; p.textContent = l; return p; })); };
async function check(c) {
  if (!c) return; code.value = c; show('', 'Checking…');
  try {
    const res = await fetch('/api/verify/' + encodeURIComponent(c)); const d = await res.json();
    if (res.status === 429) return show('', 'Too many checks. Please wait a minute and try again.');
    if (!d.valid) return show('', 'No certificate with this code was found. Check the code and try again.');
    show('', 'Genuine certificate', KIND[d.kind] || d.kind, `${d.name} (${d.roll})`, d.program || '', `${d.college}, issued on ${d.issued_on}`);
  } catch { show('', 'Could not check right now. Check your internet connection.'); }
}
document.getElementById('f').addEventListener('submit', e => { e.preventDefault(); check(code.value.trim()); });
check(new URLSearchParams(location.search).get('c'));
