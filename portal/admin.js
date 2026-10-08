/* Admin pages: overview, academic structure, students (import + logins), users, audit log, settings. */
'use strict';
const nz = x => (x === '' || x === undefined ? null : x);
const toInt = x => (x === '' || x === undefined || x === null ? null : parseInt(x, 10));
const tabsBar = (items, cur, onPick) => h('div', { class: 'tabs', role: 'tablist' }, items.map(([k, l]) => h('button', { role: 'tab', class: k === cur ? 'on' : '', 'aria-selected': String(k === cur), onclick: () => onPick(k) }, l)));

/** Minimal CSV parser (quotes, commas, CRLF, BOM). Returns array of rows. */
function parseCsv(text) {
  text = text.replace(/^﻿/, ''); const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
async function readTable(file) {
  const rows = /\.xlsx$/i.test(file.name) ? await XLSX.read(await file.arrayBuffer()) : parseCsv(await file.text());
  if (!rows.length) return [];
  const head = rows[0].map(x => String(x).trim().toLowerCase());
  const hasHead = head.some(x => /roll|name|phone|section/.test(x));
  const idx = (re, dflt) => { const i = head.findIndex(x => re.test(x)); return hasHead ? i : dflt; };
  const iR = idx(/roll|reg/, 0), iN = idx(/name/, 1), iP = idx(/phone|mobile|cell/, 2);
  return (hasHead ? rows.slice(1) : rows).map(r => ({ roll: String(r[iR] ?? '').trim(), name: String(r[iN] ?? '').trim(), phone: nz(String(r[iP] ?? '').trim()) }));
}
const csvOut = (head, rows) => '﻿' + [head, ...rows].map(r => r.map(c => { const s = String(c ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
function saveFile(name, text, type = 'text/csv;charset=utf-8') { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); }

/** Shows generated passwords exactly once: copy, CSV download, print. */
function credentialsDialog(title, creds, cols = ['roll', 'name', 'login', 'password']) {
  const labels = { roll: t('roll'), name: t('name'), login: t('loginId'), password: t('password'), email: t('email') };
  const table = h('div', { class: 'table-wrap printable' }, h('table', { class: 'table cred-table' }, h('thead', {}, h('tr', {}, cols.map(c => h('th', {}, labels[c] || c)))),
    h('tbody', {}, creds.map(r => h('tr', {}, cols.map(c => h('td', { class: c === 'password' ? 'pw' : '' }, r[c])))))));
  const d = sheetDialog(title, h('div', {}, h('p', { class: 'sub' }, t('oneTimePwDesc')),
    h('div', { class: 'pill-row' }, btn(t('downloadCsv'), { icon: 'download', onclick: () => saveFile('credentials.csv', csvOut(cols.map(c => labels[c] || c), creds.map(r => cols.map(c => r[c])))) }), btn(t('print'), { onclick: () => window.print() })),
    h('div', { style: 'max-height:50vh;overflow:auto' }, table)));
  return d;
}

route('/admin', ['admin'], async () => {
  const s = await api('GET', '/api/admin/stats');
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: t('adminHome') }));
  out.append(h('div', { class: 'stats' },
    statCard({ label: t('usersN'), value: num(s.users), iconName: 'user' }), statCard({ label: t('studentsN'), value: num(s.students), iconName: 'users' }),
    statCard({ label: t('offeringsN'), value: num(s.offerings), iconName: 'book' }), statCard({ label: t('sessionsN'), value: num(s.sessions), iconName: 'calendar' }),
    statCard({ label: t('recordsN'), value: num(s.attendance), iconName: 'database' }), statCard({ label: t('pushSubs'), value: num(s.push_subs), iconName: 'message' })));
  const backupBtn = btn(t('runBackup'), { icon: 'archive', disabled: !s.backup_configured, onclick: async () => { try { await api('POST', '/api/admin/backup', {}); toast(t('backupDone')); render(); } catch (e) { toast(e.message, 'error'); } } });
  out.append(h('section', { class: 'card' }, h('h2', {}, t('lastBackup')), h('p', {}, s.last_backup ? fmtTime(s.last_backup) : t('never')),
    s.db_bytes ? h('p', { class: 'sub' }, `${t('dbSize')}: ${num((s.db_bytes / 1048576).toFixed(1))} MB`) : null, s.backup_configured ? null : h('p', { class: 'sub' }, t('noBackupDir')), backupBtn));
  return out;
});

/* ---------- structure ---------- */
route('/admin/structure', ['admin'], async q => {
  const tab = q.get('tab') || 'departments';
  const [departments, programs, terms, sections, courses, offerings, teachers] = await Promise.all(['departments', 'programs', 'terms', 'sections', 'courses', 'offerings'].map(k => api('GET', '/api/admin/' + k)).concat(api('GET', '/api/admin/users?role=teacher&limit=500')));
  const opt = (arr, f) => arr.map(x => ({ value: x.id, label: f(x) }));
  const D = opt(departments, x => `${x.code} · ${x.name}`), PR = opt(programs, x => `${x.code} · ${x.name}`), TM = opt(terms, x => x.name), SC = opt(sections, x => `${x.name}`), CO = opt(courses, x => `${x.code} · ${x.name}`), TE = [{ value: '', label: '—' }, ...opt(teachers.items, x => x.name)];
  const nameOf = (arr, id) => { const x = arr.find(a => a.id === id); return x ? (x.code ? x.code : x.name) : '—'; };
  const SPEC = {
    departments: { rows: departments, f: [{ key: 'code', label: t('code'), required: true }, { key: 'name', label: t('name'), required: true }], cols: [[t('code'), r => r.code], [t('name'), r => r.name]] },
    programs: { rows: programs, f: [{ key: 'dept_id', label: t('dept'), type: 'select', options: D, int: 1 }, { key: 'code', label: t('code'), required: true }, { key: 'name', label: t('name'), required: true }], cols: [[t('code'), r => r.code], [t('name'), r => r.name], [t('dept'), r => nameOf(departments, r.dept_id)]] },
    terms: { rows: terms, f: [{ key: 'name', label: t('name'), required: true }, { key: 'starts', label: t('starts'), type: 'date' }, { key: 'ends', label: t('ends'), type: 'date' }, { key: 'active', label: t('active'), type: 'select', options: [{ value: 1, label: t('active') }, { value: 0, label: '—' }], int: 1 }], cols: [[t('name'), r => r.name], [t('starts'), r => fmtDate(r.starts)], [t('ends'), r => fmtDate(r.ends)], [t('active'), r => (r.active ? '✓' : '')]] },
    sections: { rows: sections, f: [{ key: 'program_id', label: t('program'), type: 'select', options: PR, int: 1 }, { key: 'term_id', label: t('term'), type: 'select', options: TM, int: 1 }, { key: 'name', label: t('name'), required: true }, { key: 'semester_no', label: t('semNo'), type: 'number', min: 1, max: 14, int: 1 }], cols: [[t('name'), r => r.name], [t('program'), r => nameOf(programs, r.program_id)], [t('term'), r => nameOf(terms, r.term_id)], [t('semNo'), r => (r.semester_no ? num(r.semester_no) : '—')]] },
    courses: { rows: courses, f: [{ key: 'dept_id', label: t('dept'), type: 'select', options: D, int: 1 }, { key: 'code', label: t('code'), required: true }, { key: 'name', label: t('name'), required: true }, { key: 'credits', label: t('credits'), type: 'number', min: 0, max: 20, int: 1 }], cols: [[t('code'), r => r.code], [t('name'), r => r.name], [t('dept'), r => nameOf(departments, r.dept_id)], [t('credits'), r => (r.credits ?? '—')]] },
    offerings: { rows: offerings, f: [{ key: 'course_id', label: t('course'), type: 'select', options: CO, int: 1 }, { key: 'section_id', label: t('section'), type: 'select', options: SC, int: 1 }, { key: 'teacher_id', label: t('teacher'), type: 'select', options: TE, int: 1 }, { key: 'min_pct', label: t('minPct'), type: 'number', min: 1, max: 99, int: 1 }, { key: 'room', label: t('room') }, { key: 'days', label: t('days'), type: 'days' }, { key: 'start_time', label: t('startTime'), type: 'time' }],
      cols: [[t('course'), r => `${r.course_code}`], [t('section'), r => r.section_name], [t('teacher'), r => r.teacher_name || '—'], [t('enrolled'), r => num(r.enrolled)]] }
  };
  const spec = SPEC[tab], path = '/api/admin/' + tab;
  const body = vals => Object.fromEntries(spec.f.map(f => [f.key, f.key === 'active' ? +vals[f.key] : f.int ? toInt(vals[f.key]) : nz(vals[f.key])]));
  const dlg = row => formDialog({ title: row ? t('edit') : t('add'), fields: spec.f.map(f => ({ ...f, value: row ? row[f.key] : f.key === 'active' ? 1 : undefined })),
    onSubmit: vals => { (row ? api('PUT', `${path}/${row.id}`, body(vals)) : api('POST', path, body(vals))).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } });
  const del = row => confirmDialog({ title: t('del'), desc: t('confirmDel'), onConfirm: () => api('DELETE', `${path}/${row.id}`).then(() => { toast(t('deleted')); render(); }).catch(e => toast(e.status === 409 ? t('inUse') : e.message, 'error')) });
  const labels = { departments: t('departments'), programs: t('programs'), terms: t('terms'), sections: t('sections'), courses: t('coursesT'), offerings: t('offerings') };
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: t('structure'), actions: btn(t('add'), { v: 'primary', icon: 'plus', onclick: () => dlg(null) }) }),
    tabsBar(Object.keys(SPEC).map(k => [k, labels[k]]), tab, k => go('/admin/structure?tab=' + k)));
  out.append(spec.rows.length ? dataTable({ cols: [...spec.cols.map(([label, render]) => ({ label, render })), { label: '', render: r => h('span', { class: 'row-actions' }, iconBtn('edit', t('edit'), () => dlg(r)), iconBtn('trash', t('del'), () => del(r))) }], rows: spec.rows.slice(0, 300) })
    : emptyState({ iconName: 'building', title: labels[tab], actions: btn(t('add'), { v: 'primary', onclick: () => dlg(null) }) }));
  return out;
});

