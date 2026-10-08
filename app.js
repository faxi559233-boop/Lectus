/* GMC Check-in — state, routing and pages. Data model is backward compatible with v1 (storage key preserved). */
'use strict';

const KEY = 'lectus-data-v1';
const VERSION = '3.0.0';
const PAGE = 25;
const DAY = 86400000;

/* =========================================================
   STATE
   ========================================================= */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

function defaults() {
  return { v: 3, settings: { lang: 'en', theme: 'light', min: 75, warn: 80, leaveCounts: true, lateCounts: true, lastBackup: null, teacher: '', institution: '', sidebar: 'open', hideStart: false }, semesters: [], current: null };
}
let loadError = null;
function migrate(d) {
  const base = defaults();
  const out = Object.assign(base, d, { settings: Object.assign(base.settings, d.settings || {}) });
  out.semesters.forEach(s => { s.students = s.students || []; s.subjects = s.subjects || []; s.records = s.records || {}; s.year = s.year || ''; s.archived = !!s.archived; });
  if (!out.semesters.find(s => s.id === out.current)) out.current = out.semesters[0] ? out.semesters[0].id : null;
  return out;
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { loadError = 'blocked'; return defaults(); }
  if (!raw) return defaults();
  try {
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.semesters)) throw new Error('shape');
    return migrate(d);
  } catch (e) {
    try { localStorage.setItem(KEY + '-corrupt', raw); } catch (_) { /* ignore */ }
    loadError = 'corrupt';
    return defaults();
  }
}
let S = load();
function save() {
  if (loadError === 'corrupt') return; // never overwrite data we could not read
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast(t('errStorage'), 'error'); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const sem = () => S.semesters.find(s => s.id === S.current) || null;
const subj = id => (sem() ? sem().subjects.find(x => x.id === id) : null);
const lang = () => S.settings.lang;
const t = k => (I18N[lang()] && I18N[lang()][k]) || I18N.en[k] || k;
const tf = (k, o) => Object.entries(o).reduce((s, [a, b]) => s.replace('{' + a + '}', b), t(k));
const num = n => (lang() === 'ur' ? String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]) : String(n));
const sortStudents = arr => arr.slice().sort((a, b) => String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true }));
const loc = () => (lang() === 'ur' ? 'ur-PK' : 'en-GB');
const fmtDate = (d, short) => num(new Date(d + 'T00:00:00').toLocaleDateString(loc(), short ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }));
const weekdayShort = d => new Date(2024, 0, 7 + d).toLocaleDateString(loc(), { weekday: 'short' });
const weekdayLong = d => new Date(2024, 0, 7 + d).toLocaleDateString(loc(), { weekday: 'long' });
const subjectIds = () => sem().subjects.map(s => s.id);
const dotted = parts => parts.filter(Boolean).flatMap((p, i) => [i ? ' · ' : null, h('bdi', {}, p)]);
const subjDays = sj => String(sj.days || '').split(',').filter(Boolean).map(Number);

/* undo: snapshot → mutate → toast with Undo */
function withUndo(msg, fn) {
  const snap = JSON.stringify(S);
  fn(); save(); render();
  toast(msg, 'success', { label: t('undo'), fn: () => { S = migrate(JSON.parse(snap)); save(); render(); toast(t('toastUndone'), 'info'); } });
}

/* =========================================================
   CALCULATIONS
   ========================================================= */
const attOf = (P, L, T) => P + (S.settings.leaveCounts ? L : 0) + (S.settings.lateCounts ? T : 0);
function tally(studentId, ids, from, to) {
  let total = 0, P = 0, A = 0, L = 0, T = 0;
  for (const id of ids) {
    for (const se of sem().records[id] || []) {
      if ((from && se.date < from) || (to && se.date > to)) continue;
      const m = se.marks[studentId]; if (!m) continue;
      total++; if (m === 'P') P++; else if (m === 'L') L++; else if (m === 'T') T++; else A++;
    }
  }
  const att = attOf(P, L, T);
  return { total, P, A, L, T, att, pct: total ? (att / total) * 100 : null };
}
const stats = (subjectId, studentId) => tally(studentId, [subjectId]);
function minFor(id) {
  const sj = id && subj(id); const m = sj && sj.min !== undefined && sj.min !== '' ? Number(sj.min) : NaN;
  return isFinite(m) && m > 0 && m < 100 ? m : S.settings.min;
}
const warnFor = id => Math.min(100, minFor(id) + Math.max(0, S.settings.warn - S.settings.min));
function statusOf(pct, id) {
  if (pct === null) return 'none';
  if (pct < minFor(id)) return 'bad';
  if (pct < warnFor(id)) return 'warn';
  return 'ok';
}
const STATUS = { ok: ['success', 'stGood'], warn: ['warning', 'stWarning'], bad: ['danger', 'stShortage'], none: ['neutral', 'stNoData'] };
const statusBadge = (pct, id) => { const [tone, key] = STATUS[statusOf(pct, id)]; return badge(tone, t(key)); };
const toneOf = (pct, id) => ({ ok: 'success', warn: 'warning', bad: 'danger', none: '' }[statusOf(pct, id)]);
const pctTxt = p => (p === null ? '—' : num(Math.round(p * 10) / 10) + '%');

/* how many lectures to attend to reach the minimum, or how many can still be missed */
function outlook(x, id) {
  const min = minFor(id);
  if (!x.total) return null;
  if (x.pct < min) return { need: Math.ceil((min * x.total - 100 * x.att) / (100 - min)) };
  return { spare: Math.max(0, Math.floor((100 * x.att) / min - x.total)) };
}
const outlookText = (o, id) => (!o ? '—' : o.need !== undefined ? tf('needNext', { n: num(o.need), m: num(minFor(id)) }) : tf('canMiss', { n: num(o.spare) }));

function sessionCounts(se) {
  const v = Object.values(se.marks); const c = { P: 0, A: 0, L: 0, T: 0 };
  v.forEach(x => { c[x] = (c[x] || 0) + 1; });
  const n = v.length; return { P: c.P, A: c.A, L: c.L, T: c.T, n, pct: n ? (attOf(c.P, c.L, c.T) / n) * 100 : null };
}
function allSessions(ids, from, to) {
  const out = [];
  (ids || subjectIds()).forEach(id => (sem().records[id] || []).forEach(se => { if ((!from || se.date >= from) && (!to || se.date <= to)) out.push(Object.assign({ subjectId: id }, se)); }));
  return out;
}
function overall(ids, from, to) {
  let P = 0, A = 0, L = 0, T = 0, sessions = 0;
  allSessions(ids, from, to).forEach(se => { const c = sessionCounts(se); P += c.P; A += c.A; L += c.L; T += c.T; sessions++; });
  const n = P + A + L + T;
  return { P, A, L, T, n, sessions, pct: n ? (attOf(P, L, T) / n) * 100 : null };
}
function byDate(ids, from, to) {
  const m = {};
  allSessions(ids, from, to).forEach(se => { const c = sessionCounts(se); const o = m[se.date] = m[se.date] || { att: 0, n: 0 }; o.att += attOf(c.P, c.L, c.T); o.n += c.n; });
  return m;
}
function trend(ids, from, to, last = 14) {
  const m = byDate(ids, from, to);
  return Object.keys(m).sort().slice(-last).map(d => ({ label: fmtDate(d, true), value: m[d].n ? (m[d].att / m[d].n) * 100 : 0 }));
}
function subjectAvg(id) {
  const ps = sem().students.map(s => stats(id, s.id).pct).filter(p => p !== null);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
}
const semOverview = s => { const prev = S.current; S.current = s.id; const o = overall(); S.current = prev; return { lectures: o.sessions, pct: o.pct }; };

/* =========================================================
   ROUTER
   ========================================================= */
