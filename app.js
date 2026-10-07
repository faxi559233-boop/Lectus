/* Lectus Attendance - offline PWA, no dependencies */
'use strict';

const KEY = 'lectus-data-v1';
const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

/* ---------- state ---------- */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

function defaults() {
  return { v: 1, settings: { lang: 'en', theme: 'auto', min: 75, warn: 80, leaveCounts: true, lastBackup: null }, semesters: [], current: null };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = JSON.parse(raw); return Object.assign(defaults(), d, { settings: Object.assign(defaults().settings, d.settings) }); }
  } catch (e) { console.error(e); }
  return defaults();
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Storage full / blocked!'); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const sem = () => S.semesters.find(s => s.id === S.current) || null;
const subj = id => (sem() ? sem().subjects.find(x => x.id === id) : null);
const lang = () => S.settings.lang;
const t = k => (I18N[lang()] && I18N[lang()][k]) || I18N.en[k] || k;
const num = n => (lang() === 'ur' ? String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]) : String(n));

/* ---------- calculations ---------- */
function stats(subjectId, studentId) {
  const sessions = (sem().records[subjectId] || []);
  let total = 0, att = 0, a = 0, l = 0;
  for (const s of sessions) {
    const m = s.marks[studentId];
    if (!m) continue;
    total++;
    if (m === 'P') att++;
    else if (m === 'L') { l++; if (S.settings.leaveCounts) att++; }
    else a++;
  }
  return { total, att, a, l, pct: total ? (att / total) * 100 : null };
}
function status(pct) {
  if (pct === null) return 'none';
  if (pct < S.settings.min) return 'bad';
  if (pct < S.settings.warn) return 'warn';
  return 'ok';
}
const pctTxt = p => (p === null ? '—' : num(Math.round(p * 10) / 10) + '%');
function subjectAvg(subjectId) {
  const st = sem().students.map(s => stats(subjectId, s.id).pct).filter(p => p !== null);
  return st.length ? st.reduce((a, b) => a + b, 0) / st.length : null;
}
const colorFor = i => COLORS[i % COLORS.length];
const sortStudents = arr => arr.slice().sort((a, b) => String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true }));
const fmtDate = d => { const x = new Date(d + 'T00:00:00'); return x.toLocaleDateString(lang() === 'ur' ? 'ur-PK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' }); };

/* ---------- tiny DOM helper ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(k));
  }
  return el;
}
let toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- dialogs ---------- */
function dialog(title, bodyEls, buttons) {
  const d = document.getElementById('dlg');
  d.innerHTML = '';
  const close = () => d.close();
  d.append(h('h3', {}, title), ...[].concat(bodyEls || []).flat(Infinity),
    h('div', { class: 'btn-row' }, buttons.map(b => h('button', { class: 'btn ' + (b.cls || ''), onclick: () => { if (b.fn ? b.fn(close) !== false : true) close(); } }, b.label))));
  if (!d.open) d.showModal();
  const first = d.querySelector('input,textarea'); if (first) setTimeout(() => first.focus(), 50);
}
function confirmBox(msg, onYes) {
  dialog(t('delete') + '?', h('p', { class: 'muted' }, msg), [
    { label: t('cancel') }, { label: t('delete'), cls: 'danger', fn: () => { onYes(); } }]);
}
function field(label, props) { return [h('label', {}, label), h(props.tag || 'input', props)]; }

/* ---------- navigation ---------- */
let ui = { view: 'home', subjectId: null, draft: null, repSubject: 'all', search: '' };
function go(view, extra) { ui = Object.assign({}, ui, { view }, extra || {}); window.scrollTo(0, 0); render(); }

function applyPrefs() {
  document.documentElement.lang = lang();
  document.documentElement.dir = lang() === 'ur' ? 'rtl' : 'ltr';
  document.documentElement.dataset.theme = S.settings.theme;
}

