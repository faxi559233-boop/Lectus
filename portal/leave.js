/* Leave: students apply, HOD / admin decide. */
'use strict';
const LV_TONE = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' };
route('/leave', ['student'], async () => {
  const list = await api('GET', '/api/my/leaves');
  const from = h('input', { class: 'input', type: 'date', id: 'lv-from', value: todayStr(), required: true }), to = h('input', { class: 'input', type: 'date', id: 'lv-to', value: todayStr(), required: true }), why = h('textarea', { class: 'input', id: 'lv-why', rows: 3, maxlength: 500, required: true });
  const err = h('p', { class: 'field-error', role: 'alert' }), sub = btn(t('applyLeave'), { v: 'primary', type: 'submit', icon: 'check' });
  const form = h('form', { novalidate: true, onsubmit: async e => { e.preventDefault(); err.textContent = ''; sub.disabled = true;
    try { await api('POST', '/api/leaves', { from: from.value, to: to.value, reason: why.value }); toast(t('saved')); render(); } catch (ex) { err.textContent = ex.message; sub.disabled = false; } } },
    h('div', { class: 'grid-2' }, h('div', { class: 'field' }, h('label', { for: 'lv-from' }, t('from')), from), h('div', { class: 'field' }, h('label', { for: 'lv-to' }, t('to')), to)),
    h('div', { class: 'field' }, h('label', { for: 'lv-why' }, t('reason')), why), err, sub);
  return h('div', { class: 'stack-page' }, pageHeader({ title: t('nLeave'), desc: t('leaveHint') }), h('section', { class: 'card' }, form),
    h('section', { class: 'card' }, h('h2', {}, t('myLeaves')), list.length ? dataTable({ cols: [{ label: t('from'), render: r => fmtDate(r.from_date) }, { label: t('to'), render: r => fmtDate(r.to_date) }, { label: t('reason'), render: r => r.reason },
      { label: t('status'), render: r => h('span', {}, badge(LV_TONE[r.status], t('lv_' + r.status)), r.decision_note ? h('div', { class: 'sub' }, r.decision_note) : null) },
      { label: '', render: r => (r.status === 'pending' ? btn(t('cancel'), { size: 'sm', v: 'ghost', onclick: () => api('POST', `/api/leaves/${r.id}/cancel`).then(() => render()).catch(e => toast(e.message, 'error')) }) : null) }], rows: list }) : h('p', { class: 'sub' }, '—')));
});
route('/leaves', ['hod', 'admin'], async q => {
  const status = q.get('status') || 'pending'; const list = await api('GET', '/api/leaves?status=' + status);
  const decide = (r, decision) => formDialog({ title: t(decision === 'approved' ? 'approve' : 'reject'), desc: `${r.roll} · ${r.student_name}: ${fmtDate(r.from_date)} → ${fmtDate(r.to_date)}`, fields: [{ key: 'note', label: t('note'), type: 'textarea', rows: 3, required: decision === 'rejected' }],
    onSubmit: v => { api('POST', `/api/leaves/${r.id}/decide`, { decision, note: v.note || undefined }).then(x => { toast(decision === 'approved' ? `${t('approved_')} · ${tf('absToLeave', { n: num(x.converted) })}` : t('saved')); render(); }).catch(e => toast(e.message, 'error')); } });
  return h('div', { class: 'stack-page' }, pageHeader({ title: t('nLeaves') }), tabsBar(['pending', 'approved', 'rejected'].map(s => [s, t('lv_' + s)]), status, k => go('/leaves?status=' + k)),
    list.length ? dataTable({ cols: [{ label: t('roll'), render: r => r.roll }, { label: t('name'), render: r => r.student_name }, { label: t('from'), render: r => fmtDate(r.from_date) }, { label: t('to'), render: r => fmtDate(r.to_date) }, { label: t('reason'), render: r => r.reason },
      { label: '', render: r => (r.status === 'pending' ? h('span', { class: 'row-actions' }, btn(t('approve'), { size: 'sm', v: 'primary', onclick: () => decide(r, 'approved') }), btn(t('reject'), { size: 'sm', onclick: () => decide(r, 'rejected') })) : r.decision_note || '') }], rows: list }) : emptyState({ iconName: 'calendar', title: t('noLeaves') }));
});