function route() {
  const raw = location.hash.replace(/^#\/?/, ''); const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts, q: new URLSearchParams(qs || ''), name: parts[0] || 'dashboard' };
}
const go = path => { location.hash = '#/' + path; };
const href = path => '#/' + path;

const V = { students: { q: '', group: '', status: '', page: 1 }, rep: { subject: 'all', from: '', to: '', q: '', sort: 'roll', dir: 'asc' }, set: 'general' };
let draft = null;

/* =========================================================
   LAYOUT SHELL
   ========================================================= */
const NAV = [
  ['dashboard', 'dashboard', 'navDashboard'], ['students', 'users', 'navStudents'], ['attendance', 'attendance', 'navAttendance'],
  ['semesters', 'calendar', 'navSemesters'], ['reports', 'chart', 'navReports'], ['settings', 'settings', 'navSettings']
];
const MOBILE_NAV = [['dashboard', 'dashboard', 'navHome'], ['students', 'users', 'navStudents'], ['attendance', 'attendance', 'navAttendance'], ['reports', 'chart', 'navReports']];

function isCollapsed() { return window.innerWidth < 1024 || S.settings.sidebar === 'collapsed'; }

function sidebar(active) {
  const collapsed = isCollapsed();
  const name = S.settings.teacher || t('teacherDefault');
  return h('aside', { class: 'sidebar', 'aria-label': 'Primary' },
    h('a', { class: 'brand', href: href('dashboard'), 'aria-label': 'GMC Check-in' }, h('img', { class: 'logo', src: 'icons/logo.jpg', alt: '', width: 32, height: 32 }), h('span', { class: 'brand-name' }, 'GMC Check-in')),
    h('nav', { class: 'nav' }, NAV.map(([r, ic, key]) => h('a', { href: href(r), class: 'nav-item' + (active === r ? ' active' : ''), title: collapsed ? t(key) : null, 'aria-current': active === r ? 'page' : null }, icon(ic, 19), h('span', { class: 'nav-label' }, t(key))))),
    h('div', { class: 'sidebar-foot' },
      h('button', { class: 'nav-item collapse-btn', onclick: () => { S.settings.sidebar = S.settings.sidebar === 'collapsed' ? 'open' : 'collapsed'; save(); render(); }, 'aria-label': t('toggleSidebar') }, icon('panel', 19, 'flip'), h('span', { class: 'nav-label' }, t('collapse'))),
      h('a', { class: 'profile', href: href('settings') }, avatar(name), h('span', { class: 'profile-text' }, h('b', {}, name), h('small', {}, S.settings.institution || t('appTagline'))))));
}

function topbar() {
  const live = S.semesters.filter(s => !s.archived || s.id === S.current);
  const sw = S.semesters.length ? h('label', { class: 'sem-switch' }, icon('calendar', 16),
    h('select', { 'aria-label': t('semester'), onchange: e => { S.current = e.target.value; save(); draft = null; render(); } },
      live.map(s => h('option', { value: s.id, selected: s.id === S.current }, s.name)))) : null;
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand mobile-brand', href: href('dashboard'), 'aria-label': 'GMC Check-in' }, h('img', { class: 'logo', src: 'icons/logo.jpg', alt: '', width: 32, height: 32 })),
    sw || h('b', { class: 'mobile-title' }, 'GMC Check-in'),
    h('span', { class: 'grow' }),
    h('form', { class: 'top-search', role: 'search', onsubmit: e => { e.preventDefault(); const v = e.target.q.value.trim(); go('students' + (v ? '?q=' + encodeURIComponent(v) : '')); } },
      icon('search', 16), h('input', { name: 'q', class: 'input', type: 'search', placeholder: t('searchStudents'), 'aria-label': t('searchStudents') })),
    h('a', { class: 'top-avatar', href: href('settings'), 'aria-label': t('navSettings') }, avatar(S.settings.teacher || t('teacherDefault'))));
}

function bottomNav(active) {
  return h('nav', { class: 'bottom-nav', 'aria-label': 'Mobile' },
    MOBILE_NAV.map(([r, ic, key]) => h('a', { href: href(r), class: active === r ? 'active' : '', 'aria-current': active === r ? 'page' : null }, icon(ic, 22), h('span', {}, t(key)))),
    h('button', { class: ['semesters', 'settings'].includes(active) ? 'active' : '', onclick: openMore }, icon('more', 22), h('span', {}, t('navMore'))));
}
function openMore() {
  const d = sheetDialog(t('navMore'), h('div', { class: 'sheet-list' }, [['semesters', 'calendar', 'navSemesters'], ['settings', 'settings', 'navSettings']].map(([r, ic, key]) =>
    h('a', { href: href(r), onclick: () => d.close() }, icon(ic, 20), h('span', {}, t(key)), icon('chevronRight', 16, 'flip')))));
}

function shell(content, active) {
  return h('div', { class: 'shell', 'data-collapsed': isCollapsed(), 'data-mark': route().parts[2] === 'mark' ? '' : null },
    h('a', { class: 'skip', href: '#main', onclick: e => { e.preventDefault(); document.getElementById('main').focus(); } }, t('skip')),
    sidebar(active),
    h('div', { class: 'main' }, topbar(), h('main', { class: 'content', id: 'main', tabindex: -1 }, content)),
    bottomNav(active));
}

/* =========================================================
   SHARED PIECES
   ========================================================= */
function noSemester(showSteps) {
  return h('div', {}, pageHeader({ title: t('navDashboard'), desc: t('dashNoSemDesc') }),
    emptyState({
      iconName: 'calendar', title: t('noSemTitle'), desc: t('noSemDesc'),
      actions: btn(t('createSemester'), { v: 'primary', icon: 'plus', onclick: () => semesterForm() })
    }),
    showSteps ? h('div', { class: 'steps' }, [['1', 'step1t', 'step1d'], ['2', 'step2t', 'step2d'], ['3', 'step3t', 'step3d']].map(([n, a, b]) =>
      h('div', { class: 'card step' }, h('span', { class: 'step-n' }, num(n)), h('div', {}, h('b', {}, t(a)), h('p', { class: 'sub' }, t(b)))))) : null);
}

/* wa.me link; local numbers starting with 0 are treated as Pakistan (+92) */
function waLink(phone, text) {
  let p = String(phone || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (p.startsWith('00')) p = p.slice(2); else if (p.startsWith('0')) p = '92' + p.slice(1);
  return 'https://wa.me/' + p + '?text=' + encodeURIComponent(text);
}
function reminderText(stu, subjectName, x, id) {
  const o = outlook(x, id);
  return tf('remindMsg', { name: stu.name, subject: subjectName, pct: (Math.round(x.pct * 10) / 10) + '%', min: minFor(id), tip: o && o.need !== undefined ? tf('needNext', { n: o.need, m: minFor(id) }) : '' }).trim();
}
function remindBtn(stu, subjectName, x, id) {
  if (!stu.phone) return iconBtn('message', t('remind'), () => { toast(t('noPhone'), 'info'); studentForm(stu); });
  return h('a', { class: 'btn ghost icon-only', href: waLink(stu.phone, reminderText(stu, subjectName, x, id)), target: '_blank', rel: 'noopener', title: t('remind'), 'aria-label': t('remind') }, icon('message', 18));
}

/* =========================================================
   SEMESTER CRUD
   ========================================================= */
function semesterForm(s) {
  formDialog({
    title: s ? t('editSemester') : t('createSemester'), desc: t('semFormDesc'), submit: s ? t('save') : t('createSemester'),
    fields: [
      { key: 'name', label: t('semName'), required: true, value: s ? s.name : '', placeholder: t('semPlaceholder') },
      { key: 'year', label: t('academicYear'), value: s ? s.year : '', placeholder: '2026–2027', help: t('optional') }],
    onSubmit: v => {
      if (s) { s.name = v.name; s.year = v.year; } else { const n = { id: uid(), name: v.name, year: v.year, archived: false, students: [], subjects: [], records: {} }; S.semesters.push(n); S.current = n.id; }
      save(); render(); toast(s ? t('toastSaved') : t('toastSemCreated'));
    }
  });
}
function deleteSemester(s) {
  confirmDialog({ title: t('deleteSemester'), desc: t('confirmDeleteSem'), onConfirm: () => withUndo(t('toastDeleted'), () => {
    S.semesters = S.semesters.filter(x => x.id !== s.id);
    if (S.current === s.id) S.current = (S.semesters.find(x => !x.archived) || S.semesters[0] || {}).id || null;
  }) });
}

/* =========================================================
   SUBJECT / STUDENT CRUD
   ========================================================= */
function subjectForm(sj) {
  formDialog({
    title: sj ? t('editSubject') : t('addSubject'), submit: sj ? t('save') : t('addSubject'), wide: true,
    fields: [
      { key: 'name', label: t('subjectName'), required: true, value: sj ? sj.name : '' },
      { key: 'code', label: t('subjectCode'), value: sj ? sj.code || '' : '', help: t('optional') },
      { key: 'teacher', label: t('teacher'), value: sj ? sj.teacher || '' : '', help: t('optional') },
      { key: 'min', label: t('subjectMin'), type: 'number', min: 1, max: 99, value: sj && sj.min ? sj.min : '', placeholder: String(S.settings.min), help: t('subjectMinHelp') },
      { key: 'days', label: t('scheduleDays'), type: 'days', value: sj ? sj.days || '' : '', help: t('scheduleHelp') },
      { key: 'time', label: t('startTime'), type: 'time', value: sj ? sj.time || '' : '' },
      { key: 'room', label: t('room'), value: sj ? sj.room || '' : '', help: t('optional') }],
    onSubmit: v => {
      if (v.min && (+v.min < 1 || +v.min > 99)) return { min: t('errMin') };
      if (sj) Object.assign(sj, v); else { const n = Object.assign({ id: uid() }, v); sem().subjects.push(n); sem().records[n.id] = []; }
      save(); render(); toast(sj ? t('toastSaved') : t('toastSubjectAdded'));
    }
  });
}
function deleteSubject(sj, after) {
  confirmDialog({ title: t('deleteSubject'), desc: t('confirmDeleteSubject'), onConfirm: () => { const s = sem(); const snap = JSON.stringify(S);
    s.subjects = s.subjects.filter(x => x.id !== sj.id); delete s.records[sj.id]; save();
    if (after) after(); else render();
    toast(t('toastDeleted'), 'success', { label: t('undo'), fn: () => { S = migrate(JSON.parse(snap)); save(); render(); toast(t('toastUndone'), 'info'); } }); } });
}
function studentForm(stu) {
  const dup = roll => sem().students.some(x => x.roll === roll && (!stu || x.id !== stu.id));
  formDialog({
    title: stu ? t('editStudent') : t('addStudent'), desc: t('studentFormDesc'), submit: stu ? t('save') : t('addStudent'),
    fields: [
      { key: 'roll', label: t('studentId'), required: true, value: stu ? stu.roll : '', placeholder: '21-ECO-001' },
      { key: 'name', label: t('fullName'), required: true, value: stu ? stu.name : '' },
      { key: 'group', label: t('group'), value: stu ? stu.group || '' : '', help: t('groupHelp') },
      { key: 'phone', label: t('phone'), type: 'tel', inputmode: 'tel', value: stu ? stu.phone || '' : '', placeholder: '0300 1234567', help: t('phoneHelp') }],
    onSubmit: v => {
      if (dup(v.roll)) return { roll: t('errDuplicateId') };
      if (stu) Object.assign(stu, v); else sem().students.push(Object.assign({ id: uid() }, v));
      save(); render(); toast(stu ? t('toastSaved') : t('toastStudentAdded'));
    },
    extra: stu ? dlg => btn(t('delete'), { v: 'danger-ghost', icon: 'trash', onclick: () => { dlg.close(); deleteStudent(stu); } }) : null
  });
}
function deleteStudent(stu, after) {
  confirmDialog({ title: t('deleteStudent'), desc: t('confirmDeleteStudent'), onConfirm: () => { const snap = JSON.stringify(S); const s = sem();
    s.students = s.students.filter(x => x.id !== stu.id); Object.values(s.records).forEach(r => r.forEach(se => delete se.marks[stu.id])); save();
    if (after) after(); else render();
    toast(t('toastDeleted'), 'success', { label: t('undo'), fn: () => { S = migrate(JSON.parse(snap)); save(); render(); toast(t('toastUndone'), 'info'); } }); } });
}
function parseList(text) {
  const out = [];
  text.split(/\r?\n/).forEach(line => {
    line = line.trim(); if (!line) return;
    const cells = line.split(/[,;\t]/).map(c => c.replace(/^"|"$/g, '').trim());
    let roll, name, group = '', phone = '';
    if (cells.length >= 2) [roll, name, group = '', phone = ''] = cells; else { const m = line.match(/^(\S+)\s+(.+)$/); if (!m) return; roll = m[1]; name = m[2]; }
    if (!roll || !name || /^(roll|reg|id|s\.?no|student)/i.test(roll)) return;
    out.push({ id: uid(), roll, name, group, phone });
  });
  return out;
}
function importForm() {
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', class: 'input', 'aria-label': t('loadFile'), onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const text = /\.xlsx$/i.test(f.name) ? (await XLSX.read(await f.arrayBuffer())).map(r => r.join('\t')).join('\n') : await f.text();
      document.getElementById('f-list').value = text;
    } catch (err) { console.error(err); toast(t('errFile'), 'error'); }
  } });
  const tpl = btn(t('downloadTemplate'), { v: 'link', icon: 'download', onclick: () => saveBlob(XLSX.build([{ name: 'Students', header: true, widths: [16, 28, 10, 18], rows: [[t('studentId'), t('fullName'), t('group'), t('phone')], ['21-ECO-001', 'Ayesha Khan', 'A', '0300 1234567'], ['21-ECO-002', 'Ali Raza', 'A', '']] }]), 'students-template.xlsx') });
  formDialog({
    title: t('importStudents'), desc: t('importHelp'), submit: t('import'), wide: true,
    fields: [
      { custom: true, node: h('div', { class: 'field' }, h('label', {}, t('loadFile')), fileIn, h('div', { style: 'margin-top:6px' }, tpl)) },
      { key: 'list', label: t('studentList'), type: 'textarea', rows: 7, required: true, placeholder: '21-ECO-001, Ayesha Khan, A, 0300 1234567\n21-ECO-002, Ali Raza, A' }],
    onSubmit: v => {
      const arr = parseList(v.list); if (!arr.length) return { list: t('errNoRows') };
      const have = new Set(sem().students.map(x => x.roll)); const add = arr.filter(x => !have.has(x.roll) && have.add(x.roll));
      sem().students.push(...add); save(); render(); toast(`${num(add.length)} ${t('toastImported')}`);
    }
  });
}