function renderNav() {
  const nav = document.getElementById('nav');
  const hide = ui.view === 'take';
  nav.classList.toggle('hidden', hide);
  nav.innerHTML = '';
  const items = [['home', '🏠', 'home'], ['students', '👥', 'students'], ['reports', '📊', 'reports'], ['settings', '⚙️', 'settings']];
  const active = ui.view === 'subject' ? 'home' : ui.view;
  items.forEach(([v, ic, k]) => nav.append(h('button', { class: active === v ? 'on' : '', onclick: () => go(v) }, h('span', {}, ic), t(k))));
}

function render() {
  applyPrefs();
  const app = document.getElementById('app');
  app.innerHTML = '';
  const views = { home: vHome, subject: vSubject, take: vTake, students: vStudents, reports: vReports, settings: vSettings };
  app.append(views[ui.view]());
  renderNav();
}

/* ---------- shared bits ---------- */
function empty(icon, title, hint, actions) {
  return h('div', { class: 'empty' }, h('div', { class: 'big' }, icon), h('b', {}, title), h('div', {}, hint), actions ? h('div', { style: 'margin-top:18px' }, actions) : null);
}
function topbar(title, back) {
  return h('div', { class: 'topbar' }, back ? h('button', { class: 'iconbtn', onclick: back }, lang() === 'ur' ? '→' : '←') : null, h('h2', {}, title));
}
function needSemester() {
  return h('div', {}, topbar(t('appName')), empty('🎓', t('needSemester'), '', h('button', { class: 'btn primary', onclick: addSemester }, '+ ' + t('addSemester'))));
}
function semesterSelect() {
  const sel = h('select', { onchange: e => { S.current = e.target.value; save(); render(); } },
    S.semesters.map(s => h('option', { value: s.id, selected: s.id === S.current }, s.name)));
  return sel;
}

/* ---------- semester ---------- */
function addSemester() {
  dialog(t('addSemester'), field(t('semName'), { tag: 'input', id: 'sn', placeholder: t('semPlaceholder') }), [
    { label: t('cancel') },
    { label: t('add'), cls: 'primary', fn: () => {
      const v = document.getElementById('sn').value.trim(); if (!v) return false;
      const s = { id: uid(), name: v, students: [], subjects: [], records: {} };
      S.semesters.push(s); S.current = s.id; save(); render(); toast(t('added'));
    } }]);
}
function renameSemester() {
  dialog(t('renameSemester'), field(t('semName'), { id: 'sn', value: sem().name }), [
    { label: t('cancel') }, { label: t('save'), cls: 'primary', fn: () => {
      const v = document.getElementById('sn').value.trim(); if (!v) return false;
      sem().name = v; save(); render();
    } }]);
}
function deleteSemester() {
  confirmBox(t('confirmDeleteSem'), () => {
    S.semesters = S.semesters.filter(s => s.id !== S.current);
    S.current = S.semesters[0] ? S.semesters[0].id : null; save(); render(); toast(t('deleted'));
  });
}

