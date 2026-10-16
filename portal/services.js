/* Student services (certificates, messages, feedback, profile), calendar, and the staff request queues. */
'use strict';
const KIND_KEY = { bonafide: 'cert_bonafide', character: 'cert_character', fee_clearance: 'cert_fee_clearance', attendance: 'cert_attendance' };
const Q_KEYS = ['prepared', 'clear', 'punctual', 'fair', 'respect', 'overall'];
const hubCard = (href, ic, title, desc, count) => h('a', { class: 'card hub-card', href: '#' + href }, h('div', { class: 'hub-ic' }, icon(ic, 22)), h('div', {}, h('b', {}, title), h('p', { class: 'sub' }, desc)), count ? h('span', { class: 'badge warning' }, num(count)) : null);

route('/services', ['student'], async () => h('div', { class: 'stack-page' }, pageHeader({ title: t('nServices') }), h('div', { class: 'grid-cards' },
  hubCard('/certificates', 'file', t('nCertificates'), t('certificatesDesc')), hubCard('/complaints', 'message', t('nMessages'), t('messagesDesc')), hubCard('/feedback', 'chart', t('nFeedback'), t('feedbackDesc')),
  hubCard('/calendar', 'calendar', t('nCalendar'), t('calendarDesc')), h('button', { class: 'card hub-card', onclick: profileDialog }, h('div', { class: 'hub-ic' }, icon('user', 22)), h('div', {}, h('b', {}, t('myProfile')), h('p', { class: 'sub' }, t('profileDesc')))))));

async function profileDialog() {
  const p = await api('GET', '/api/my/profile');
  formDialog({ title: t('myProfile'), desc: `${p.roll} · ${p.name}${p.program_name ? ' · ' + p.program_name : ''}`, fields: [{ key: 'phone', label: t('phone'), type: 'tel', value: p.phone || '' }, { key: 'email', label: t('email'), type: 'email', value: p.email || '' }, { key: 'guardian_name', label: t('guardianName'), value: p.guardian_name || '' }, { key: 'guardian_phone', label: t('guardianPhone'), type: 'tel', value: p.guardian_phone || '' }, { key: 'address', label: t('address'), value: p.address || '' }],
    onSubmit: v => { api('PUT', '/api/my/profile', Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]))).then(() => toast(t('saved'))).catch(e => toast(e.message, 'error')); } });
}

/* ---------- calendar ---------- */
route('/calendar', ['student', 'teacher', 'hod', 'admin'], async () => {
  const list = await api('GET', '/api/calendar'); const isAdmin = P.user.role === 'admin' && P.user.perms === 'all';
  const dlg = ev => formDialog({ title: ev ? t('edit') : t('add'), fields: [{ key: 'title', label: t('title'), value: ev ? ev.title : '', required: true }, { key: 'kind', label: t('type'), type: 'select', value: ev ? ev.kind : 'event', options: ['holiday', 'exam', 'event', 'deadline'].map(k => ({ value: k, label: t('ck_' + k) })) }, { key: 'date', label: t('from'), type: 'date', value: ev ? ev.date : todayStr(), required: true }, { key: 'end_date', label: t('to'), type: 'date', value: ev && ev.end_date ? ev.end_date : '' }],
    onSubmit: v => { const b = { title: v.title, kind: v.kind, date: v.date, end_date: v.end_date || undefined }; (ev ? api('PUT', '/api/admin/calendar/' + ev.id, b) : api('POST', '/api/admin/calendar', b)).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } });
  const tone = { holiday: 'danger', exam: 'warning', event: 'info', deadline: 'neutral' };
  return h('div', { class: 'stack-page' }, pageHeader({ title: t('nCalendar'), actions: isAdmin ? btn(t('add'), { v: 'primary', icon: 'plus', onclick: () => dlg(null) }) : null }),
    list.length ? h('section', { class: 'card' }, dataTable({ cols: [{ label: t('from'), render: r => h('span', { class: 'nowrap' }, fmtDate(r.date), r.end_date ? ' → ' + fmtDate(r.end_date) : '') }, { label: t('title'), render: r => r.title }, { label: t('type'), render: r => badge(tone[r.kind], t('ck_' + r.kind)) },
      ...(isAdmin ? [{ label: '', render: r => h('span', { class: 'row-actions' }, iconBtn('edit', t('edit'), () => dlg(r)), iconBtn('trash', t('del'), () => confirmDialog({ title: t('del'), desc: r.title, onConfirm: () => api('DELETE', '/api/admin/calendar/' + r.id).then(() => render()).catch(e => toast(e.message, 'error')) }))) }] : [])], rows: list })) : emptyState({ iconName: 'calendar', title: t('noEvents') }));
});