/* ---------- students ---------- */
const PAGE = 50;
route('/admin/students', ['admin'], async q => {
  const page = +q.get('p') || 1, sec = q.get('section') || '', text = q.get('q') || '';
  const sections = await api('GET', '/api/admin/sections');
  const qs = new URLSearchParams({ limit: PAGE, offset: (page - 1) * PAGE }); if (sec) qs.set('section_id', sec); if (text) qs.set('q', text);
  const d = await api('GET', '/api/admin/students?' + qs);
  const secOpts = [{ value: '', label: t('allGroups') }, ...sections.map(s => ({ value: s.id, label: s.name }))];
  const nav = (o = {}) => { const n = new URLSearchParams({ p: 1, section: sec, q: text, ...o }); [...n].forEach(([k, v]) => { if (!v) n.delete(k); }); go('/admin/students?' + n); };
  const importDlg = () => {
    const file = h('input', { type: 'file', accept: '.csv,.xlsx,.txt', class: 'input', 'aria-label': t('chooseFile') });
    const status = h('p', { class: 'sub', 'aria-live': 'polite' });
    formDialog({ title: t('importStudents'), desc: t('chooseFile'), fields: [{ key: 'section_id', label: t('defaultSection'), type: 'select', options: [{ value: '', label: t('noSection') }, ...sections.map(s => ({ value: s.id, label: s.name }))] }, { custom: true, node: h('div', { class: 'field' }, file, status) }],
      onSubmit: vals => {
        if (!file.files[0]) { toast(t('chooseFile'), 'error'); return; }
        (async () => {
          const rows = (await readTable(file.files[0])); let c = 0, u = 0; const errs = [];
          for (let i = 0; i < rows.length; i += 2000) { const r = await apiPatient('POST', '/api/admin/import/students', { rows: rows.slice(i, i + 2000), section_id: toInt(vals.section_id) || undefined }); c += r.created; u += r.updated; r.errors.forEach(e => errs.push({ row: e.row + i, error: e.error })); }
          const d2 = sheetDialog(t('importResult'), h('div', {}, h('p', {}, `${t('created')}: ${num(c)} · ${t('updated')}: ${num(u)} · ${t('errors')}: ${num(errs.length)}`),
            errs.length ? h('ul', { class: 'plain-list' }, errs.slice(0, 30).map(e => h('li', {}, `#${num(e.row)}: ${e.error}`))) : null, btn(t('close'), { onclick: () => { d2.close(); render(); } })));
        })().catch(e => toast(e.message, 'error'));
      } });
  };
  const loginsDlg = () => formDialog({ title: t('createLogins'), desc: t('loginsHint'), fields: [{ key: 'section_id', label: t('section'), type: 'select', options: sections.map(s => ({ value: s.id, label: s.name })), required: true }],
    onSubmit: vals => { (async () => {
      let all = [], remaining = 1;
      while (remaining > 0) { const r = await apiPatient('POST', `/api/admin/sections/${vals.section_id}/create-logins`, {}); all = all.concat(r.credentials); remaining = r.created ? r.remaining : 0; }
      if (!all.length) { toast(t('noData'), 'info'); return; }
      const d3 = credentialsDialog(`${t('loginsDone')}: ${num(all.length)}`, all); d3.addEventListener('close', () => render());
    })().catch(e => toast(e.message, 'error')); } });
  const addDlg = () => formDialog({ title: t('addStudent'), fields: [{ key: 'roll', label: t('roll'), required: true }, { key: 'name', label: t('name'), required: true }, { key: 'phone', label: t('phone'), type: 'tel' }, { key: 'section_id', label: t('section'), type: 'select', options: [{ value: '', label: t('noSection') }, ...sections.map(s => ({ value: s.id, label: s.name }))] }],
    onSubmit: v => { api('POST', '/api/admin/students', { roll: v.roll, name: v.name, phone: nz(v.phone), section_id: toInt(v.section_id) }).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } });
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: t('studentsAdmin'), desc: `${num(d.total)}`, actions: [btn(t('importStudents'), { icon: 'upload', onclick: importDlg }), btn(t('createLogins'), { icon: 'user', onclick: loginsDlg }), btn(t('addStudent'), { v: 'primary', icon: 'plus', onclick: addDlg })] }),
    h('div', { class: 'toolbar' }, searchInput(text, t('searchStudents'), e => { clearTimeout(out._t); out._t = setTimeout(() => nav({ q: e.target.value }), 350); }), selectInput(sec, secOpts, v => nav({ section: v }), t('section'))));
  out.append(d.items.length ? dataTable({ cols: [{ label: t('roll'), render: r => r.roll }, { label: t('name'), render: r => r.name }, { label: t('section'), render: r => r.section_name || '—' }, { label: t('hasLogin'), render: r => (r.has_login ? '✓' : '—') },
    { label: t('status'), render: r => r.status }, { label: '', render: r => iconBtn('edit', t('edit'), () => formDialog({ title: t('edit'), fields: [{ key: 'name', label: t('name'), value: r.name, required: true }, { key: 'phone', label: t('phone'), value: r.phone || '' }, { key: 'section_id', label: t('section'), type: 'select', value: r.section_id ?? '', options: [{ value: '', label: t('noSection') }, ...sections.map(s => ({ value: s.id, label: s.name }))] }, { key: 'status', label: t('status'), type: 'select', value: r.status, options: ['active', 'left', 'frozen'].map(x => ({ value: x, label: x })) }],
      onSubmit: v => { api('PUT', `/api/admin/students/${r.id}`, { name: v.name, phone: nz(v.phone), section_id: toInt(v.section_id), status: v.status }).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } })) }], rows: d.items })
    : emptyState({ iconName: 'users', title: t('noData'), actions: btn(t('importStudents'), { v: 'primary', onclick: importDlg }) }), pager(d.total, page, PAGE, p => nav({ p })));
  return out;
});

