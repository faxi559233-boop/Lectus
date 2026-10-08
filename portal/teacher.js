/* Teacher / HOD pages: courses, lectures, roster marking (offline-safe), code check-in, department dashboard. */
'use strict';
const QKEY = 'gmc-queue';
const Q = {
  read() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; } },
  write(a) { try { localStorage.setItem(QKEY, JSON.stringify(a)); } catch { /* storage full or blocked */ } },
  add(item) { const a = Q.read().filter(x => x.session_id !== item.session_id); a.push(item); Q.write(a); },
  count() { return Q.read().length; },
  busy: false,
  /** Sends queued saves in order. Same op_id on retry, so the server never double-applies. */
  async flush() {
    if (Q.busy) return; Q.busy = true; let sent = 0;
    try {
      for (const item of Q.read()) {
        try { await api('PUT', `/api/sessions/${item.session_id}/marks`, { op_id: item.op_id, marks: item.marks }); Q.write(Q.read().filter(x => x.op_id !== item.op_id)); sent++; }
        catch (e) { if (e.network || e.status >= 500) break; if (e.status === 401) break; Q.write(Q.read().filter(x => x.op_id !== item.op_id)); toast(e.message, 'error'); }
      }
    } finally { Q.busy = false; }
    if (sent) document.dispatchEvent(new CustomEvent('gmc-synced'));
    return sent;
  }
};
window.addEventListener('online', () => Q.flush());
setInterval(() => { if (P.user && Q.count()) Q.flush(); }, 20000);

const cardGrid = (...k) => h('div', { class: 'grid-cards' }, ...k);
const waLink = (phone, text) => { let p = String(phone || '').replace(/[^\d]/g, ''); if (!p) return null; if (p.startsWith('0')) p = '92' + p.slice(1); return `https://wa.me/${p}?text=${encodeURIComponent(text)}`; };

route('/courses', ['teacher', 'hod', 'admin'], async () => {
  const list = await api('GET', '/api/my/offerings');
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: P.user.role === 'teacher' ? t('nCourses') : t('nAllCourses'), desc: t('coursesDesc') }));
  if (!list.length) { out.append(emptyState({ iconName: 'book', title: t('noLectures') })); return out; }
  out.append(cardGrid(list.map(o => h('a', { class: 'card course-card', href: `#/course/${o.id}` },
    h('div', { class: 'cc-top' }, h('b', {}, o.course_code), h('span', { class: 'sub' }, o.section_name)),
    h('h3', {}, o.course_name),
    h('p', { class: 'sub' }, o.teacher_name && P.user.role !== 'teacher' ? o.teacher_name + ' · ' : '', `${num(o.enrolled)} ${t('students_')} · ${num(o.lectures)} ${t('lecturesN')}`),
    h('p', { class: 'sub' }, `${t('lastLecture')}: ${fmtDate(o.last_date)}`)))));
  return out;
});