/* =========================================================
   PAGE: DASHBOARD
   ========================================================= */
function startChecklist(s) {
  const hasRec = Object.values(s.records).some(r => r.length);
  const steps = [[true, 'chkSemester', null], [s.students.length > 0, 'chkStudents', 'students'], [s.subjects.length > 0, 'chkSubjects', 'attendance'], [hasRec, 'chkFirst', 'attendance']];
  const done = steps.filter(x => x[0]).length;
  if (done === steps.length || S.settings.hideStart) return null;
  return h('section', { class: 'card start' }, h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, t('gettingStarted')), h('p', { class: 'sub' }, `${num(done)} / ${num(steps.length)}`)),
    iconBtn('x', t('dismiss'), () => { S.settings.hideStart = true; save(); render(); })), progress((done / steps.length) * 100, ''),
    h('ul', { class: 'checklist' }, steps.map(([ok, key, to]) => h('li', { class: ok ? 'done' : '' }, h('span', { class: 'tick' }, ok ? icon('check', 14) : null), h('span', { class: 'grow' }, t(key)), !ok && to ? btn(t('goDo'), { size: 'sm', onclick: () => go(to) }) : null))));
}

function pageDashboard() {
  const s = sem(); if (!s) return noSemester(true);
  const ids = subjectIds(); const td = today(); const wd = new Date().getDay();
  const todays = allSessions(ids, td, td); let tp = 0, ta = 0; todays.forEach(se => { const c = sessionCounts(se); tp += c.P + c.T; ta += c.A; });
  const o = overall(); const points = trend();
  const hr = new Date().getHours(); const greet = hr < 12 ? 'greetMorning' : hr < 17 ? 'greetAfternoon' : 'greetEvening';
  const risk = sortStudents(s.students).map(st => ({ st, x: tally(st.id, ids) })).filter(r => statusOf(r.x.pct) === 'bad').sort((a, b) => a.x.pct - b.x.pct);
  const recent = allSessions().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const sched = s.subjects.filter(sj => subjDays(sj).includes(wd)).sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
  const anySched = s.subjects.some(sj => subjDays(sj).length);
  const root = h('div', {});
  root.append(pageHeader({
    title: t(greet), desc: `${s.name}${s.year ? ' · ' + s.year : ''} — ${t('dashDesc')}`,
    actions: [btn(t('markAttendance'), { v: 'primary', icon: 'attendance', onclick: () => s.subjects.length ? (s.subjects.length === 1 ? go('attendance/' + s.subjects[0].id + '/mark') : go('attendance')) : toast(t('needSubjects'), 'info') }),
      btn(t('addStudent'), { icon: 'plus', onclick: () => studentForm() })]
  }));
  const daysSince = S.settings.lastBackup ? (Date.now() - S.settings.lastBackup) / DAY : Infinity;
  if (s.students.length && daysSince > 7) root.append(h('div', { class: 'notice warn' }, icon('database', 18), h('span', {}, S.settings.lastBackup ? tf('backupOld', { n: num(Math.floor(daysSince)) }) : t('backupNever')), btn(t('backupNow'), { size: 'sm', onclick: () => shareBackup() })));
  const chk = startChecklist(s); if (chk) root.append(chk);
  root.append(h('section', { class: 'stats', 'aria-label': t('overview') },
    statCard({ label: t('totalStudents'), value: num(s.students.length), hint: `${num(s.subjects.length)} ${t('navSubjectsLc')}`, iconName: 'users' }),
    statCard({ label: t('presentToday'), value: todays.length ? num(tp) : '—', hint: todays.length ? `${t('lecturesToday')}: ${num(todays.length)}` : t('noLecturesToday'), iconName: 'check', tone: 'success' }),
    statCard({ label: t('absentToday'), value: todays.length ? num(ta) : '—', hint: todays.length ? t('acrossAll') : t('noLecturesToday'), iconName: 'x', tone: 'danger' }),
    statCard({ label: t('attendanceRate'), value: pctTxt(o.pct), hint: `${t('lecturesRecorded')}: ${num(o.sessions)}`, iconName: 'target', tone: o.pct === null ? '' : toneOf(o.pct) })));

  root.append(h('div', { class: 'grid-2' },
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, t('attendanceTrend')), h('span', { class: 'sub' }, t('last14'))),
      points.length ? lineChart(points, S.settings.min) : emptyState({ compact: true, iconName: 'trend', title: t('noTrendTitle'), desc: t('noTrendDesc') })),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, t('todayLectures')), h('span', { class: 'sub' }, weekdayLong(wd))),
      sched.length ? h('ul', { class: 'list' }, sched.map(sj => { const done = allSessions([sj.id], td, td).length;
        return h('li', {}, h('span', { class: 'time-chip' }, icon('clock', 14), sj.time || '—'), h('div', { class: 'li-main' }, h('b', {}, sj.name), h('small', {}, [sj.code, sj.room].filter(Boolean).join(' · ') || ' ')),
          done ? badge('success', t('done'), 'check') : btn(t('mark'), { v: 'primary', size: 'sm', onclick: () => go('attendance/' + sj.id + '/mark') })); }))
        : emptyState({ compact: true, iconName: 'clock', title: anySched ? t('noLecturesScheduled') : t('noScheduleTitle'), desc: anySched ? t('enjoyFree') : t('noScheduleDesc'), actions: !anySched && s.subjects.length ? btn(t('navAttendance'), { size: 'sm', onclick: () => go('attendance') }) : null }))));

  root.append(h('div', { class: 'grid-2' },
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, t('needsAttention')), risk.length ? badge('danger', num(risk.length)) : null),
      !s.students.length ? emptyState({ compact: true, iconName: 'users', title: t('noStudentsTitle'), desc: t('noStudentsDesc'), actions: btn(t('addStudent'), { v: 'primary', size: 'sm', icon: 'plus', onclick: () => studentForm() }) })
        : !risk.length ? emptyState({ compact: true, iconName: 'check', title: t('allGood'), desc: t('allGoodDesc').replace('{n}', num(S.settings.min)) })
          : h('ul', { class: 'list' }, risk.slice(0, 6).map(r => h('li', { class: 'click', onclick: () => go('students/' + r.st.id) }, avatar(r.st.name), h('div', { class: 'li-main' }, h('b', {}, r.st.name), h('small', { class: 'mono' }, r.st.roll)), badge('danger', pctTxt(r.x.pct)))))),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, t('bySubject'))),
      s.subjects.length ? h('ul', { class: 'bars' }, s.subjects.map(sj => { const a = subjectAvg(sj.id); return h('li', {}, h('div', { class: 'bar-top' }, h('span', {}, sj.name), h('b', {}, pctTxt(a))), progress(a, toneOf(a, sj.id))); }))
        : emptyState({ compact: true, iconName: 'book', title: t('noSubjectsTitle'), desc: t('noSubjectsDesc'), actions: btn(t('addSubject'), { v: 'primary', size: 'sm', icon: 'plus', onclick: () => subjectForm() }) }))));

  root.append(h('section', { class: 'card flush' }, h('div', { class: 'card-head pad' }, h('h2', {}, t('recentAttendance')), btn(t('viewAll'), { v: 'link', onclick: () => go('attendance') })),
    recent.length ? dataTable({
      onRow: r => go('attendance/' + r.subjectId),
      cols: [{ label: t('date'), render: r => fmtDate(r.date) }, { label: t('subject'), render: r => h('b', {}, subj(r.subjectId).name) }, { label: t('topic'), cls: 'hide-m', render: r => r.topic || '—' },
        { label: t('present'), cls: 'num hide-m', render: r => num(sessionCounts(r).P + sessionCounts(r).T) }, { label: t('absent'), cls: 'num hide-m', render: r => num(sessionCounts(r).A) },
        { label: t('rate'), cls: 'num', render: r => badge(toneOf(sessionCounts(r).pct) || 'neutral', pctTxt(sessionCounts(r).pct)) }], rows: recent
    }) : emptyState({ compact: true, iconName: 'attendance', title: t('noRecordsTitle'), desc: t('noRecordsDesc') })));
  return root;
}