/* ---------- certificates ---------- */
const CERT_TONE = { pending: 'warning', issued: 'success', rejected: 'danger' };
route('/certificates', ['student'], async () => {
  const list = await api('GET', '/api/my/certificates');
  const kind = h('select', { class: 'input', id: 'ct-kind' }, Object.keys(KIND_KEY).map(k => h('option', { value: k }, t(KIND_KEY[k])))), purpose = h('input', { class: 'input', id: 'ct-why', maxlength: 150, placeholder: t('purposeHint') });
  const sub = btn(t('requestCert'), { v: 'primary', type: 'submit', icon: 'check' }); const err = h('p', { class: 'field-error', role: 'alert' });
  return h('div', { class: 'stack-page' }, pageHeader({ crumbs: [{ label: t('nServices'), href: '#/services' }, { label: t('nCertificates') }], title: t('nCertificates') }),
    h('section', { class: 'card' }, h('form', { onsubmit: async e => { e.preventDefault(); sub.disabled = true; err.textContent = ''; try { await api('POST', '/api/certificates', { kind: kind.value, purpose: purpose.value || undefined }); toast(t('saved')); render(); } catch (ex) { err.textContent = ex.message; sub.disabled = false; } } },
      h('div', { class: 'grid-2' }, h('div', { class: 'field' }, h('label', { for: 'ct-kind' }, t('type')), kind), h('div', { class: 'field' }, h('label', { for: 'ct-why' }, t('purpose')), purpose)), err, sub)),
    h('section', { class: 'card' }, list.length ? dataTable({ cols: [{ label: t('type'), render: r => t(KIND_KEY[r.kind]) }, { label: t('purpose'), render: r => r.purpose || '—' }, { label: t('status'), render: r => h('span', {}, badge(CERT_TONE[r.status], t('cs_' + r.status)), r.decision_note ? h('div', { class: 'sub' }, r.decision_note) : null) },
      { label: '', render: r => (r.status === 'issued' ? h('a', { class: 'btn secondary sm', href: '#/certificate/' + r.id }, t('viewPrint')) : null) }], rows: list }) : h('p', { class: 'sub' }, '—')));
});
route('/certificate/:id', ['student', 'admin', 'hod'], async id => {
  const c = await api('GET', '/api/certificates/' + id); const url = `${location.origin}/portal/verify.html?c=${c.code}`;
  const para = { bonafide: tf('certBonafideText', { name: c.name, roll: c.roll, program: c.program || '', term: c.term || '' }), character: tf('certCharacterText', { name: c.name, roll: c.roll, program: c.program || '' }), fee_clearance: tf('certFeeText', { name: c.name, roll: c.roll }), attendance: tf('certAttText', { name: c.name, roll: c.roll }) }[c.kind];
  const box = h('section', { class: 'card certificate printable' }, h('div', { class: 'cert-head' }, h('img', { src: '/icons/logo.jpg', alt: '', width: 56, height: 56 }), h('div', {}, h('h2', {}, c.college), h('p', { class: 'sub' }, c.department || ''))), h('h1', { class: 'cert-title' }, t(KIND_KEY[c.kind])),
    h('p', { class: 'cert-body' }, para), c.purpose ? h('p', {}, `${t('purpose')}: ${c.purpose}`) : null,
    c.attendance ? h('table', { class: 'table slim' }, h('tbody', {}, c.attendance.map(a => h('tr', {}, h('td', {}, `${a.code} ${a.name}`), h('td', { class: 'amt' }, a.pct === null ? '—' : pctTxt(a.pct)))))) : null,
    h('div', { class: 'cert-foot' }, h('div', {}, h('div', { class: 'sub' }, t('issuedOn')), h('b', {}, fmtDate(c.issued_on))), h('div', {}, h('div', { class: 'sub' }, t('verifyCode')), h('code', { class: 'big-code' }, c.code), h('div', { class: 'sub' }, t('verifyAt') + ' ' + url))),
    h('div', { class: 'noprint' }, btn(t('print'), { icon: 'download', onclick: e => printNode(e.target.closest('.certificate')) })));
  return h('div', { class: 'stack-page' }, box);
});