route('/course/:id', ['teacher', 'hod', 'admin'], async id => {
  const [s, sum] = await Promise.all([api('GET', `/api/offerings/${id}/sessions`), api('GET', `/api/offerings/${id}/summary`)]);
  const canEdit = P.user.role === 'teacher' || P.user.role === 'admin';
  const o = sum.offering;
  const newLecture = () => formDialog({ title: t('newLecture'), fields: [
    { key: 'date', label: t('lectureDate'), type: 'date', value: todayStr(), required: true }, { key: 'topic', label: t('topic') }],
    onSubmit: v => { api('POST', `/api/offerings/${id}/sessions`, { date: v.date, topic: v.topic || undefined }).then(r => go('/lecture/' + r.id)).catch(e => toast(e.message, 'error')); } });
  const remind = () => confirmDialog({ title: t('remindShort'), desc: tf('remindAsk', { n: num(sum.items.filter(i => i.status === 'bad').length) }), confirm: t('remindShort'), danger: false,
    onConfirm: () => api('POST', `/api/offerings/${id}/remind`, {}).then(r => toast(`${t('remindDone')}: ${num(r.sent)}`)).catch(e => toast(e.message, 'error')) });
  const out = h('div', { class: 'stack-page' }, pageHeader({ crumbs: [{ label: t('nCourses'), href: '#/courses' }, { label: o.course_code }], title: `${o.course_code} · ${o.course_name}`, desc: `${o.section_name} · ${t('minAtt')}: ${num(o.min)}%`,
    actions: canEdit ? [btn(t('remindShort'), { icon: 'message', onclick: remind }), btn(t('newLecture'), { v: 'primary', icon: 'plus', onclick: newLecture })] : null }));
  const tabs = h('div', { class: 'tabs', role: 'tablist' }); const panel = h('div', {});
  const lectures = () => s.sessions.length ? dataTable({ cols: [
    { label: t('lectureDate'), render: r => h('a', { href: `#/lecture/${r.id}` }, fmtDate(r.date)) }, { label: t('topic'), render: r => r.topic || '—' },
    { label: t('present'), render: r => `${num(r.present)} / ${num(r.marked)}` }, { label: '', render: r => h('a', { href: `#/lecture/${r.id}`, class: 'btn ghost sm' }, t('open')) }], rows: s.sessions })
    : emptyState({ iconName: 'calendar', title: t('noLectures'), desc: t('noLecturesDesc'), actions: canEdit ? btn(t('newLecture'), { v: 'primary', onclick: newLecture }) : null });
  const summary = () => dataTable({ cols: [
    { label: t('roll'), render: r => r.roll }, { label: t('name'), render: r => r.name },
    { label: t('attendanceRate'), render: r => h('span', { class: 'nowrap' }, pctTxt(r.pct), ' ', statusBadge(r.status)) },
    { label: t('outlookLbl'), render: r => outTxt(r.outlook) || '—' },
    { label: '', render: r => { const w = r.status === 'bad' ? waLink(r.phone, tf('waText', { name: r.name, course: o.course_code, pct: pctTxt(r.pct), min: num(o.min) })) : null; return w ? h('a', { href: w, target: '_blank', rel: 'noopener', class: 'btn ghost sm' }, t('whatsapp')) : null; } }], rows: sum.items });
  const show = k => { [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.k === k)); panel.replaceChildren(k === 'l' ? lectures() : summary()); };
  [['l', t('lectures')], ['s', t('students_')]].forEach(([k, l]) => tabs.append(h('button', { 'data-k': k, role: 'tab', onclick: () => show(k) }, l)));
  out.append(tabs, panel); show('l'); return out;
});