/* =========================================================
   PAGE: SEMESTERS
   ========================================================= */
function pageSemesters() {
  const root = h('div', {}, pageHeader({ title: t('navSemesters'), desc: t('semPageDesc'), actions: btn(t('createSemester'), { v: 'primary', icon: 'plus', onclick: () => semesterForm() }) }));
  if (!S.semesters.length) { root.append(emptyState({ iconName: 'calendar', title: t('noSemTitle'), desc: t('noSemDesc'), actions: btn(t('createSemester'), { v: 'primary', icon: 'plus', onclick: () => semesterForm() }) }), h('p', { class: 'hint-line' }, t('semHint'))); return root; }
  root.append(h('div', { class: 'grid-cards' }, S.semesters.map(s => {
    const ov = semOverview(s); const active = s.id === S.current;
    return h('article', { class: 'card sem-card' + (active ? ' current' : '') },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, s.name), h('p', { class: 'sub' }, s.year || t('noYear'))), s.archived ? badge('neutral', t('archived'), 'archive') : active ? badge('primary', t('current')) : badge('success', t('active'))),
      h('dl', { class: 'meta' }, [[t('students'), s.students.length], [t('navSubjects'), s.subjects.length], [t('lectures'), ov.lectures], [t('avgAttendance'), pctTxt(ov.pct)]].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, typeof v === 'number' ? num(v) : v)))),
      h('div', { class: 'card-actions' },
        btn(active ? t('openDashboard') : t('open'), { v: 'primary', size: 'sm', onclick: () => { S.current = s.id; s.archived = false; save(); go('dashboard'); } }),
        btn(t('edit'), { size: 'sm', icon: 'edit', onclick: () => semesterForm(s) }),
        btn(s.archived ? t('unarchive') : t('archive'), { size: 'sm', icon: 'archive', onclick: () => { s.archived = !s.archived; save(); render(); toast(t('toastSaved')); } }),
        btn(t('delete'), { v: 'danger-ghost', size: 'sm', icon: 'trash', iconOnly: true, title: t('delete'), onclick: () => deleteSemester(s) })));
  })));
  return root;
}

/* =========================================================
   PAGE: STUDENTS (+ profile)
   ========================================================= */
function pageStudents(r) {
  if (r.parts[1]) return pageStudent(r.parts[1]);
  const s = sem(); if (!s) return noSemester();
  if (r.q.has('q')) { V.students.q = r.q.get('q'); V.students.page = 1; history.replaceState(null, '', href('students')); }
  const f = V.students; const ids = subjectIds();
  const groups = [...new Set(s.students.map(x => x.group).filter(Boolean))].sort();
  const root = h('div', {}, pageHeader({
    title: t('navStudents'), desc: `${t('studentsDesc')} ${s.name}.`,
    actions: [btn(t('importStudents'), { icon: 'upload', onclick: importForm }), btn(t('addStudent'), { v: 'primary', icon: 'plus', onclick: () => studentForm() })]
  }));
  if (!s.students.length) { root.append(emptyState({ iconName: 'users', title: t('noStudentsTitle'), desc: t('noStudentsDesc'), actions: [btn(t('addStudent'), { v: 'primary', icon: 'plus', onclick: () => studentForm() }), btn(t('importStudents'), { icon: 'upload', onclick: importForm })] })); return root; }
  const results = h('div', {});
  const paint = () => {
    results.innerHTML = '';
    const q = f.q.trim().toLowerCase();
    let rows = sortStudents(s.students).map(st => ({ st, x: tally(st.id, ids) }))
      .filter(r2 => (!q || (r2.st.name + ' ' + r2.st.roll).toLowerCase().includes(q)) && (!f.group || r2.st.group === f.group) && (!f.status || statusOf(r2.x.pct) === f.status));
    const total = rows.length; const pages = Math.max(1, Math.ceil(total / PAGE)); if (f.page > pages) f.page = pages;
    rows = rows.slice((f.page - 1) * PAGE, f.page * PAGE);
    if (!total) { results.append(emptyState({ iconName: 'search', title: t('noResultsTitle'), desc: t('noResultsDesc'), actions: btn(t('clearFilters'), { onclick: () => { Object.assign(f, { q: '', group: '', status: '', page: 1 }); render(); } }) })); return; }
    results.append(h('div', { class: 'card flush' }, dataTable({
      onRow: r2 => go('students/' + r2.st.id), rows,
      cols: [
        { label: t('student'), render: r2 => h('div', { class: 'cell-user' }, avatar(r2.st.name), h('b', {}, r2.st.name)) },
        { label: t('studentId'), render: r2 => h('span', { class: 'mono' }, r2.st.roll) },
        { label: t('group'), render: r2 => r2.st.group || '—' },
        { label: t('attendance'), cls: 'att-col', render: r2 => h('div', { class: 'att-cell' }, progress(r2.x.pct, toneOf(r2.x.pct)), h('b', {}, pctTxt(r2.x.pct))) },
        { label: t('status'), render: r2 => statusBadge(r2.x.pct) },
        { label: '', cls: 'actions', render: r2 => h('div', { class: 'row-actions', onclick: e => e.stopPropagation() }, statusOf(r2.x.pct) === 'bad' ? remindBtn(r2.st, t('allSubjects'), r2.x) : null, iconBtn('edit', t('edit'), () => studentForm(r2.st)), iconBtn('trash', t('delete'), () => deleteStudent(r2.st), 'danger-ghost')) }]
    }), pager(total, f.page, PAGE, p => { f.page = p; paint(); window.scrollTo(0, 0); })));
  };
  const opts = (arr, all) => [{ value: '', label: all }, ...arr];
  root.append(h('div', { class: 'toolbar' },
    searchInput(f.q, t('searchStudents'), e => { f.q = e.target.value; f.page = 1; paint(); }),
    groups.length ? selectInput(f.group, opts(groups.map(g => ({ value: g, label: g })), t('allGroups')), v => { f.group = v; f.page = 1; paint(); }, t('group')) : null,
    selectInput(f.status, opts([['ok', 'stGood'], ['warn', 'stWarning'], ['bad', 'stShortage'], ['none', 'stNoData']].map(([v, k]) => ({ value: v, label: t(k) })), t('allStatuses')), v => { f.status = v; f.page = 1; paint(); }, t('status'))), results);
  paint();
  return root;
}