/* ---------- messages / complaints ---------- */
const COMP_TONE = { open: 'warning', in_progress: 'info', resolved: 'success' };
route('/complaints', ['student'], async () => {
  const list = await api('GET', '/api/my/complaints');
  const cat = h('select', { class: 'input', id: 'cm-cat' }, ['academic', 'fees', 'facilities', 'harassment', 'other'].map(k => h('option', { value: k }, t('cc_' + k)))), body = h('textarea', { class: 'input', id: 'cm-body', rows: 4, maxlength: 1500 }), hide = h('input', { type: 'checkbox', id: 'cm-hide' });
  const sub = btn(t('send'), { v: 'primary', type: 'submit', icon: 'check' }), err = h('p', { class: 'field-error', role: 'alert' });
  return h('div', { class: 'stack-page' }, pageHeader({ crumbs: [{ label: t('nServices'), href: '#/services' }, { label: t('nMessages') }], title: t('nMessages'), desc: t('messagesDesc2') }),
    h('section', { class: 'card' }, h('form', { onsubmit: async e => { e.preventDefault(); sub.disabled = true; err.textContent = ''; try { await api('POST', '/api/complaints', { category: cat.value, body: body.value, hide_name: hide.checked }); toast(t('saved')); render(); } catch (ex) { err.textContent = ex.message; sub.disabled = false; } } },
      h('div', { class: 'field' }, h('label', { for: 'cm-cat' }, t('category')), cat), h('div', { class: 'field' }, h('label', { for: 'cm-body' }, t('message')), body), h('label', { class: 'check' }, hide, ' ', t('hideName')), h('p', { class: 'help' }, t('hideNameHint')), err, sub)),
    h('section', { class: 'card' }, list.length ? h('ul', { class: 'plain-list notif' }, list.map(x => h('li', {}, h('div', {}, badge(COMP_TONE[x.status], t('cp_' + x.status)), ' ', h('b', {}, t('cc_' + x.category)), ' ', h('span', { class: 'sub' }, fmtTime(x.created_at))), h('p', {}, x.body), x.response ? h('p', { class: 'notice' }, x.response) : null))) : h('p', { class: 'sub' }, '—')));
});

/* ---------- teacher feedback ---------- */
route('/feedback', ['student'], async () => {
  const list = await api('GET', '/api/my/surveys'); const out = h('div', { class: 'stack-page' }, pageHeader({ crumbs: [{ label: t('nServices'), href: '#/services' }, { label: t('nFeedback') }], title: t('nFeedback'), desc: t('feedbackAnon') }));
  if (!list.length) { out.append(emptyState({ iconName: 'chart', title: t('noSurveys'), desc: t('noSurveysDesc') })); return out; }
  for (const s of list) out.append(h('section', { class: 'card' }, h('h2', {}, s.title), h('p', { class: 'sub' }, `${t('closes')}: ${fmtDate(s.closes)}`), h('ul', { class: 'plain-list' }, s.courses.map(c => h('li', {}, h('b', {}, c.code), ' ', c.name, ' ', h('span', { class: 'sub' }, c.teacher_name || ''), ' ', c.done ? badge('success', t('done')) : btn(t('rate'), { size: 'sm', v: 'primary', onclick: () => rateDialog(s, c) }))))));
  return out;
});
function rateDialog(s, c) {
  const sel = {}; const fields = Q_KEYS.map(q => ({ key: q, label: t('q_' + q), type: 'select', value: '', options: [{ value: '', label: '—' }, ...[5, 4, 3, 2, 1].map(n => ({ value: n, label: `${num(n)} ${t('star_' + n)}` }))], required: true }));
  formDialog({ title: `${c.code} ${c.name}`, desc: t('feedbackAnon'), fields: [...fields, { key: 'comment', label: t('comment'), type: 'textarea', rows: 3 }], submit: t('send'),
    onSubmit: v => { api('POST', `/api/surveys/${s.id}/respond`, { offering_id: c.offering_id, ratings: Object.fromEntries(Q_KEYS.map(q => [q, +v[q]])), comment: v.comment || undefined }).then(() => { toast(t('thanks')); render(); }).catch(e => toast(e.message, 'error')); } });
}
route('/survey-results', ['teacher', 'hod', 'admin'], async q => {
  const list = await api('GET', '/api/surveys'); const cur = q.get('s') || (list[0] && list[0].id); const isAdmin = P.user.role === 'admin' && P.user.perms === 'all';
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: t('nSurveyResults'), actions: [list.length ? selectInput(cur, list.map(x => ({ value: x.id, label: x.title })), v => go('/survey-results?s=' + v), t('survey')) : null, isAdmin ? btn(t('newSurvey'), { v: 'primary', icon: 'plus', onclick: () => formDialog({ title: t('newSurvey'), fields: [{ key: 'title', label: t('title'), required: true }, { key: 'opens', label: t('opens'), type: 'date', value: todayStr(), required: true }, { key: 'closes', label: t('closes'), type: 'date', required: true }],
    onSubmit: v => { api('POST', '/api/admin/surveys', v).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } }) }) : null] }), h('p', { class: 'notice' }, t('minAnswersNote')));
  if (!cur) { out.append(emptyState({ iconName: 'chart', title: t('noSurveys') })); return out; }
  const rep = await api('GET', `/api/surveys/${cur}/report`);
  if (!rep.length) out.append(emptyState({ iconName: 'chart', title: t('noAnswers') }));
  for (const r of rep) out.append(h('section', { class: 'card' }, h('div', { class: 'toolbar' }, h('h2', {}, r.course), h('span', { class: 'sub' }, r.teacher || ''), h('span', { class: 'grow' }), h('span', { class: 'sub' }, `${num(r.n)} ${t('answers')}`)),
    r.hidden ? h('p', { class: 'sub' }, tf('hiddenFew', { n: num(5) })) : h('div', {}, h('table', { class: 'table slim' }, h('tbody', {}, Q_KEYS.map(k => h('tr', {}, h('td', {}, t('q_' + k)), h('td', { class: 'amt' }, h('b', {}, num(r.avg[k].toFixed(2))), ' / ', num(5)))))), r.comments.length ? h('ul', { class: 'plain-list notif' }, r.comments.map(c => h('li', {}, c))) : null)));
  return out;
});