/* ---------- HOME ---------- */
function vHome() {
  const s = sem();
  if (!s) return needSemester();
  const sessionsTotal = Object.values(s.records).reduce((a, r) => a + r.length, 0);
  const root = h('div', {});
  root.append(h('div', { class: 'hero' },
    h('div', { class: 'row' }, h('div', {}, h('small', {}, t('hello')), h('h1', {}, t('appName') + ' · ' + t('attendanceReport').split(' ')[0])), semesterSelect()),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, num(s.subjects.length)), h('span', {}, t('subjects'))),
      h('div', { class: 'stat' }, h('b', {}, num(s.students.length)), h('span', {}, t('students'))),
      h('div', { class: 'stat' }, h('b', {}, num(sessionsTotal)), h('span', {}, t('lectures'))))));
  root.append(h('div', { class: 'section-title' }, h('h3', {}, t('subjects')), h('span', { class: 'muted' }, t('quick'))));
  if (!s.subjects.length) root.append(empty('📚', t('noSubjects'), t('noSubjectsHint')));
  s.subjects.forEach((sj, i) => {
    const avg = subjectAvg(sj.id); const st = status(avg);
    const n = (s.records[sj.id] || []).length;
    root.append(h('div', { class: 'card', onclick: () => go('subject', { subjectId: sj.id }), style: 'cursor:pointer' },
      h('div', { class: 'subj' },
        h('div', { class: 'badge', style: 'background:' + colorFor(i) }, (sj.code || sj.name).slice(0, 3).toUpperCase()),
        h('div', { class: 'info' }, h('b', {}, sj.name), h('span', {}, num(n) + ' ' + t('lecturesTaken') + (sj.teacher ? ' · ' + sj.teacher : ''))),
        h('div', { class: 'ring', style: `--p:${avg === null ? 0 : avg};--c:var(--${st === 'bad' ? 'bad' : st === 'warn' ? 'warn' : 'ok'})` }, h('i', {}, avg === null ? '—' : num(Math.round(avg)) + '%'))),
      h('button', { class: 'takebtn', style: 'width:100%;margin-top:12px', onclick: e => { e.stopPropagation(); startTake(sj.id); } }, '✓ ' + t('takeAttendance'))));
  });
  root.append(h('button', { class: 'fab', onclick: () => subjectForm() }, '+'));
  return root;
}

function subjectForm(sj) {
  dialog(sj ? t('editSubject') : t('addSubject'), [
    field(t('subjectName'), { id: 'f1', value: sj ? sj.name : '' }),
    field(t('subjectCode'), { id: 'f2', value: sj ? sj.code || '' : '' }),
    field(t('teacher'), { id: 'f3', value: sj ? sj.teacher || '' : '' })], [
    { label: t('cancel') }, { label: t('save'), cls: 'primary', fn: () => {
      const name = document.getElementById('f1').value.trim(); if (!name) return false;
      const code = document.getElementById('f2').value.trim(), teacher = document.getElementById('f3').value.trim();
      if (sj) Object.assign(sj, { name, code, teacher }); else { const n = { id: uid(), name, code, teacher }; sem().subjects.push(n); sem().records[n.id] = []; }
      save(); render(); toast(sj ? t('saved') : t('added'));
    } }]);
}