function pageStudent(id) {
  const s = sem(); const stu = s && s.students.find(x => x.id === id);
  if (!stu) return pageStudents({ parts: ['students'], q: new URLSearchParams() });
  const ids = subjectIds(); const x = tally(stu.id, ids);
  const rows = s.subjects.map(sj => ({ sj, x: stats(sj.id, stu.id) }));
  const cells = {}; const cls = { P: 'ok', T: 'warn', L: 'info', A: 'bad' }, lbl = { P: t('present'), T: t('late'), L: t('leave'), A: t('absent') };
  allSessions(ids).forEach(se => { const m = se.marks[stu.id]; if (!m) return; const prev = cells[se.date]; const rank = { A: 4, T: 3, L: 2, P: 1 }; if (!prev || rank[m] > rank[prev.m]) cells[se.date] = { m, cls: cls[m], title: `${lbl[m]} · ${subj(se.subjectId).name}` }; });
  const recent = allSessions(ids).filter(se => se.marks[stu.id]).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const root = h('div', {}, pageHeader({
    crumbs: [{ label: t('navStudents'), href: href('students') }, { label: stu.name }], title: stu.name, desc: dotted([stu.roll, stu.group, stu.phone]),
    actions: [statusOf(x.pct) === 'bad' || statusOf(x.pct) === 'warn' ? (stu.phone ? h('a', { class: 'btn primary', href: waLink(stu.phone, reminderText(stu, t('allSubjects'), x)), target: '_blank', rel: 'noopener' }, icon('message', 18), h('span', {}, t('remind'))) : btn(t('remind'), { v: 'primary', icon: 'message', onclick: () => { toast(t('noPhone'), 'info'); studentForm(stu); } })) : null,
      btn(t('edit'), { icon: 'edit', onclick: () => studentForm(stu) }), btn(t('delete'), { v: 'danger-ghost', icon: 'trash', onclick: () => deleteStudent(stu, () => go('students')) })]
  }));
  root.append(h('section', { class: 'stats' },
    statCard({ label: t('attendanceRate'), value: pctTxt(x.pct), hint: x.total ? outlookText(outlook(x), undefined) : t('noRecordsTitle'), iconName: 'target', tone: toneOf(x.pct) }),
    statCard({ label: t('present'), value: num(x.P), hint: x.T ? `${t('late')}: ${num(x.T)}` : null, iconName: 'check', tone: 'success' }),
    statCard({ label: t('absent'), value: num(x.A), iconName: 'x', tone: 'danger' }),
    statCard({ label: t('leave'), value: num(x.L), iconName: 'minus', tone: 'info' })));
  root.append(h('div', { class: 'grid-2 wide-left' },
    h('section', { class: 'card flush' }, h('div', { class: 'card-head pad' }, h('h2', {}, t('bySubject'))),
      rows.length ? dataTable({ rows, cols: [
        { label: t('subject'), render: r => h('b', {}, r.sj.name) },
        { label: t('attendance'), render: r => h('div', { class: 'att-cell' }, progress(r.x.pct, toneOf(r.x.pct, r.sj.id)), h('b', {}, pctTxt(r.x.pct))) },
        { label: t('outlook'), cls: 'hide-m', render: r => h('span', { class: 'sub' }, outlookText(outlook(r.x, r.sj.id), r.sj.id)) },
        { label: t('status'), render: r => statusBadge(r.x.pct, r.sj.id) }] })
        : emptyState({ compact: true, iconName: 'book', title: t('noSubjectsTitle'), desc: t('noSubjectsDesc') })),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, t('recentRecords'))),
      recent.length ? h('ul', { class: 'list' }, recent.map(se => { const m = se.marks[stu.id]; return h('li', {}, h('div', { class: 'li-main' }, h('b', {}, subj(se.subjectId).name), h('small', {}, fmtDate(se.date))), badge({ P: 'success', T: 'warning', L: 'info', A: 'danger' }[m], lbl[m])); }))
        : emptyState({ compact: true, iconName: 'calendar', title: t('noRecordsTitle'), desc: t('noRecordsDesc') }))));
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, t('calendar')), h('span', { class: 'sub' }, t('last16w'))),
    heatmap(cells, [['ok', t('present')], ['warn', t('late')], ['info', t('leave')], ['bad', t('absent')]])));
  return root;
}

/* =========================================================
   PAGE: ATTENDANCE (subjects list, subject detail, mark)
   ========================================================= */
function pageAttendance() {
  const s = sem(); if (!s) return noSemester();
  const root = h('div', {}, pageHeader({ title: t('navAttendance'), desc: t('attDesc'), actions: btn(t('addSubject'), { v: 'primary', icon: 'plus', onclick: () => subjectForm() }) }));
  if (!s.subjects.length) { root.append(emptyState({ iconName: 'book', title: t('noSubjectsTitle'), desc: t('noSubjectsDesc'), actions: btn(t('addSubject'), { v: 'primary', icon: 'plus', onclick: () => subjectForm() }) })); return root; }
  if (!s.students.length) root.append(h('div', { class: 'notice warn' }, icon('alert', 18), h('span', {}, t('needStudents')), btn(t('addStudent'), { size: 'sm', onclick: () => go('students') })));
  root.append(h('div', { class: 'card flush' }, dataTable({
    rows: s.subjects, onRow: sj => go('attendance/' + sj.id),
    cols: [
      { label: t('subject'), render: sj => h('div', {}, h('b', {}, sj.name), sj.code ? h('div', { class: 'sub mono' }, sj.code) : null) },
      { label: t('schedule'), cls: 'hide-m', render: sj => subjDays(sj).length ? h('span', { class: 'sub' }, subjDays(sj).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(weekdayShort).join(' · ') + (sj.time ? ' · ' + sj.time : '')) : '—' },
      { label: t('lectures'), cls: 'num', render: sj => num((s.records[sj.id] || []).length) },
      { label: t('avgAttendance'), render: sj => { const a = subjectAvg(sj.id); return h('div', { class: 'att-cell' }, progress(a, toneOf(a, sj.id)), h('b', {}, pctTxt(a))); } },
      { label: t('lastLecture'), cls: 'hide-m', render: sj => { const l = (s.records[sj.id] || []).map(x => x.date).sort().pop(); return l ? fmtDate(l) : '—'; } },
      { label: '', cls: 'actions', render: sj => h('div', { class: 'row-actions', onclick: e => e.stopPropagation() }, btn(t('mark'), { v: 'primary', size: 'sm', icon: 'check', onclick: () => go('attendance/' + sj.id + '/mark') })) }]
  })));
  return root;
}