/* ---------- staff request queues ---------- */
route('/requests', ['teacher', 'hod', 'admin'], async () => {
  const u = P.user, staff = u.role !== 'teacher'; const safe = p => api('GET', p).then(x => x.length).catch(() => 0);
  const [c1, c2, c3, c4] = await Promise.all([safe('/api/corrections'), staff ? safe('/api/leaves') : 0, staff ? safe('/api/certificate-requests') : 0, staff ? safe('/api/complaints') : 0]);
  return h('div', { class: 'stack-page' }, pageHeader({ title: t('nRequests') }), h('div', { class: 'grid-cards' }, hubCard('/corrections', 'check', t('nCorrections'), t('correctionsDesc'), c1),
    staff ? [hubCard('/leaves', 'calendar', t('nLeaves'), t('leavesDesc'), c2), hubCard('/cert-requests', 'file', t('nCertificates'), t('certQueueDesc'), c3), hubCard('/complaints-inbox', 'message', t('nMessages'), t('complaintsDesc'), c4)] : null,
    hubCard('/survey-results', 'chart', t('nSurveyResults'), t('surveyResultsDesc')), hubCard('/calendar', 'calendar', t('nCalendar'), t('calendarDesc'))));
});
const REQ_Q = (status, setStatus) => tabsBar(['pending', 'approved', 'rejected'].map(s => [s, t('lv_' + s)]), status, setStatus);
route('/corrections', ['teacher', 'hod', 'admin'], async q => {
  const status = q.get('status') || 'pending'; const list = await api('GET', '/api/corrections?status=' + status);
  const decide = (r, decision) => formDialog({ title: t(decision === 'approved' ? 'approve' : 'reject'), desc: `${r.roll} · ${r.student_name} · ${r.course_code} ${fmtDate(r.date)}`, fields: [{ key: 'note', label: t('note'), type: 'textarea', rows: 3, required: decision === 'rejected' }], onSubmit: v => { api('POST', `/api/corrections/${r.id}/decide`, { decision, note: v.note || undefined }).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } });
  return h('div', { class: 'stack-page' }, pageHeader({ crumbs: [{ label: t('nRequests'), href: '#/requests' }, { label: t('nCorrections') }], title: t('nCorrections') }), REQ_Q(status, k => go('/corrections?status=' + k)),
    list.length ? dataTable({ cols: [{ label: t('roll'), render: r => r.roll }, { label: t('name'), render: r => r.student_name }, { label: t('course'), render: r => `${r.course_code} ${r.section_name}` }, { label: t('lectureDate'), render: r => fmtDate(r.date) }, { label: t('reason'), render: r => r.note }, { label: t('wantsStatus'), render: r => t(ST_LABEL[r.requested_status]) },
      { label: '', render: r => (r.status === 'pending' ? h('span', { class: 'row-actions' }, btn(t('approve'), { size: 'sm', v: 'primary', onclick: () => decide(r, 'approved') }), btn(t('reject'), { size: 'sm', onclick: () => decide(r, 'rejected') })) : r.decision_note || '') }], rows: list }) : emptyState({ iconName: 'check', title: t('noLeaves') }));
});
route('/cert-requests', ['hod', 'admin'], async q => {
  const status = q.get('status') || 'pending'; const list = await api('GET', '/api/certificate-requests?status=' + (status === 'approved' ? 'issued' : status));
  const decide = (r, decision) => formDialog({ title: t(decision === 'issued' ? 'issue' : 'reject'), desc: `${r.roll} · ${r.student_name} · ${t(KIND_KEY[r.kind])}`, fields: [{ key: 'note', label: t('note'), type: 'textarea', rows: 3, required: decision === 'rejected' }], onSubmit: v => { api('POST', `/api/certificate-requests/${r.id}/decide`, { decision, note: v.note || undefined }).then(x => { toast(decision === 'issued' ? `${t('verifyCode')}: ${x.code}` : t('saved')); render(); }).catch(e => toast(e.message, 'error')); } });
  return h('div', { class: 'stack-page' }, pageHeader({ crumbs: [{ label: t('nRequests'), href: '#/requests' }, { label: t('nCertificates') }], title: t('nCertificates') }), REQ_Q(status, k => go('/cert-requests?status=' + k)),
    list.length ? dataTable({ cols: [{ label: t('roll'), render: r => r.roll }, { label: t('name'), render: r => r.student_name }, { label: t('type'), render: r => t(KIND_KEY[r.kind]) }, { label: t('purpose'), render: r => r.purpose || '—' }, { label: '', render: r => (r.status === 'pending' ? h('span', { class: 'row-actions' }, btn(t('issue'), { size: 'sm', v: 'primary', onclick: () => decide(r, 'issued') }), btn(t('reject'), { size: 'sm', onclick: () => decide(r, 'rejected') })) : h('code', {}, r.code || '')) }], rows: list }) : emptyState({ iconName: 'file', title: t('noLeaves') }));
});
route('/complaints-inbox', ['hod', 'admin'], async q => {
  const status = q.get('status') || 'open'; const list = await api('GET', '/api/complaints?status=' + status);
  const respond = r => formDialog({ title: t('reply'), desc: r.body, fields: [{ key: 'status', label: t('status'), type: 'select', options: [{ value: 'in_progress', label: t('cp_in_progress') }, { value: 'resolved', label: t('cp_resolved') }] }, { key: 'response', label: t('reply'), type: 'textarea', rows: 4, required: true }], onSubmit: v => { api('POST', `/api/complaints/${r.id}/respond`, v).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } });
  return h('div', { class: 'stack-page' }, pageHeader({ crumbs: [{ label: t('nRequests'), href: '#/requests' }, { label: t('nMessages') }], title: t('nMessages') }), tabsBar(['open', 'in_progress', 'resolved'].map(s => [s, t('cp_' + s)]), status, k => go('/complaints-inbox?status=' + k)),
    list.length ? h('section', { class: 'card' }, h('ul', { class: 'plain-list notif' }, list.map(x => h('li', {}, h('div', {}, badge('neutral', t('cc_' + x.category)), ' ', h('b', {}, x.hide_name ? t('anonymousName') : `${x.roll} · ${x.student_name || ''}`), ' ', h('span', { class: 'sub' }, fmtTime(x.created_at))), h('p', {}, x.body), x.response ? h('p', { class: 'notice' }, x.response) : null, x.status !== 'resolved' ? btn(t('reply'), { size: 'sm', onclick: () => respond(x) }) : null)))) : emptyState({ iconName: 'message', title: t('noLeaves') }));
});

/** Export or anonymise one student's data (admin). */
function dataToolsDialog(st) {
  const d = sheetDialog(`${st.roll} · ${st.name}`, h('div', {}, h('p', { class: 'sub' }, t('dataToolsHint')), h('div', { class: 'pill-row' },
    btn(t('exportData'), { icon: 'download', onclick: () => downloadFile(`/api/admin/students/${st.id}/export`, `student-${st.roll}.json`) }),
    btn(t('anonymize'), { v: 'danger-ghost', onclick: () => { d.close(); formDialog({ title: t('anonymize'), desc: t('anonymizeHint'), fields: [{ key: 'reason', label: t('reason'), required: true }], submit: t('anonymize'), onSubmit: v => { api('POST', `/api/admin/students/${st.id}/anonymize`, { reason: v.reason }).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } }); } }))));
}