/* ---------- users ---------- */
route('/admin/users', ['admin'], async q => {
  const page = +q.get('p') || 1, role = q.get('role') || '', text = q.get('q') || '';
  const [deps, d] = await Promise.all([api('GET', '/api/admin/departments'), api('GET', '/api/admin/users?' + new URLSearchParams({ limit: PAGE, offset: (page - 1) * PAGE, ...(role ? { role } : {}), ...(text ? { q: text } : {}) }))]);
  const nav = (o = {}) => { const n = new URLSearchParams({ p: 1, role, q: text, ...o }); [...n].forEach(([k, v]) => { if (!v) n.delete(k); }); go('/admin/users?' + n); };
  const roleOpts = ['admin', 'hod', 'teacher', 'student'].map(r => ({ value: r, label: r }));
  const deptOpts = [{ value: '', label: '—' }, ...deps.map(x => ({ value: x.id, label: x.name }))];
  const addDlg = () => formDialog({ title: t('addUser'), fields: [{ key: 'name', label: t('name'), required: true }, { key: 'email', label: t('email'), type: 'email', required: true }, { key: 'role', label: t('role'), type: 'select', options: roleOpts.filter(r => r.value !== 'student'), value: 'teacher' }, { key: 'dept_id', label: t('dept'), type: 'select', options: deptOpts }, { key: 'phone', label: t('phone'), type: 'tel' }],
    onSubmit: v => { api('POST', '/api/admin/users', { name: v.name, email: v.email, role: v.role, dept_id: toInt(v.dept_id), phone: nz(v.phone) }).then(r => { const dd = credentialsDialog(t('oneTimePw'), [{ name: r.user.name, email: r.user.email, password: r.password }], ['name', 'email', 'password']); dd.addEventListener('close', () => render()); }).catch(e => toast(e.message, 'error')); } });
  const reset = u => confirmDialog({ title: t('resetPw'), desc: u.name, confirm: t('resetPw'), danger: false, onConfirm: () => api('POST', `/api/admin/users/${u.id}/reset-password`, {}).then(r => credentialsDialog(t('oneTimePw'), [{ name: u.name, email: u.email, password: r.password }], ['name', 'email', 'password'])).catch(e => toast(e.message, 'error')) });
  const toggle = u => api('PUT', `/api/admin/users/${u.id}`, { active: !u.active }).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error'));
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: t('users'), desc: num(d.total), actions: btn(t('addUser'), { v: 'primary', icon: 'plus', onclick: addDlg }) }),
    h('div', { class: 'toolbar' }, searchInput(text, t('search'), e => { clearTimeout(out._t); out._t = setTimeout(() => nav({ q: e.target.value }), 350); }), selectInput(role, [{ value: '', label: t('allRoles') }, ...roleOpts], v => nav({ role: v }), t('role'))));
  out.append(dataTable({ cols: [{ label: t('name'), render: r => r.name }, { label: t('email'), render: r => r.email }, { label: t('role'), render: r => r.role }, { label: t('lastLogin'), render: r => (r.last_login ? fmtTime(r.last_login) : '—') }, { label: t('status'), render: r => (r.active ? badge('success', t('active')) : badge('neutral', '—')) },
    { label: '', render: r => h('span', { class: 'row-actions' }, btn(t('resetPw'), { size: 'sm', onclick: () => reset(r) }), r.id === P.user.id ? null : btn(r.active ? t('deactivate') : t('activate'), { size: 'sm', v: 'ghost', onclick: () => toggle(r) })) }], rows: d.items }), pager(d.total, page, PAGE, p => nav({ p })));
  return out;
});