function pageSubject(id) {
  const s = sem(); const sj = subj(id);
  if (!sj) return pageAttendance();
  const sessions = (s.records[id] || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const rows = sortStudents(s.students).map(st => ({ st, x: stats(id, st.id) }));
  const low = rows.filter(r => statusOf(r.x.pct, id) === 'bad').length; const avg = subjectAvg(id);
  const root = h('div', {}, pageHeader({
    crumbs: [{ label: t('navAttendance'), href: href('attendance') }, { label: sj.name }], title: sj.name, desc: [sj.code, sj.teacher, sj.room].some(Boolean) ? dotted([sj.code, sj.teacher, sj.room]) : t('subjectDesc'),
    actions: [btn(t('markAttendance'), { v: 'primary', icon: 'check', onclick: () => go('attendance/' + id + '/mark') }), btn(t('edit'), { icon: 'edit', onclick: () => subjectForm(sj) }),
      btn(t('delete'), { v: 'danger-ghost', icon: 'trash', onclick: () => deleteSubject(sj, () => go('attendance')) })]
  }));
  root.append(h('section', { class: 'stats three' }, statCard({ label: t('lectures'), value: num(sessions.length), iconName: 'calendar' }),
    statCard({ label: t('avgAttendance'), value: pctTxt(avg), iconName: 'target', tone: toneOf(avg, id) }),
    statCard({ label: t('belowMin'), value: num(low), hint: `< ${num(minFor(id))}%`, iconName: 'alert', tone: low ? 'danger' : 'success' })));
  root.append(h('div', { class: 'grid-2 wide-left' },
    h('section', { class: 'card flush' }, h('div', { class: 'card-head pad' }, h('h2', {}, t('studentAttendance'))),
      rows.length && sessions.length ? dataTable({ rows, onRow: r => go('students/' + r.st.id), cols: [
        { label: t('student'), render: r => h('div', { class: 'cell-user' }, avatar(r.st.name), h('div', {}, h('b', {}, r.st.name), h('div', { class: 'sub mono' }, r.st.roll))) },
        { label: t('attended'), cls: 'num hide-m', render: r => `${num(r.x.att)}/${num(r.x.total)}` },
        { label: t('attendance'), render: r => h('div', { class: 'att-cell' }, progress(r.x.pct, toneOf(r.x.pct, id)), h('b', {}, pctTxt(r.x.pct))) },
        { label: t('outlook'), cls: 'hide-m', render: r => h('span', { class: 'sub' }, outlookText(outlook(r.x, id), id)) },
        { label: t('status'), render: r => statusBadge(r.x.pct, id) },
        { label: '', cls: 'actions', render: r => h('div', { class: 'row-actions', onclick: e => e.stopPropagation() }, ['bad', 'warn'].includes(statusOf(r.x.pct, id)) ? remindBtn(r.st, sj.name, r.x, id) : null) }] })
        : emptyState({ compact: true, iconName: 'users', title: s.students.length ? t('noRecordsTitle') : t('noStudentsTitle'), desc: s.students.length ? t('noRecordsDesc') : t('noStudentsDesc') })),
    h('section', { class: 'card flush' }, h('div', { class: 'card-head pad' }, h('h2', {}, t('lectureHistory'))),
      sessions.length ? h('ul', { class: 'list history' }, sessions.map(se => { const c = sessionCounts(se); return h('li', {},
        h('div', { class: 'li-main' }, h('b', {}, fmtDate(se.date)), se.topic ? h('span', { class: 'topic' }, se.topic) : null, h('small', {}, `${t('present')} ${num(c.P)} · ${t('late')} ${num(c.T)} · ${t('absent')} ${num(c.A)} · ${t('leave')} ${num(c.L)}`)),
        badge(toneOf(c.pct, id) || 'neutral', pctTxt(c.pct)),
        iconBtn('edit', t('edit'), () => go('attendance/' + id + '/mark?session=' + se.id)),
        iconBtn('trash', t('delete'), () => confirmDialog({ title: t('deleteLecture'), desc: t('confirmDelete'), onConfirm: () => withUndo(t('toastDeleted'), () => { s.records[id] = s.records[id].filter(x => x.id !== se.id); }) }), 'danger-ghost')); }))
        : emptyState({ compact: true, iconName: 'calendar', title: t('noSessionsTitle'), desc: t('noSessionsDesc') }))));
  return root;
}

function makeDraft(subjectId, sessionId, date) {
  const s = sem();
  if (sessionId) { const se = (s.records[subjectId] || []).find(x => x.id === sessionId); if (se) return { subjectId, sessionId, date: se.date, topic: se.topic || '', marks: Object.assign({}, se.marks), q: '' }; }
  const marks = {}; s.students.forEach(st => { marks[st.id] = null; });
  return { subjectId, sessionId: null, date: date || today(), topic: '', marks, q: '' };
}

const MARKS = [['P', 'present', 'check'], ['T', 'late', 'clock'], ['A', 'absent', 'x'], ['L', 'leave', 'minus']];
function pageMark(r) {
  const s = sem(); const id = r.parts[1]; const sj = subj(id); if (!sj) return pageAttendance();
  const sid = r.q.get('session') || null;
  if (!draft || draft.subjectId !== id || (draft.sessionId || null) !== sid) draft = makeDraft(id, sid, r.q.get('date'));
  const d = draft; const students = sortStudents(s.students);
  const root = h('div', { class: 'mark-page' }, pageHeader({
    crumbs: [{ label: t('navAttendance'), href: href('attendance') }, { label: sj.name, href: href('attendance/' + id) }, { label: d.sessionId ? t('editLecture') : t('markAttendance') }],
    title: d.sessionId ? t('editLecture') : t('markAttendance'), desc: `${s.name} · ${sj.name}`
  }));
  if (!students.length) { root.append(emptyState({ iconName: 'users', title: t('noStudentsTitle'), desc: t('needStudents'), actions: btn(t('addStudent'), { v: 'primary', icon: 'plus', onclick: () => go('students') }) })); return root; }

  const counts = () => { const c = { P: 0, T: 0, A: 0, L: 0, U: 0 }; students.forEach(x => { c[d.marks[x.id] || 'U']++; }); return c; };
  const summary = h('div', { class: 'summary', role: 'group', 'aria-label': t('summary') });
  const paintSummary = () => { const c = counts(); summary.innerHTML = ''; summary.append(
    ...[['P', 'present', 'success', 'check'], ['T', 'late', 'warning', 'clock'], ['A', 'absent', 'danger', 'x'], ['L', 'leave', 'info', 'minus'], ['U', 'unmarked', 'neutral', 'info']].map(([k, key, tone, ic]) =>
      h('div', { class: 'sum ' + tone }, icon(ic, 16), h('span', {}, t(key)), h('b', {}, num(c[k]))))); };
  const list = h('div', { class: 'att-list', role: 'list' });
  const setMark = (stu, k, row, seg) => {
    d.marks[stu.id] = d.marks[stu.id] === k ? null : k;
    [...seg.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === d.marks[stu.id])));
    row.dataset.mark = d.marks[stu.id] || ''; paintSummary();
  };
  const paintRows = () => {
    list.innerHTML = ''; const q = d.q.trim().toLowerCase();
    students.filter(x => !q || (x.name + ' ' + x.roll).toLowerCase().includes(q)).forEach(stu => {
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': stu.name });
      const row = h('div', { class: 'att-row', role: 'listitem', tabindex: 0, 'data-mark': d.marks[stu.id] || '',
        onkeydown: e => {
          const k = e.key.toUpperCase();
          if (['P', 'A', 'L', 'T'].includes(k) && e.target === row) { setMark(stu, k, row, seg); const nx = row.nextElementSibling; if (nx) nx.focus(); }
          else if (e.key === 'ArrowDown' && row.nextElementSibling) { e.preventDefault(); row.nextElementSibling.focus(); }
          else if (e.key === 'ArrowUp' && row.previousElementSibling) { e.preventDefault(); row.previousElementSibling.focus(); }
        } });
      MARKS.forEach(([k, key, ic]) =>
        seg.append(h('button', { type: 'button', class: 'seg-btn ' + k, 'data-k': k, 'aria-pressed': String(d.marks[stu.id] === k), title: t(key), onclick: () => setMark(stu, k, row, seg) }, icon(ic, 16), h('span', {}, t(key)))));
      row.append(avatar(stu.name), h('div', { class: 'att-who' }, h('b', {}, stu.name), h('small', { class: 'mono' }, stu.roll)), seg);
      list.append(row);
    });
    if (!list.children.length) list.append(emptyState({ compact: true, iconName: 'search', title: t('noResultsTitle'), desc: t('noResultsDesc') }));
  };
  const bulk = v => { students.forEach(x => { d.marks[x.id] = v; }); paintRows(); paintSummary(); };

  root.append(h('div', { class: 'card controls' },
    h('div', { class: 'field inline date-f2' }, h('label', { for: 'm-sub' }, t('subject')),
      selectInput(id, s.subjects.map(x => ({ value: x.id, label: x.name })), v => { if (d.sessionId) return; go('attendance/' + v + '/mark?date=' + d.date); }, t('subject'))),
    h('div', { class: 'field inline date-f2' }, h('label', { for: 'm-date' }, t('date')), h('input', { id: 'm-date', type: 'date', class: 'input', value: d.date, onchange: e => { if (e.target.value) d.date = e.target.value; } })),
    h('div', { class: 'field inline grow-f' }, h('label', { for: 'm-topic' }, t('topic')), h('input', { id: 'm-topic', class: 'input', value: d.topic, placeholder: t('topicPh'), maxlength: 120, oninput: e => { d.topic = e.target.value; } })),
    h('div', { class: 'field inline grow-f' }, h('label', {}, t('search')), searchInput(d.q, t('searchStudents'), e => { d.q = e.target.value; paintRows(); })),
    h('div', { class: 'bulk' }, btn(t('markAllPresent'), { icon: 'check', size: 'sm', onclick: () => bulk('P') }), btn(t('clear'), { v: 'ghost', size: 'sm', icon: 'refresh', onclick: () => bulk(null) }))));
  root.append(summary, h('p', { class: 'kbd-hint' }, t('kbdHint')), list);

  const doSave = () => {
    const marks = {}; students.forEach(x => { if (d.marks[x.id]) marks[x.id] = d.marks[x.id]; });
    const arr = s.records[id] = s.records[id] || [];
    const topic = d.topic.trim();
    if (d.sessionId) { const se = arr.find(x => x.id === d.sessionId); se.date = d.date; se.marks = marks; se.topic = topic; } else arr.push({ id: uid(), date: d.date, marks, topic });
    save(); draft = null; go('attendance/' + id); toast(t('toastAttSaved'));
  };
  root.append(h('div', { class: 'savebar' }, h('div', { class: 'savebar-in' },
    h('span', { class: 'sub savebar-note' }, fmtDate(d.date)), h('span', { class: 'grow' }),
    btn(t('cancel'), { v: 'ghost', onclick: () => { draft = null; go('attendance/' + id); } }),
    btn(t('saveAttendance'), { v: 'primary', icon: 'save', onclick: () => {
      const c = counts();
      if (c.U > 0) confirmDialog({ title: `${num(c.U)} ${t('unmarked')}`, desc: t('unmarkedWarn'), confirm: t('saveAnyway'), danger: false, onConfirm: doSave }); else doSave();
    } }))));
  paintRows(); paintSummary();
  return root;
}

/* =========================================================
   PAGE: REPORTS
   ========================================================= */
