/* Student pages: dashboard with check-in, and the notification inbox (shared by all roles). */
'use strict';
const outTxt = o => (!o ? '' : o.need !== undefined ? tf('outNeed', { n: num(o.need) }) : tf('outSpare', { n: num(o.spare) }));
const ST_LABEL = { P: 'present', A: 'absent', L: 'leave', T: 'late' };
const ST_TONE = { P: 'success', T: 'warning', L: 'info', A: 'danger' };

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t('locDenied')));
    navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), () => reject(new Error(t('locDenied'))), { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 });
  });
}

function checkinCard(open, reload) {
  const input = h('input', { class: 'input code-input', id: 'ci-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]*', 'aria-label': t('enterCode'), placeholder: '••••••' });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const go_ = btn(t('checkIn'), { v: 'primary', type: 'submit', icon: 'check' });
  const needsLoc = open.some(o => o.needs_location);
  const form = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    if (!/^\d{6}$/.test(input.value)) { err.textContent = t('enterCode'); return; }
    go_.disabled = true;
    try {
      const body = { code: input.value };
      if (needsLoc) { toast(t('gettingLocation'), 'info'); Object.assign(body, await getPosition()); }
      const r = await api('POST', '/api/checkin', body);
      toast(r.already ? t('alreadyMarked') : t('checkedIn')); reload();
    } catch (ex) { err.textContent = ex.message; go_.disabled = false; input.select(); }
  } }, input, err, h('div', { style: 'margin-top:12px' }, go_));
  return h('section', { class: 'card', 'aria-labelledby': 'ci-h' }, h('h2', { id: 'ci-h' }, t('checkinOpen')),
    h('p', { class: 'sub', style: 'margin:4px 0 12px' }, open.map(o => o.course_code).join(' · '), ' — ', t('enterCode')), form);
}

route('/me', ['student'], async () => {
  const d = await api('GET', '/api/my/attendance');
  const reload = () => render();
  const o = d.overall;
  const out = h('div', { class: 'stack-page' },
    pageHeader({ title: d.student.name, desc: h('span', {}, `${t('roll')}: `, h('bdi', {}, d.student.roll)) }),
    d.open_checkins.length ? checkinCard(d.open_checkins, reload) : null,
    h('section', { class: 'card', 'aria-labelledby': 'ov-h' }, h('h2', { id: 'ov-h' }, t('overall')),
      h('div', { class: 'big-pct ' + toneCls(o.status) }, pctTxt(o.pct), ' ', statusBadge(o.status)),
      progress(o.pct, toneCls(o.status)), h('p', { class: 'sub' }, `${t('minAtt')}: ${num(d.min_pct)}%`), distributionBar(o.P, o.A, o.L, o.T)));
  if (!d.offerings.length) { out.append(emptyState({ iconName: 'book', title: t('noEnrol') })); return out; }
  out.append(h('section', { class: 'card', 'aria-labelledby': 'co-h' }, h('h2', { id: 'co-h' }, t('courses')),
    dataTable({ cols: [
      { label: t('course'), render: r => h('span', {}, h('b', {}, r.course_code), ' ', h('span', { class: 'sub' }, r.course_name)) },
      { label: t('attendanceRate'), render: r => h('span', { class: 'nowrap' }, pctTxt(r.pct), ' ', statusBadge(r.status)) },
      { label: t('lecturesHeld'), render: r => num(r.lectures_held) },
      { label: t('outlookLbl'), render: r => outTxt(r.outlook) || '—' }
    ], rows: d.offerings })));
  out.append(h('section', { class: 'card', 'aria-labelledby': 'rc-h' }, h('h2', { id: 'rc-h' }, t('recentRecords')),
    d.recent.length ? h('ul', { class: 'plain-list' }, d.recent.map(r => h('li', {}, h('span', { class: 'sub' }, fmtDate(r.date)), ' ', h('b', {}, r.course_code), ' ', badge(ST_TONE[r.status], t(ST_LABEL[r.status]))))) : h('p', { class: 'sub' }, '—')));
  return out;
});

route('/inbox', ['student', 'teacher', 'hod', 'admin'], async () => {
  const d = await api('GET', '/api/notifications');
  const out = h('div', { class: 'stack-page' });
  out.append(pageHeader({ title: t('nInbox'), actions: d.items.some(i => !i.read_at) ? btn(t('markAllRead'), { icon: 'check', onclick: async () => { await api('POST', '/api/notifications/read', { all: true }); P.unread = 0; render(); } }) : null }));
  if (P.user.role !== 'student') out.append(announceCard());
  if (!d.items.length) { out.append(emptyState({ iconName: 'message', title: t('inboxEmpty'), desc: t('inboxEmptyDesc') })); }
  else out.append(h('section', { class: 'card' }, h('ul', { class: 'plain-list notif' }, d.items.map(i => h('li', { class: i.read_at ? '' : 'unread' }, h('b', {}, i.title), h('p', {}, i.body), h('span', { class: 'sub' }, fmtTime(i.created_at)))))));
  if (d.unread) api('POST', '/api/notifications/read', { all: true }).then(() => { P.unread = 0; }).catch(() => {});
  return out;
});

/** Compose an announcement (teacher: own section, HOD: own department, admin: everyone). */
function announceCard() {
  const role = P.user.role;
  return h('section', { class: 'card' }, h('h2', {}, t('announce')), btn(t('announce'), { icon: 'plus', onclick: async () => {
    let sections = []; try { sections = role === 'admin' || role === 'hod' ? await api('GET', '/api/admin/sections') : (await api('GET', '/api/my/offerings')).map(o => ({ id: o.section_id, name: `${o.course_code} · ${o.section_name}` })); } catch { /* ignore */ }
    const opts = []; if (role === 'admin') opts.push({ value: 'all', label: t('scopeAll') });
    if (role === 'hod') opts.push({ value: 'dept', label: t('scopeDept') });
    opts.push({ value: 'section', label: t('scopeSection') });
    const secOpts = [...new Map(sections.map(s => [s.id, s])).values()].map(s => ({ value: s.id, label: s.name }));
    formDialog({ title: t('announce'), fields: [
      { key: 'scope', label: t('announceScope'), type: 'select', options: opts },
      { key: 'scope_id', label: t('section'), type: 'select', options: secOpts.length ? secOpts : [{ value: '', label: '—' }], help: role === 'hod' ? String(P.user.dept_id || '') : null },
      { key: 'title', label: t('announceTitle'), required: true }, { key: 'body', label: t('announceBody'), type: 'textarea', rows: 4, required: true }],
    onSubmit: vals => { const scope = vals.scope; const sid = scope === 'dept' ? P.user.dept_id : scope === 'section' ? +vals.scope_id : undefined;
      api('POST', '/api/announcements', { scope, scope_id: sid, title: vals.title, body: vals.body }).then(r => toast(`${t('sentTo')} ${num(r.recipients)} ${t('recipients')}`)).catch(e => toast(e.message, 'error')); } });
  } }));
}