/* ---------- audit ---------- */
route('/admin/audit', ['admin'], async q => {
  const action = q.get('action') || '';
  const first = await api('GET', '/api/admin/audit?limit=100' + (action ? '&action=' + encodeURIComponent(action) : ''));
  let items = first; const body = h('div', {});
  const draw = () => { body.replaceChildren(dataTable({ cols: [{ label: t('when'), render: r => fmtTime(r.ts) }, { label: t('who'), render: r => r.actor_name || r.actor_id || '—' }, { label: t('action'), render: r => r.action }, { label: t('detail'), render: r => h('code', { class: 'sub' }, [r.entity, r.entity_id, r.detail].filter(x => x !== null && x !== undefined && x !== '').join(' ').slice(0, 140)) }], rows: items }),
    items.length && items.length % 100 === 0 ? btn(t('loadMore'), { onclick: async () => { const more = await api('GET', `/api/admin/audit?limit=100&before=${items[items.length - 1].id}` + (action ? '&action=' + encodeURIComponent(action) : '')); items = items.concat(more); draw(); } }) : null); };
  draw();
  return h('div', { class: 'stack-page' }, pageHeader({ title: t('auditLog') }), body);
});

/* ---------- settings ---------- */
route('/admin/settings', ['admin'], async () => {
  const s = await api('GET', '/api/admin/settings'); const f = (k, label, type = 'number') => ({ key: k, label, type, value: s[k] });
  const inputs = {};
  const mk = (key, label, value, min, max) => { const el = h('input', { class: 'input', id: 's-' + key, type: 'number', min, max, value }); inputs[key] = el; return h('div', { class: 'field' }, h('label', { for: 's-' + key }, label), el); };
  const mkSel = (key, label, value) => { const el = h('select', { class: 'input', id: 's-' + key }, [['0', '—'], ['1', '✓']].map(([v, l]) => h('option', { value: v, selected: String(value) === v }, l))); inputs[key] = el; return h('div', { class: 'field' }, h('label', { for: 's-' + key }, label), el); };
  const save = btn(t('save'), { v: 'primary', type: 'submit', icon: 'save' });
  const form = h('form', { onsubmit: async e => { e.preventDefault(); save.disabled = true; try { await api('PUT', '/api/admin/settings', Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, +el.value]))); toast(t('saved')); } catch (ex) { toast(ex.message, 'error'); } save.disabled = false; } },
    mk('min_pct', t('minAtt'), s.min_pct, 1, 99), mk('warn_pct', t('warnAt'), s.warn_pct, 1, 100), mkSel('leave_counts', t('leaveCounts'), s.leave_counts), mkSel('late_counts', t('lateCounts'), s.late_counts), save);
  return h('div', { class: 'stack-page' }, pageHeader({ title: t('settingsTitle') }), h('section', { class: 'card', style: 'max-width:480px' }, form));
});