function pageReports() {
  const s = sem(); if (!s) return noSemester();
  const f = V.rep;
  const root = h('div', {});
  if (!s.subjects.length) { root.append(pageHeader({ title: t('navReports'), desc: t('reportsDesc') }), emptyState({ iconName: 'chart', title: t('noReportsTitle'), desc: t('noReportsDesc'), actions: btn(t('addSubject'), { v: 'primary', icon: 'plus', onclick: () => subjectForm() }) })); return root; }
  if (f.subject !== 'all' && !subj(f.subject)) f.subject = 'all';
  const ids = f.subject === 'all' ? subjectIds() : [f.subject]; const sj = f.subject === 'all' ? null : subj(f.subject);
  const from = f.from || null, to = f.to || null;
  const o = overall(ids, from, to); const points = trend(ids, from, to, 20);
  const q = f.q.trim().toLowerCase();
  let rows = sortStudents(s.students).map(st => ({ st, x: tally(st.id, ids, from, to) })).filter(r => !q || (r.st.name + ' ' + r.st.roll).toLowerCase().includes(q));
  if (f.sort === 'pct') rows.sort((a, b) => ((a.x.pct ?? -1) - (b.x.pct ?? -1)) * (f.dir === 'asc' ? 1 : -1));
  root.append(pageHeader({
    title: t('navReports'), desc: t('reportsDesc'),
    actions: [btn('Excel', { icon: 'sheet', title: t('exportXlsx'), onclick: exportXlsx }), btn('CSV', { icon: 'download', title: t('exportCsv'), onclick: () => (sj ? exportCsv(sj) : exportAllCsv()) }),
      btn('PDF', { icon: 'file', title: t('exportPdf'), disabled: !sj, onclick: () => printRegister(sj) }),
      btn(t('share'), { icon: 'share', title: t('shareWa'), disabled: !sj, onclick: () => shareWa(sj) })]
  }));
  root.append(h('div', { class: 'toolbar' },
    selectInput(f.subject, [{ value: 'all', label: t('allSubjects') }, ...s.subjects.map(x => ({ value: x.id, label: x.name }))], v => { f.subject = v; render(); }, t('subject')),
    h('label', { class: 'date-f' }, h('span', {}, t('from')), h('input', { type: 'date', class: 'input', value: f.from, onchange: e => { f.from = e.target.value; render(); } })),
    h('label', { class: 'date-f' }, h('span', {}, t('to')), h('input', { type: 'date', class: 'input', value: f.to, onchange: e => { f.to = e.target.value; render(); } })),
    searchInput(f.q, t('searchStudents'), e => { f.q = e.target.value; render(); document.querySelector('.toolbar input[type=search]').focus(); })));
  if (!o.sessions) { root.append(emptyState({ iconName: 'chart', title: t('noReportsTitle'), desc: f.from || f.to ? t('noReportsRange') : t('noReportsDesc'), actions: (f.from || f.to) ? btn(t('clearFilters'), { onclick: () => { f.from = f.to = ''; render(); } }) : null })); return root; }
  root.append(h('section', { class: 'stats six' },
    statCard({ label: t('avgAttendance'), value: pctTxt(o.pct), iconName: 'target', tone: toneOf(o.pct, sj && sj.id) }), statCard({ label: t('totalSessions'), value: num(o.sessions), iconName: 'calendar' }),
    statCard({ label: t('present'), value: num(o.P), iconName: 'check', tone: 'success' }), statCard({ label: t('late'), value: num(o.T), iconName: 'clock', tone: 'warning' }),
    statCard({ label: t('absent'), value: num(o.A), iconName: 'x', tone: 'danger' }), statCard({ label: t('leave'), value: num(o.L), iconName: 'minus', tone: 'info' })));
  root.append(h('div', { class: 'grid-2 wide-left' },
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, t('attendanceTrend'))), lineChart(points, sj ? minFor(sj.id) : S.settings.min)),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, t('distribution'))), distributionBar(o.P, o.A, o.L, o.T))));
  const dm = byDate(ids, from, to), cells = {};
  Object.keys(dm).forEach(dt => { const pct = dm[dt].n ? (dm[dt].att / dm[dt].n) * 100 : null; const st = statusOf(pct, sj && sj.id); cells[dt] = { cls: st === 'none' ? '' : st, title: pctTxt(pct) }; });
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, t('calendar')), h('span', { class: 'sub' }, t('last16w'))),
    heatmap(cells, [['ok', t('stGood')], ['warn', t('stWarning')], ['bad', t('stShortage')]])));
  root.append(h('section', { class: 'card flush' }, h('div', { class: 'card-head pad' }, h('h2', {}, t('studentPerformance')), h('span', { class: 'sub' }, `${num(rows.length)} ${t('students')}`)),
    rows.length ? dataTable({ rows, sortKey: f.sort, sortDir: f.dir, onSort: k => { f.dir = f.sort === k && f.dir === 'asc' ? 'desc' : 'asc'; f.sort = k; render(); }, onRow: r => go('students/' + r.st.id), cols: [
      { label: t('student'), render: r => h('div', { class: 'cell-user' }, avatar(r.st.name), h('div', {}, h('b', {}, r.st.name), h('div', { class: 'sub mono' }, r.st.roll))) },
      { label: t('sessions'), cls: 'num hide-m', render: r => num(r.x.total) }, { label: t('present'), cls: 'num hide-m', render: r => num(r.x.P) }, { label: t('late'), cls: 'num hide-m', render: r => num(r.x.T) },
      { label: t('absent'), cls: 'num hide-m', render: r => num(r.x.A) }, { label: t('leave'), cls: 'num hide-m', render: r => num(r.x.L) },
      { label: t('attendance'), sort: 'pct', cls: 'att-col', render: r => h('div', { class: 'att-cell' }, progress(r.x.pct, toneOf(r.x.pct, sj && sj.id)), h('b', {}, pctTxt(r.x.pct))) },
      { label: t('status'), render: r => statusBadge(r.x.pct, sj && sj.id) }] })
      : emptyState({ compact: true, iconName: 'search', title: t('noResultsTitle'), desc: t('noResultsDesc') })));
  return root;
}

/* ---------- exports ---------- */
function saveBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
const download = (name, text, type) => saveBlob(new Blob([text], { type: type || 'text/plain' }), name);
const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const slug = x => x.replace(/[^\w؀-ۿ]+/g, '_');
const sessionsSorted = id => (sem().records[id] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
const reportRows = id => sortStudents(sem().students).map(stu => ({ stu, x: stats(id, stu.id) }));
const r1 = p => (p === null ? '' : Math.round(p * 10) / 10);
function registerRows(sj) {
  const ses = sessionsSorted(sj.id);
  return [[t('studentId'), t('fullName'), ...ses.map(x => x.date), t('attended'), 'Total', '%'],
    ...reportRows(sj.id).map(r => [r.stu.roll, r.stu.name, ...ses.map(se => se.marks[r.stu.id] || ''), r.x.att, r.x.total, r1(r.x.pct)])];
}
function summaryRows() {
  const s = sem(); const subs = s.subjects;
  return [[t('studentId'), t('fullName'), t('group'), ...subs.map(x => x.name + ' %'), t('attendanceRate')],
    ...sortStudents(s.students).map(stu => [stu.roll, stu.name, stu.group || '', ...subs.map(sj => r1(stats(sj.id, stu.id).pct)), r1(tally(stu.id, subjectIds()).pct)])];
}
function exportCsv(sj) {
  download(`${slug(sem().name)}_${slug(sj.name)}.csv`, '﻿' + registerRows(sj).map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8'); toast(t('toastExported'));
}
function exportAllCsv() {
  download(`${slug(sem().name)}_all_subjects.csv`, '﻿' + summaryRows().map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8'); toast(t('toastExported'));
}
function exportXlsx() {
  const s = sem(); const rtl = lang() === 'ur';
  const sheets = [{ name: t('summary'), header: true, rtl, widths: [16, 28, 10, ...s.subjects.map(() => 16), 14], rows: summaryRows() },
    ...s.subjects.map(sj => ({ name: sj.name, header: true, rtl, widths: [16, 28], rows: registerRows(sj) }))];
  saveBlob(XLSX.build(sheets), `${slug(s.name)}_attendance.xlsx`); toast(t('toastExported'));
}
function shareWa(sj) {
  const rows = reportRows(sj.id); const short = rows.filter(r => statusOf(r.x.pct, sj.id) === 'bad'); const n = (sem().records[sj.id] || []).length;
  let msg = `*${t('waTitle')}*\n${sem().name} · ${sj.name}\n${t('lectures')}: ${n} · ${t('students')}: ${rows.length}\n${t('min')}: ${minFor(sj.id)}%\n\n`;
  msg += `*${t('shortageList')} (${short.length})*\n` + (short.length ? short.map(r => `${r.stu.roll} - ${r.stu.name}: ${r.x.pct.toFixed(1)}%`).join('\n') : t('allGood'));
  msg += `\n\n*${t('attendance')}*\n` + rows.map(r => `${r.stu.roll} ${r.stu.name}: ${r.x.pct === null ? '—' : r.x.pct.toFixed(0) + '%'}`).join('\n');
  if (navigator.share) navigator.share({ text: msg }).catch(() => {}); else window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}
function printRegister(sj) {
  const ses = sessionsSorted(sj.id); const s = sem(); const rows = reportRows(sj.id); const o = overall([sj.id]);
  const short = rows.filter(r => statusOf(r.x.pct, sj.id) === 'bad').length;
  const pa = document.getElementById('print-area'); pa.innerHTML = '';
  pa.setAttribute('dir', lang() === 'ur' ? 'rtl' : 'ltr');
  pa.append(
    h('div', { class: 'pr-head' }, h('div', {}, S.settings.institution ? h('div', { class: 'pr-inst' }, S.settings.institution) : null, h('h1', {}, `${sj.name}${sj.code ? ' (' + sj.code + ')' : ''}`), h('p', {}, `${s.name}${s.year ? ' · ' + s.year : ''}`)),
      h('div', { class: 'pr-meta' }, sj.teacher ? h('p', {}, `${t('teacherL')}: ${sj.teacher}`) : null, h('p', {}, `${t('date')}: ${new Date().toLocaleDateString('en-GB')}`))),
    h('div', { class: 'pr-sum' }, [[t('lectures'), ses.length], [t('students'), rows.length], [t('avgAttendance'), o.pct === null ? '-' : o.pct.toFixed(1) + '%'], [`${t('min')} %`, minFor(sj.id)], [t('shortage'), short]].map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, String(v))))),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, t('studentId')), h('th', {}, t('fullName')), ...ses.map(x => h('th', {}, x.date.slice(5).split('-').reverse().join('/'))), h('th', {}, t('attended')), h('th', {}, '%'))),
      h('tbody', {}, rows.map((r, i) => h('tr', { class: statusOf(r.x.pct, sj.id) === 'bad' ? 'short' : '' }, h('td', {}, String(i + 1)), h('td', {}, r.stu.roll), h('td', { class: 'l' }, r.stu.name), ...ses.map(se => h('td', {}, se.marks[r.stu.id] || '-')), h('td', {}, `${r.x.att}/${r.x.total}`), h('td', {}, r.x.pct === null ? '-' : r.x.pct.toFixed(0) + '%'))))),
    h('p', { class: 'pr-legend' }, 'P = ' + t('present') + ' · T = ' + t('late') + ' · A = ' + t('absent') + ' · L = ' + t('leave') + ' · ' + t('shortageHl')),
    h('p', { class: 'pr-sign' }, t('signature') + ': ____________________'));
  setTimeout(() => window.print(), 100);
}
async function shareBackup() {
  S.settings.lastBackup = Date.now(); save();
  const name = `gmc-backup-${today()}.json`; const json = JSON.stringify(S);
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'GMC Check-in backup' }); render(); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  download(name, json, 'application/json'); toast(t('toastBackup')); render();
}