/* ---------- SUBJECT detail ---------- */
function vSubject() {
  const sj = subj(ui.subjectId);
  if (!sj) return vHome();
  const s = sem(); const sessions = (s.records[sj.id] || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const root = h('div', {}, topbar(sj.name, () => go('home')));
  root.append(h('div', { class: 'btn-row' },
    h('button', { class: 'btn primary', onclick: () => startTake(sj.id) }, '✓ ' + t('takeAttendance')),
    h('button', { class: 'btn', onclick: () => subjectForm(sj) }, '✏️ ' + t('edit')),
    h('button', { class: 'btn danger', onclick: () => confirmBox(t('confirmDeleteSubject'), () => { s.subjects = s.subjects.filter(x => x.id !== sj.id); delete s.records[sj.id]; save(); go('home'); toast(t('deleted')); }) }, '🗑')));
  root.append(h('div', { class: 'section-title' }, h('h3', {}, t('students')), h('span', { class: 'muted' }, t('percent'))));
  if (!s.students.length) root.append(empty('👥', t('noStudents'), t('needStudents')));
  sortStudents(s.students).forEach(stu => {
    const x = stats(sj.id, stu.id); const st = status(x.pct);
    root.append(h('div', { class: 'card stu' },
      h('div', { class: 'no' }, stu.roll),
      h('div', { class: 'nm' }, stu.name, h('small', {}, `${num(x.att)}/${num(x.total)} ${t('attended')}`),
        h('div', { class: 'bar' }, h('i', { style: `width:${x.pct || 0}%;background:var(--${st === 'bad' ? 'bad' : st === 'warn' ? 'warn' : 'ok'})` }))),
      h('span', { class: 'pill ' + (st === 'none' ? '' : st) }, pctTxt(x.pct))));
  });
  root.append(h('div', { class: 'section-title' }, h('h3', {}, t('pastSessions'))));
  if (!sessions.length) root.append(h('p', { class: 'muted' }, t('noSessions')));
  sessions.forEach(se => {
    const vals = Object.values(se.marks); const p = vals.filter(v => v === 'P').length;
    root.append(h('div', { class: 'card list-item', onclick: () => startTake(sj.id, se.id) },
      h('div', { class: 'grow' }, h('b', {}, fmtDate(se.date)), h('div', { class: 'muted' }, `${t('present')} ${num(p)} · ${t('absent')} ${num(vals.filter(v => v === 'A').length)} · ${t('leave')} ${num(vals.filter(v => v === 'L').length)}`)),
      h('span', { class: 'pill ok' }, num(p) + '/' + num(vals.length)),
      h('button', { class: 'iconbtn', onclick: e => { e.stopPropagation(); confirmBox(t('confirmDelete'), () => { s.records[sj.id] = s.records[sj.id].filter(x => x.id !== se.id); save(); render(); toast(t('deleted')); }); } }, '🗑')));
  });
  return root;
}

/* ---------- TAKE attendance ---------- */
function startTake(subjectId, sessionId) {
  const s = sem();
  if (!s.students.length) { toast(t('needStudents')); go('students'); return; }
  let draft;
  if (sessionId) {
    const se = s.records[subjectId].find(x => x.id === sessionId);
    draft = { subjectId, sessionId, date: se.date, marks: Object.assign({}, se.marks) };
  } else {
    draft = { subjectId, sessionId: null, date: today(), marks: {} };
    s.students.forEach(st => { draft.marks[st.id] = null; });
  }
  go('take', { subjectId, draft });
}
function vTake() {
  const d = ui.draft, s = sem(), sj = subj(d.subjectId);
  const students = sortStudents(s.students);
  const counts = () => { const c = { P: 0, A: 0, L: 0, U: 0 }; students.forEach(x => { const m = d.marks[x.id]; c[m || 'U']++; }); return c; };
  const root = h('div', {}, topbar(sj.name, () => go('subject', { subjectId: sj.id })));
  const cEl = h('div', { class: 'counter' });
  const list = h('div', {});
  const paintCounts = () => {
    const c = counts(); cEl.innerHTML = '';
    cEl.append(h('div', { class: 'c-p' }, h('b', {}, num(c.P)), t('present')), h('div', { class: 'c-a' }, h('b', {}, num(c.A)), t('absent')),
      h('div', { class: 'c-l' }, h('b', {}, num(c.L)), t('leave')), h('div', { class: 'c-u' }, h('b', {}, num(c.U)), t('unmarked')));
  };
  const paintRows = () => {
    list.innerHTML = '';
    const q = ui.search.trim().toLowerCase();
    students.filter(x => !q || (x.name + ' ' + x.roll).toLowerCase().includes(q)).forEach(stu => {
      const seg = h('div', { class: 'seg' });
      ['P', 'A', 'L'].forEach(k => seg.append(h('button', { class: k + (d.marks[stu.id] === k ? ' on' : ''), 'aria-label': t({ P: 'present', A: 'absent', L: 'leave' }[k]), onclick: () => {
        d.marks[stu.id] = d.marks[stu.id] === k ? null : k;
        [...seg.children].forEach(b => b.classList.toggle('on', b.classList.contains(d.marks[stu.id] || '-')));
        paintCounts();
        if (navigator.vibrate) navigator.vibrate(8);
      } }, t(k))));
      list.append(h('div', { class: 'card stu' }, h('div', { class: 'no' }, stu.roll), h('div', { class: 'nm' }, stu.name), seg));
    });
  };
  const bulk = v => { students.forEach(x => { d.marks[x.id] = v; }); paintRows(); paintCounts(); };
  root.append(h('div', { class: 'att-head' },
    h('div', { class: 'fields' }, h('input', { type: 'date', value: d.date, onchange: e => { d.date = e.target.value; } }),
      h('input', { type: 'search', placeholder: t('search'), value: ui.search, oninput: e => { ui.search = e.target.value; paintRows(); } })),
    cEl,
    h('div', { class: 'chips' }, h('button', { class: 'chip', onclick: () => bulk('P') }, '✅ ' + t('allPresent')), h('button', { class: 'chip', onclick: () => bulk('A') }, '❌ ' + t('allAbsent')), h('button', { class: 'chip', onclick: () => bulk(null) }, '↺ ' + t('clear')))));
  root.append(list);
  const doSave = () => {
    const marks = {}; students.forEach(x => { if (d.marks[x.id]) marks[x.id] = d.marks[x.id]; });
    const arr = s.records[d.subjectId] = s.records[d.subjectId] || [];
    if (d.sessionId) { const se = arr.find(x => x.id === d.sessionId); se.date = d.date; se.marks = marks; }
    else arr.push({ id: uid(), date: d.date, marks });
    save(); ui.search = ''; go('subject', { subjectId: d.subjectId }); toast(t('saved'));
  };
  root.append(h('div', { class: 'savebar' }, h('button', { class: 'btn primary', onclick: () => {
    const c = counts();
    if (c.U > 0) dialog(t('unmarked') + ': ' + num(c.U), h('p', { class: 'muted' }, t('markAll')), [{ label: t('cancel') }, { label: t('saveAnyway'), cls: 'primary', fn: () => { doSave(); } }]);
    else doSave();
  } }, '💾 ' + t('save'))));
  paintRows(); paintCounts();
  return root;
}

/* ---------- STUDENTS ---------- */
function vStudents() {
  const s = sem(); if (!s) return needSemester();
  const root = h('div', {}, topbar(t('students') + ' (' + num(s.students.length) + ')'));
  root.append(h('div', { class: 'btn-row' },
    h('button', { class: 'btn primary', onclick: () => studentForm() }, '+ ' + t('addStudent')),
    h('button', { class: 'btn', onclick: importForm }, '⬆ ' + t('importStudents'))));
  root.append(h('div', { style: 'margin-top:12px' }, h('input', { type: 'search', placeholder: t('search'), value: ui.search, oninput: e => { ui.search = e.target.value; paint(); } })));
  const list = h('div', { style: 'margin-top:12px' });
  const paint = () => {
    list.innerHTML = '';
    const q = ui.search.trim().toLowerCase();
    const arr = sortStudents(s.students).filter(x => !q || (x.name + ' ' + x.roll).toLowerCase().includes(q));
    if (!arr.length) list.append(empty('👥', t('noStudents'), t('noStudentsHint')));
    arr.forEach(stu => list.append(h('div', { class: 'card stu', onclick: () => studentForm(stu) }, h('div', { class: 'no' }, stu.roll), h('div', { class: 'nm' }, stu.name), h('span', { class: 'muted' }, '✏️'))));
  };
  root.append(list); paint();
  return root;
}
function studentForm(stu) {
  dialog(stu ? t('editStudent') : t('addStudent'), [field(t('rollNo'), { id: 'f1', value: stu ? stu.roll : '' }), field(t('name'), { id: 'f2', value: stu ? stu.name : '' })], [
    { label: t('cancel') },
    stu ? { label: t('delete'), cls: 'danger', fn: close => { confirmBox(t('confirmDeleteStudent'), () => { const s = sem(); s.students = s.students.filter(x => x.id !== stu.id); Object.values(s.records).forEach(r => r.forEach(se => delete se.marks[stu.id])); save(); render(); toast(t('deleted')); }); return false; } } : null,
    { label: t('save'), cls: 'primary', fn: () => {
      const roll = document.getElementById('f1').value.trim(), name = document.getElementById('f2').value.trim();
      if (!roll || !name) return false;
      if (stu) Object.assign(stu, { roll, name }); else sem().students.push({ id: uid(), roll, name });
      save(); render(); toast(t('saved'));
    } }].filter(Boolean));
}
function parseList(text) {
  const out = [];
  text.split(/\r?\n/).forEach(line => {
    line = line.trim(); if (!line) return;
    const m = line.match(/^"?([^,;\t"]+)"?\s*[,;\t]\s*"?(.+?)"?$/) || line.match(/^(\S+)\s+(.+)$/);
    if (m && !/^(roll|reg|s\.?no)/i.test(m[1])) out.push({ id: uid(), roll: m[1].trim(), name: m[2].trim() });
  });
  return out;
}
function importForm() {
  const ta = h('textarea', { id: 'imp', placeholder: '1, Ali Khan\n2, Sara Ahmed\n3, Usman Tariq' });
  const file = h('input', { type: 'file', accept: '.csv,.txt', onchange: e => { const f = e.target.files[0]; if (f) f.text().then(tx => { ta.value = tx; }); } });
  dialog(t('importStudents'), [h('p', { class: 'muted' }, t('importHelp')), ta, h('label', {}, t('loadFile')), file], [
    { label: t('cancel') }, { label: t('importBtn'), cls: 'primary', fn: () => {
      const arr = parseList(ta.value); if (!arr.length) return false;
      const have = new Set(sem().students.map(x => x.roll));
      const add = arr.filter(x => !have.has(x.roll)); sem().students.push(...add); save(); render(); toast(num(add.length) + ' ' + t('imported'));
    } }]);
}