/* ---------- roster marking ---------- */
route('/lecture/:id', ['teacher', 'hod', 'admin'], async id => {
  const d = await api('GET', `/api/sessions/${id}`);
  const canEdit = P.user.role === 'teacher' || P.user.role === 'admin';
  const marks = new Map(d.roster.map(r => [r.id, r.status || null]));
  const dirty = new Set();
  const rows = new Map();
  const sync = h('span', { class: 'sync-badge sub', 'aria-live': 'polite' });
  const counter = h('p', { class: 'sub', 'aria-live': 'polite' });
  const updSync = () => { const n = Q.count(); sync.replaceChildren(n ? badge('warning', `${t('pending')} (${num(n)})`, 'clock') : badge('success', t('synced'), 'check')); };
  const updCount = () => { let p = 0, a = 0, l = 0, u = 0; for (const s of marks.values()) { if (s === 'P' || s === 'T') p++; else if (s === 'A') a++; else if (s === 'L') l++; else u++; } counter.textContent = `${t('present')}: ${num(p)} · ${t('absent')}: ${num(a)} · ${t('leave')}: ${num(l)} · ${t('unmarked')}: ${num(u)}`; };
  const paint = sid => { const r = rows.get(sid); if (!r) return; r.querySelectorAll('.seg button').forEach(b => { const on = b.dataset.s === marks.get(sid); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); };
  const set = (sid, s) => { marks.set(sid, s); dirty.add(sid); paint(sid); updCount(); };
  const SEG = [['P', 'present'], ['A', 'absent'], ['L', 'leave'], ['T', 'late']];
  const list = h('ul', { class: 'roster' }, d.roster.map(r => {
    const li = h('li', { 'data-roll': r.roll }, h('div', { class: 'who' }, h('b', {}, r.roll), ' ', h('span', {}, r.name), r.method === 'code' ? h('em', { class: 'sub' }, ' · code') : null),
      canEdit ? h('div', { class: 'seg', role: 'group', 'aria-label': r.name }, SEG.map(([k, lbl]) => h('button', { type: 'button', 'data-s': k, class: 'seg-btn ' + k, 'aria-pressed': 'false', 'aria-label': t(lbl), title: t(lbl), onclick: () => set(r.id, k) }, k))) : statusBadgeSimple(r.status));
    rows.set(r.id, li); return li;
  }));
  const save = async () => {
    const payload = [...dirty].map(sid => ({ student_id: sid, status: marks.get(sid) })).filter(m => m.status);
    if (!payload.length) { toast(t('saveOk')); return; }
    const item = { op_id: uid() + uid(), session_id: +id, marks: payload }; Q.add(item); dirty.clear(); updSync();
    const sent = await Q.flush(); updSync();
    toast(Q.count() ? t('saveOffline') : t('saveOk'), Q.count() ? 'info' : 'success');
  };
  const markAll = s => { d.roster.forEach(r => { if (!marks.get(r.id)) set(r.id, s); }); };
  const onSynced = () => { if (sync.isConnected) updSync(); else document.removeEventListener('gmc-synced', onSynced); };
  document.addEventListener('gmc-synced', onSynced);
  const out = h('div', { class: 'stack-page' }, pageHeader({ crumbs: [{ label: t('nCourses'), href: '#/courses' }, { label: d.offering.course_code, href: `#/course/${d.offering.id}` }, { label: fmtDate(d.session.date) }], title: `${d.offering.course_code} · ${fmtDate(d.session.date)}`, desc: d.session.topic || d.offering.course_name,
    actions: canEdit ? [btn(t('delLectureBtn'), { v: 'danger-ghost', icon: 'trash', onclick: () => confirmDialog({ title: t('del'), desc: t('deleteLecture'), onConfirm: () => api('DELETE', `/api/sessions/${id}`).then(() => go('/course/' + d.offering.id)).catch(e => toast(e.message, 'error')) }) })] : null }));
  if (canEdit) out.append(checkinPanel(id, () => render()));
  out.append(h('section', { class: 'card' }, h('div', { class: 'toolbar' }, counter, sync, h('span', { class: 'grow' }),
    canEdit ? [btn(`${t('present')} ⇢ ${t('unmarked')}`, { size: 'sm', onclick: () => markAll('P') }), btn(t('save'), { v: 'primary', icon: 'save', onclick: save })] : null), list));
  d.roster.forEach(r => paint(r.id)); updCount(); updSync();
  return out;
});
const statusBadgeSimple = s => (s ? badge(ST_TONE[s], t(ST_LABEL[s])) : badge('neutral', t('unmarked')));

/** Code check-in panel for the teacher: open (optionally geofenced), show the rotating code, close. */
function checkinPanel(sessionId, onChange) {
  const box = h('section', { class: 'card', 'aria-labelledby': 'cp-h' }); let timer = null;
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
  async function draw() {
    stop(); let st; try { st = await api('GET', `/api/sessions/${sessionId}/checkin`); } catch (e) { box.replaceChildren(h('p', { class: 'field-error' }, e.message)); return; }
    if (!box.isConnected && box.dataset.mounted) return; box.dataset.mounted = '1';
    if (!st.open) {
      box.replaceChildren(h('h2', { id: 'cp-h' }, t('codeCheckin')), h('p', { class: 'sub' }, t('checkinClosed')), btn(t('openCheckin'), { v: 'primary', icon: 'check', onclick: openDlg }));
      return;
    }
    const code = h('div', { class: 'code-box', 'aria-live': 'off' }, st.code), bar = h('i', {}), meter = h('div', { class: 'code-meter' }, bar), info = h('p', { class: 'sub' });
    const tick = ms => { bar.style.width = Math.max(0, Math.min(100, (ms / 30000) * 100)) + '%'; info.textContent = `${t('expiresIn')} ${num(Math.ceil(ms / 1000))}s · ${num(st.checked_in)} ${t('checkedInN')}`; };
    box.replaceChildren(h('h2', { id: 'cp-h' }, t('codeNow')), code, meter, info, btn(t('closeCheckin'), { v: 'danger-ghost', onclick: async () => { stop(); await api('POST', `/api/sessions/${sessionId}/checkin/close`, {}); onChange(); } }));
    let left = st.expires_in_ms; tick(left);
    const loop = async () => { if (!box.isConnected) return; left -= 1000; if (left <= 0) { draw(); return; } tick(left); if (!document.hidden && Math.round(left / 1000) % 5 === 0) { try { const s2 = await api('GET', `/api/sessions/${sessionId}/checkin`); if (s2.open) { st.checked_in = s2.checked_in; } } catch { /* ignore */ } } timer = setTimeout(loop, 1000); };
    timer = setTimeout(loop, 1000);
  }
  function openDlg() {
    const geo = h('input', { type: 'checkbox', id: 'cp-geo' });
    formDialog({ title: t('openCheckin'), fields: [{ key: 'minutes', label: t('minutes'), type: 'number', value: '10', min: 1, max: 60, required: true }, { key: 'radius', label: t('radius'), type: 'number', value: '150', min: 20, max: 5000 },
      { custom: true, node: h('label', { class: 'check' }, geo, ' ', t('useLocation')) }],
    onSubmit: async v => {
      try { const body = { minutes: +v.minutes, radius: +v.radius || 150 }; if (geo.checked) { toast(t('gettingLocation'), 'info'); Object.assign(body, await getPosition()); } await api('POST', `/api/sessions/${sessionId}/checkin/open`, body); draw(); }
      catch (e) { toast(e.message, 'error'); }
    } });
  }
  draw(); return box;
}

/* ---------- HOD dashboard ---------- */
route('/dept', ['hod', 'admin'], async (q) => {
  const deptId = q.get('dept'); let qs = deptId ? `?dept_id=${deptId}` : '';
  if (P.user.role === 'admin' && !deptId) {
    const deps = await api('GET', '/api/admin/departments');
    if (!deps.length) return emptyState({ iconName: 'building', title: t('noData'), desc: t('structure') });
    qs = `?dept_id=${deps[0].id}`;
    const first = deps[0].id;
    return deptView(`?dept_id=${first}`, deps, first);
  }
  return deptView(qs, null, deptId);
});
async function deptView(qs, deps, cur) {
  const [ov, sh] = await Promise.all([api('GET', '/api/department/overview' + qs), api('GET', '/api/department/shortage' + qs)]);
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: `${t('deptOverview')}: ${ov.department.name}`, desc: `${t('minAtt')}: ${num(ov.min_pct)}%`,
    actions: [deps ? selectInput(cur, deps.map(x => ({ value: x.id, label: x.name })), v => go('/dept?dept=' + v), t('dept')) : null, btn(t('exportCsv'), { icon: 'download', onclick: () => downloadCsv('/api/department/shortage.csv' + qs) })] }));
  out.append(h('div', { class: 'stats' }, statCard({ label: t('attendanceRate'), value: pctTxt(ov.rate), iconName: 'chart' }), statCard({ label: t('shortageN'), value: num(ov.shortage), iconName: 'alert', tone: ov.shortage ? 'danger' : 'success' }), statCard({ label: t('lectures'), value: num(ov.lectures), iconName: 'calendar' })));
  out.append(h('section', { class: 'card' }, h('h2', {}, t('nAllCourses')), dataTable({ cols: [
    { label: t('course'), render: r => h('a', { href: `#/course/${r.offering_id}` }, `${r.course_code} · ${r.section_name}`) }, { label: t('enrolled'), render: r => num(r.enrolled) }, { label: t('lectures'), render: r => num(r.lectures) },
    { label: t('rate'), render: r => pctTxt(r.rate) }, { label: t('shortageN'), render: r => num(r.shortage) }], rows: ov.items })));
  out.append(h('section', { class: 'card' }, h('h2', {}, t('shortageList')), sh.items.length ? dataTable({ cols: [
    { label: t('roll'), render: r => r.roll }, { label: t('name'), render: r => r.name }, { label: t('course'), render: r => `${r.course_code} · ${r.section_name}` },
    { label: t('attendanceRate'), render: r => pctTxt(r.pct) }, { label: t('outlookLbl'), render: r => outTxt(r.outlook) || '—' },
    { label: '', render: r => { const w = waLink(r.phone, tf('waText', { name: r.name, course: r.course_code, pct: pctTxt(r.pct), min: num(r.min) })); return w ? h('a', { href: w, target: '_blank', rel: 'noopener', class: 'btn ghost sm' }, t('whatsapp')) : null; } }], rows: sh.items.slice(0, 300) }) : h('p', { class: 'sub' }, t('noShortage'))));
  return out;
}
async function downloadCsv(url) {
  try { const res = await fetch(url, { credentials: 'same-origin', headers: { 'x-gmc': '1' } }); if (!res.ok) throw new Error(res.statusText); const blob = await res.blob(); const a = h('a', { href: URL.createObjectURL(blob), download: 'shortage.csv' }); document.body.append(a); a.click(); a.remove(); }
  catch (e) { toast(e.message, 'error'); }
}