/* =========================================================
   PAGE: SETTINGS
   ========================================================= */
function pageSettings() {
  const set = (k, v, rerender) => { S.settings[k] = v; save(); if (rerender) render(); };
  const row = (title, desc, control) => h('div', { class: 'set-row' }, h('div', {}, h('b', {}, title), desc ? h('p', { class: 'sub' }, desc) : null), h('div', { class: 'set-ctl' }, control));
  const text = (key, ph) => h('input', { class: 'input', value: S.settings[key], placeholder: ph, onchange: e => { set(key, e.target.value.trim()); toast(t('toastSaved')); } });
  const numIn = (key, fallback) => h('input', { class: 'input num-in', type: 'number', min: 0, max: 100, value: S.settings[key], onchange: e => { const v = Math.min(100, Math.max(0, +e.target.value || fallback)); e.target.value = v; set(key, v); toast(t('toastSaved')); } });
  const toggle = key => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: S.settings[key], onchange: e => { set(key, e.target.checked); toast(t('toastSaved')); } }), h('span', {}));
  const choice = (opts, cur, fn) => h('div', { class: 'choice', role: 'radiogroup' }, opts.map(([v, l]) => h('button', { class: 'choice-btn' + (cur === v ? ' on' : ''), role: 'radio', 'aria-checked': String(cur === v), onclick: () => fn(v) }, l)));
  const sections = {
    general: () => [h('h2', {}, t('setGeneral')),
      row(t('teacherName'), t('teacherNameDesc'), text('teacher', t('teacherDefault'))), row(t('institution'), t('institutionDesc'), text('institution', t('institutionPh'))),
      row(t('language'), t('languageDesc'), choice([['en', 'English'], ['ur', 'اردو']], lang(), v => set('lang', v, true))),
      row(t('gettingStarted'), t('gettingStartedDesc'), btn(t('showAgain'), { onclick: () => { set('hideStart', false); go('dashboard'); } }))],
    academic: () => [h('h2', {}, t('setAcademic')),
      row(t('minAttendance'), t('minAttendanceDesc'), numIn('min', 75)), row(t('warnAt'), t('warnAtDesc'), numIn('warn', 80)),
      row(t('leaveCounts'), t('leaveCountsDesc'), toggle('leaveCounts')), row(t('lateCounts'), t('lateCountsDesc'), toggle('lateCounts')),
      row(t('navSemesters'), t('manageSemDesc'), btn(t('manage'), { onclick: () => go('semesters') }))],
    appearance: () => [h('h2', {}, t('setAppearance')), row(t('theme'), t('themeDesc'), choice([['auto', t('auto')], ['light', t('light')], ['dark', t('dark')]], S.settings.theme, v => set('theme', v, true)))],
    data: () => [h('h2', {}, t('setData')), h('div', { class: 'notice info' }, icon('info', 18), h('span', {}, t('backupHint'))),
      row(t('downloadBackup'), `${t('lastBackup')}: ${S.settings.lastBackup ? new Date(S.settings.lastBackup).toLocaleString() : t('never')}`, [btn(t('download'), { v: 'primary', icon: 'download', onclick: () => { S.settings.lastBackup = Date.now(); save(); download(`gmc-backup-${today()}.json`, JSON.stringify(S), 'application/json'); toast(t('toastBackup')); render(); } }),
        navigator.canShare ? btn(t('share'), { icon: 'share', onclick: shareBackup }) : null]),
      row(t('restoreBackup'), t('restoreDesc'), [btn(t('restore'), { icon: 'upload', onclick: () => document.getElementById('restore').click() }),
        h('input', { type: 'file', id: 'restore', accept: '.json', hidden: true, onchange: e => { const f = e.target.files[0]; if (!f) return;
          f.text().then(tx => { try { const d = JSON.parse(tx); if (!Array.isArray(d.semesters)) throw 0; confirmDialog({ title: t('restoreBackup'), desc: t('confirmRestore'), confirm: t('restore'), danger: false, onConfirm: () => { loadError = null; S = migrate(d); save(); render(); toast(t('toastRestored')); } }); } catch (_) { toast(t('badFile'), 'error'); } }); } })]),
      row(t('resetAll'), t('resetAllDesc'), btn(t('reset'), { v: 'danger-ghost', icon: 'trash', onclick: () => confirmDialog({ title: t('resetAll'), desc: t('confirmReset'), confirm: t('reset'), onConfirm: () => { loadError = null; S = defaults(); save(); draft = null; go('dashboard'); render(); toast(t('toastReset')); } }) }))],
    about: () => [h('h2', {}, t('setAbout')), row('GMC Check-in', `${t('version')} ${VERSION}`, badge('neutral', 'v' + VERSION)),
      row(t('install'), t('installHint'), icon('phone', 20)), row(t('privacy'), t('privacyDesc'), icon('database', 20))]
  };
  const tabs = [['general', 'building', 'setGeneral'], ['academic', 'target', 'setAcademic'], ['appearance', 'palette', 'setAppearance'], ['data', 'database', 'setData'], ['about', 'info', 'setAbout']];
  return h('div', {}, pageHeader({ title: t('navSettings'), desc: t('settingsDesc') }),
    h('div', { class: 'settings' },
      h('nav', { class: 'set-nav', 'aria-label': t('navSettings') }, tabs.map(([k, ic, key]) => h('button', { class: V.set === k ? 'on' : '', 'aria-current': V.set === k ? 'page' : null, onclick: () => { V.set = k; render(); } }, icon(ic, 18), h('span', {}, t(key))))),
      h('section', { class: 'card set-panel' }, sections[V.set]())));
}

/* =========================================================
   RENDER
   ========================================================= */
function applyPrefs() {
  document.documentElement.lang = lang();
  document.documentElement.dir = lang() === 'ur' ? 'rtl' : 'ltr';
  document.documentElement.dataset.theme = S.settings.theme;
  if (lang() === 'ur' && !document.getElementById('urdu-font')) document.head.append(h('link', { id: 'urdu-font', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap' }));
}

function recoveryScreen() {
  const blocked = loadError === 'blocked';
  return h('div', { class: 'recovery' }, h('div', { class: 'card' }, errorState(blocked ? t('errBlockedTitle') : t('errCorruptTitle'), blocked ? t('errBlockedDesc') : t('errCorruptDesc'), () => location.reload()),
    !blocked ? h('div', { class: 'empty-actions center' }, btn(t('startFresh'), { v: 'danger-ghost', onclick: () => { loadError = null; S = defaults(); save(); render(); } })) : null));
}

const TITLES = { dashboard: 'navDashboard', students: 'navStudents', attendance: 'navAttendance', semesters: 'navSemesters', reports: 'navReports', settings: 'navSettings' };
let newPage = true;
function render() {
  applyPrefs();
  const app = document.getElementById('app'); const r = route();
  try {
    if (loadError) { app.replaceChildren(recoveryScreen()); return; }
    let page;
    switch (r.name) {
      case 'students': page = pageStudents(r); break;
      case 'attendance': page = r.parts[2] === 'mark' ? pageMark(r) : r.parts[1] ? pageSubject(r.parts[1]) : pageAttendance(); break;
      case 'semesters': page = pageSemesters(); break;
      case 'reports': page = pageReports(); break;
      case 'settings': page = pageSettings(); break;
      default: page = pageDashboard();
    }
    const keep = window.scrollY;
    app.replaceChildren(shell(page, TITLES[r.name] ? r.name : 'dashboard'));
    document.title = (t(TITLES[r.name] || 'navDashboard')) + ' · GMC Check-in';
    window.scrollTo(0, newPage ? 0 : keep); newPage = false;
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('div', { class: 'recovery' }, h('div', { class: 'card' }, errorState(t('errGenericTitle'), t('errGenericDesc'), () => { go('dashboard'); render(); }))));
  }
}
window.addEventListener('hashchange', () => { newPage = true; render(); });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const c = isCollapsed(); const sh = document.querySelector('.shell'); if (sh && String(c) !== sh.dataset.collapsed) render(); }, 150); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
render();