/* ---------- REPORTS ---------- */
function reportRows(subjectId) {
  return sortStudents(sem().students).map(stu => ({ stu, x: stats(subjectId, stu.id) }));
}
function vReports() {
  const s = sem(); if (!s) return needSemester();
  const root = h('div', {}, topbar(t('reports')));
  if (!s.subjects.length) { root.append(empty('📊', t('noSubjects'), t('noSubjectsHint'))); return root; }
  if (ui.repSubject === 'all' || !subj(ui.repSubject)) ui.repSubject = s.subjects[0].id;
  const sj = subj(ui.repSubject);
  root.append(h('select', { onchange: e => { ui.repSubject = e.target.value; render(); } }, s.subjects.map(x => h('option', { value: x.id, selected: x.id === sj.id }, x.name))));
  const rows = reportRows(sj.id); const short = rows.filter(r => status(r.x.pct) === 'bad');
  const nSess = (s.records[sj.id] || []).length;
  root.append(h('div', { class: 'section-title' }, h('h3', {}, '⚠ ' + t('shortageList')), h('span', { class: 'pill bad' }, num(short.length))));
  if (!nSess) root.append(h('p', { class: 'muted' }, t('noSessions')));
  else if (!short.length) root.append(h('div', { class: 'card' }, t('noShortage')));
  else short.forEach(r => root.append(h('div', { class: 'card stu' }, h('div', { class: 'no' }, r.stu.roll), h('div', { class: 'nm' }, r.stu.name, h('small', {}, `${num(r.x.att)}/${num(r.x.total)} · ${t('min')} ${num(S.settings.min)}%`)), h('span', { class: 'pill bad' }, pctTxt(r.x.pct)))));
  root.append(h('div', { class: 'section-title' }, h('h3', {}, '📤 ' + t('reports'))));
  root.append(h('div', { class: 'btn-row' },
    h('button', { class: 'btn primary', onclick: () => printRegister(sj) }, '📄 ' + t('exportPdf')),
    h('button', { class: 'btn', onclick: () => exportCsv(sj) }, '📗 ' + t('exportCsv')),
    h('button', { class: 'btn', onclick: () => shareWa(sj) }, '💬 ' + t('shareWa')),
    h('button', { class: 'btn', onclick: exportAllCsv }, '🗂 ' + t('exportAll'))));
  root.append(h('div', { class: 'section-title' }, h('h3', {}, t('percent'))));
  root.append(h('div', { class: 'card tbl-wrap' }, h('table', { class: 'rep' },
    h('thead', {}, h('tr', {}, h('th', {}, t('rollNo')), h('th', {}, t('name')), h('th', {}, t('attended')), h('th', {}, '%'))),
    h('tbody', {}, rows.map(r => h('tr', {}, h('td', {}, r.stu.roll), h('td', {}, r.stu.name), h('td', {}, `${num(r.x.att)}/${num(r.x.total)}`), h('td', {}, h('span', { class: 'pill ' + (status(r.x.pct) === 'none' ? '' : status(r.x.pct)) }, pctTxt(r.x.pct)))))))));
  return root;
}

function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const slug = x => x.replace(/[^\w؀-ۿ]+/g, '_');
function sessionsSorted(subjectId) { return (sem().records[subjectId] || []).slice().sort((a, b) => a.date.localeCompare(b.date)); }

function exportCsv(sj) {
  const ses = sessionsSorted(sj.id);
  const lines = [[t('rollNo'), t('name'), ...ses.map(x => x.date), t('attended'), 'Total', '%'].map(csvCell).join(',')];
  reportRows(sj.id).forEach(r => lines.push([r.stu.roll, r.stu.name, ...ses.map(se => se.marks[r.stu.id] || ''), r.x.att, r.x.total, r.x.pct === null ? '' : r.x.pct.toFixed(1)].map(csvCell).join(',')));
  download(`${slug(sem().name)}_${slug(sj.name)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}
function exportAllCsv() {
  const s = sem(); const subs = s.subjects;
  const lines = [[t('rollNo'), t('name'), ...subs.map(x => x.name + ' %')].map(csvCell).join(',')];
  sortStudents(s.students).forEach(stu => lines.push([stu.roll, stu.name, ...subs.map(sj => { const p = stats(sj.id, stu.id).pct; return p === null ? '' : p.toFixed(1); })].map(csvCell).join(',')));
  download(`${slug(s.name)}_all_subjects.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}
function shareWa(sj) {
  const rows = reportRows(sj.id); const short = rows.filter(r => status(r.x.pct) === 'bad');
  const n = (sem().records[sj.id] || []).length;
  let msg = `*${t('waTitle')}*\n${sem().name} · ${sj.name}\n${t('lectures')}: ${n} · ${t('students')}: ${rows.length}\n${t('min')}: ${S.settings.min}%\n\n`;
  msg += `*${t('shortageList')} (${short.length})*\n` + (short.length ? short.map(r => `${r.stu.roll} - ${r.stu.name}: ${r.x.pct.toFixed(1)}%`).join('\n') : t('noShortage'));
  msg += `\n\n*${t('percent')}*\n` + rows.map(r => `${r.stu.roll} ${r.stu.name}: ${r.x.pct === null ? '—' : r.x.pct.toFixed(0) + '%'}`).join('\n');
  if (navigator.share) navigator.share({ text: msg }).catch(() => {});
  else window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}
function printRegister(sj) {
  const ses = sessionsSorted(sj.id); const s = sem();
  const pa = document.getElementById('print-area'); pa.innerHTML = '';
  const symbol = { P: 'P', A: 'A', L: 'L' };
  pa.append(h('h1', {}, `${s.name} — ${sj.name}${sj.code ? ' (' + sj.code + ')' : ''}`),
    h('p', {}, `${sj.teacher ? t('teacherL') + ': ' + sj.teacher + ' · ' : ''}${t('lectures')}: ${ses.length} · ${t('min')}: ${S.settings.min}% · ${new Date().toLocaleDateString('en-GB')}`),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, t('rollNo')), h('th', {}, t('name')), ...ses.map(x => h('th', {}, x.date.slice(5).split('-').reverse().join('/'))), h('th', {}, t('attended')), h('th', {}, '%'))),
      h('tbody', {}, reportRows(sj.id).map(r => h('tr', { class: status(r.x.pct) === 'bad' ? 'short' : '' }, h('td', {}, r.stu.roll), h('td', { class: 'l' }, r.stu.name), ...ses.map(se => h('td', {}, symbol[se.marks[r.stu.id]] || '-')), h('td', {}, `${r.x.att}/${r.x.total}`), h('td', {}, r.x.pct === null ? '-' : r.x.pct.toFixed(0) + '%'))))),
    h('p', { style: 'margin-top:30px' }, t('signature') + ': ____________________'));
  setTimeout(() => window.print(), 100);
}

/* ---------- SETTINGS ---------- */
function vSettings() {
  const root = h('div', {}, topbar(t('settings')));
  const set = (k, v) => { S.settings[k] = v; save(); render(); };
  const seg = (opts, cur, fn) => h('div', { class: 'chips' }, opts.map(([v, l]) => h('button', { class: 'chip', style: cur === v ? 'background:var(--brand);color:#fff' : '', onclick: () => fn(v) }, l)));
  root.append(h('div', { class: 'card' }, h('b', {}, t('language')), seg([['en', 'English'], ['ur', 'اردو']], lang(), v => set('lang', v)),
    h('div', { style: 'margin-top:14px' }, h('b', {}, t('theme'))), seg([['auto', t('auto')], ['light', t('light')], ['dark', t('dark')]], S.settings.theme, v => set('theme', v))));
  root.append(h('div', { class: 'card' },
    h('div', { class: 'setting' }, h('span', {}, t('minAttendance')), h('input', { type: 'number', min: 0, max: 100, value: S.settings.min, onchange: e => { S.settings.min = Math.min(100, Math.max(0, +e.target.value || 75)); save(); } })),
    h('div', { class: 'setting' }, h('span', {}, t('warnAt')), h('input', { type: 'number', min: 0, max: 100, value: S.settings.warn, onchange: e => { S.settings.warn = Math.min(100, Math.max(0, +e.target.value || 80)); save(); } })),
    h('div', { class: 'setting' }, h('span', {}, t('leaveCounts')), h('label', { class: 'toggle', style: 'margin:0' }, h('input', { type: 'checkbox', checked: S.settings.leaveCounts, onchange: e => { S.settings.leaveCounts = e.target.checked; save(); } }), h('span', {})))));
  const sm = sem();
  if (sm) root.append(h('div', { class: 'card' }, h('b', {}, t('semester') + ': ' + sm.name),
    h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: addSemester }, '+ ' + t('addSemester')), h('button', { class: 'btn', onclick: renameSemester }, '✏️ ' + t('renameSemester')), h('button', { class: 'btn danger', onclick: deleteSemester }, '🗑 ' + t('deleteSemester')))));
  else root.append(h('div', { class: 'card' }, h('button', { class: 'btn primary block', onclick: addSemester }, '+ ' + t('addSemester'))));
  root.append(h('div', { class: 'card' }, h('b', {}, '💾 ' + t('backup')), h('p', { class: 'muted' }, t('backupHint')),
    h('p', { class: 'muted' }, t('lastBackup') + ': ' + (S.settings.lastBackup ? new Date(S.settings.lastBackup).toLocaleString() : t('never'))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => { S.settings.lastBackup = Date.now(); save(); download(`lectus-backup-${today()}.json`, JSON.stringify(S), 'application/json'); render(); } }, '⬇ ' + t('downloadBackup')),
      h('button', { class: 'btn', onclick: () => document.getElementById('restore').click() }, '⬆ ' + t('restoreBackup'))),
    h('input', { type: 'file', id: 'restore', accept: '.json', style: 'display:none', onchange: e => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then(tx => { try { const d = JSON.parse(tx); if (!d.semesters || !d.settings) throw 0; S = Object.assign(defaults(), d); save(); render(); toast(t('restored')); } catch (_) { toast(t('badFile')); } });
    } })));
  root.append(h('div', { class: 'card' }, h('b', {}, '📲 ' + t('install')), h('p', { class: 'muted' }, t('installHint'))));
  return root;
}

/* ---------- boot ---------- */
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
render();
