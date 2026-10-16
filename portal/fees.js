/* Fees: student vouchers (printable) and the accounts officer's desk. Amounts are whole rupees. */
'use strict';
const rs = n => 'Rs ' + num(Number(n || 0).toLocaleString('en-US'));
/** Prints one element on its own page: a clone is placed in #printarea and everything else is hidden by the print stylesheet. */
function printNode(el) { const area = h('div', { id: 'printarea' }); area.append(el.cloneNode(true)); document.body.append(area); document.body.classList.add('printing-one'); window.print(); setTimeout(() => { area.remove(); document.body.classList.remove('printing-one'); }, 800); }
const FEE_TONE = { paid: 'success', partial: 'warning', unpaid: 'neutral', void: 'neutral' };
const feeBadge = x => (x.overdue ? badge('danger', t('fs_overdue')) : badge(FEE_TONE[x.state] || 'neutral', t('fs_' + x.state)));

function voucherView(x, info, opts = {}) {
  const card = h('section', { class: 'card voucher printable' },
    h('div', { class: 'toolbar' }, h('div', {}, h('b', {}, info.college), h('div', { class: 'sub' }, x.title)), h('span', { class: 'grow' }), feeBadge(x)),
    h('div', { class: 'voucher-no' }, h('span', { class: 'sub' }, t('voucherNo')), h('code', { class: 'big-code' }, x.number)),
    h('dl', { class: 'kv' }, h('dt', {}, t('roll')), h('dd', {}, h('bdi', {}, x.roll)), h('dt', {}, t('name')), h('dd', {}, x.student_name), h('dt', {}, t('dueDate')), h('dd', {}, fmtDate(x.due_date))),
    h('table', { class: 'table slim' }, h('tbody', {}, x.items.map(i => h('tr', {}, h('td', {}, i.head), h('td', { class: 'amt' }, rs(i.amount)))),
      x.discount ? h('tr', {}, h('td', {}, t('discount')), h('td', { class: 'amt' }, '− ' + rs(x.discount))) : null, x.fine ? h('tr', {}, h('td', {}, t('lateFine')), h('td', { class: 'amt' }, rs(x.fine))) : null,
      h('tr', { class: 'tot' }, h('td', {}, t('totalDue')), h('td', { class: 'amt' }, rs(x.due_total))),
      x.paid ? h('tr', {}, h('td', {}, t('paidSoFar')), h('td', { class: 'amt' }, '− ' + rs(x.paid))) : null, h('tr', { class: 'tot' }, h('td', {}, t('balance')), h('td', { class: 'amt' }, rs(x.balance))))),
    x.payments.filter(p => !p.reversed_at).length ? h('div', {}, h('h3', {}, t('payments')), h('ul', { class: 'plain-list' }, x.payments.filter(p => !p.reversed_at).map(p => h('li', {}, fmtDate(p.paid_on), ' · ', h('b', {}, rs(p.amount)), ' · ', p.method, p.reference ? ' · ' + p.reference : '')))) : null,
    info.instructions ? h('p', { class: 'notice' }, info.instructions) : null, opts.footer || null);
  return card;
}
route('/fees', ['student'], async () => {
  const d = await api('GET', '/api/my/fees');
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: t('nFees'), desc: h('span', {}, h('bdi', {}, d.student.roll), ' · ', d.student.name) }));
  if (!d.vouchers.length) { out.append(emptyState({ iconName: 'database', title: t('noVouchers'), desc: t('noVouchersDesc') })); return out; }
  for (const x of d.vouchers) out.append(voucherView(x, d, { footer: h('div', { class: 'noprint' }, btn(t('print'), { icon: 'download', onclick: e => printNode(e.target.closest('.voucher')) })) }));
  return out;
});

/* ---------- accounts desk ---------- */
const PAGE_F = 40;
route('/admin/fees', ['admin'], async q => {
  const tab = q.get('tab') || 'vouchers';
  const [sum, lk] = await Promise.all([api('GET', '/api/fees/summary'), api('GET', '/api/fees/lookups')]);
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: t('nFees'), actions: [btn(t('applyFines'), { size: 'sm', onclick: () => confirmDialog({ title: t('applyFines'), desc: t('applyFinesAsk'), confirm: t('applyFines'), danger: false, onConfirm: () => api('POST', '/api/fees/fines/apply', {}).then(r => { toast(`${num(r.vouchers)} · ${rs(r.total)}`); render(); }).catch(e => toast(e.message, 'error')) }) })] }),
    h('div', { class: 'stats' }, statCard({ label: t('billed'), value: rs(sum.billed), iconName: 'database' }), statCard({ label: t('collected'), value: rs(sum.collected), iconName: 'check', tone: 'success' }),
      statCard({ label: t('outstanding'), value: rs(sum.outstanding), iconName: 'alert' }), statCard({ label: t('fs_overdue'), value: `${num(sum.overdue_count)} · ${rs(sum.overdue_amount)}`, iconName: 'clock', tone: sum.overdue_count ? 'danger' : '' })),
    tabsBar([['vouchers', t('vouchers')], ['plans', t('plans')], ['import', t('bankImport')], ['settings', t('feeSettings')]], tab, k => go('/admin/fees?tab=' + k)));
  const body = h('div', {}); out.append(body);
  ({ vouchers: () => vouchersTab(body, q, lk), plans: () => plansTab(body, lk), import: () => importTab(body), settings: () => settingsTab(body) })[tab]();
  return out;
});

async function vouchersTab(body, q, lk) {
  const page = +q.get('p') || 1, state = q.get('state') || '', text = q.get('q') || '', sec = q.get('section') || '';
  const qs = new URLSearchParams({ limit: PAGE_F, offset: (page - 1) * PAGE_F }); if (state) qs.set('state', state); if (text) qs.set('q', text); if (sec) qs.set('section_id', sec);
  const d = await api('GET', '/api/fees/vouchers?' + qs);
  const nav = (o = {}) => { const n = new URLSearchParams({ tab: 'vouchers', p: 1, state, q: text, section: sec, ...o }); [...n].forEach(([k, v]) => { if (!v) n.delete(k); }); go('/admin/fees?' + n); };
  const exportQs = new URLSearchParams(); if (state) exportQs.set('state', state); if (text) exportQs.set('q', text); if (sec) exportQs.set('section_id', sec);
  const states = ['', 'unpaid', 'partial', 'paid', 'overdue', 'void'].map(s => ({ value: s, label: s ? t('fs_' + s) : t('allStatuses') }));
  body.replaceChildren(h('div', { class: 'stack-page' },
    h('div', { class: 'toolbar' }, searchInput(text, t('searchVoucher'), e => { clearTimeout(body._t); body._t = setTimeout(() => nav({ q: e.target.value }), 350); }), selectInput(state, states, v => nav({ state: v }), t('status')),
      selectInput(sec, [{ value: '', label: t('allGroups') }, ...lk.sections.map(s => ({ value: s.id, label: `${s.program_code} ${s.name}` }))], v => nav({ section: v }), t('section')),
      h('span', { class: 'grow' }), btn(t('newVoucher'), { icon: 'plus', onclick: () => customVoucherDlg() }), btn(t('exportCsv'), { icon: 'download', onclick: () => downloadFile('/api/fees/vouchers.csv?' + exportQs, 'fee-vouchers.csv') })),
    h('p', { class: 'sub' }, `${num(d.total)} · ${t('outstanding')}: ${rs(d.balance)}`),
    d.items.length ? dataTable({ cols: [{ label: t('voucherNo'), render: r => h('code', {}, r.number) }, { label: t('roll'), render: r => r.roll }, { label: t('name'), render: r => r.student_name }, { label: t('title'), render: r => r.title },
      { label: t('totalDue'), render: r => rs(r.due_total) }, { label: t('balance'), render: r => rs(r.balance) }, { label: t('dueDate'), render: r => fmtDate(r.due_date) }, { label: t('status'), render: r => feeBadge(r) }], rows: d.items, onRow: r => voucherDlg(r.id) }) : emptyState({ iconName: 'database', title: t('noVouchers') }),
    pager(d.total, page, PAGE_F, p => nav({ p }))));
}
async function customVoucherDlg() {
  const picked = { id: null }; const list = h('div', { class: 'plain-list' }); const q = h('input', { class: 'input', placeholder: t('searchStudents'), 'aria-label': t('searchStudents'), oninput: async () => { if (q.value.length < 2) return; const r = await api('GET', '/api/fees/students?q=' + encodeURIComponent(q.value)); list.replaceChildren(...r.map(s => btn(`${s.roll} · ${s.name}`, { size: 'sm', onclick: () => { picked.id = s.id; q.value = `${s.roll} · ${s.name}`; list.replaceChildren(); } }))); } });
  formDialog({ title: t('newVoucher'), fields: [{ custom: true, node: h('div', { class: 'field' }, h('label', {}, t('student')), q, list) }, { key: 'title', label: t('title'), required: true }, { key: 'head', label: t('feeHead'), required: true }, { key: 'amount', label: t('amount'), type: 'number', min: 1, required: true }, { key: 'discount', label: t('discount'), type: 'number', min: 0, value: '0' }, { key: 'due_date', label: t('dueDate'), type: 'date', required: true }],
    onSubmit: v => { if (!picked.id) { toast(t('pickStudent'), 'error'); return { title: t('pickStudent') }; }
      api('POST', '/api/fees/vouchers', { student_id: picked.id, title: v.title, items: [{ head: v.head, amount: +v.amount }], discount: +v.discount || 0, due_date: v.due_date }).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } });
}
async function voucherDlg(id) {
  const [x, info] = await Promise.all([api('GET', '/api/fees/vouchers/' + id), api('GET', '/api/fees/settings')]);
  const info2 = { college: info.college_name, instructions: info.instructions };
  const reload = () => { d.close(); voucherDlg(id); };
  const act = (fn) => fn().then(reload).catch(e => toast(e.message, 'error'));
  const foot = h('div', { class: 'noprint' }, h('div', { class: 'pill-row' },
    x.status !== 'void' && x.balance > 0 ? btn(t('recordPayment'), { v: 'primary', size: 'sm', icon: 'plus', onclick: () => formDialog({ title: t('recordPayment'), fields: [{ key: 'amount', label: t('amount'), type: 'number', min: 1, value: String(x.balance), required: true }, { key: 'method', label: t('method'), type: 'select', options: ['cash', 'bank', 'online', 'other'].map(m => ({ value: m, label: m })) }, { key: 'reference', label: t('reference') }, { key: 'paid_on', label: t('paidOn'), type: 'date', value: todayStr() }],
      onSubmit: v => { act(() => api('POST', `/api/fees/vouchers/${id}/payments`, { amount: +v.amount, method: v.method, reference: v.reference || undefined, paid_on: v.paid_on })); } }) }) : null,
    x.status !== 'void' ? btn(t('editVoucher'), { size: 'sm', onclick: () => formDialog({ title: t('editVoucher'), fields: [{ key: 'discount', label: t('discount'), type: 'number', min: 0, value: String(x.discount) }, { key: 'due_date', label: t('dueDate'), type: 'date', value: x.due_date }],
      onSubmit: v => { act(() => api('PUT', '/api/fees/vouchers/' + id, { discount: +v.discount || 0, due_date: v.due_date })); } }) }) : null,
    x.status !== 'void' && !x.paid ? btn(t('cancelVoucher'), { size: 'sm', v: 'danger-ghost', onclick: () => confirmDialog({ title: t('cancelVoucher'), desc: x.number, confirm: t('cancelVoucher'), onConfirm: () => act(() => api('PUT', '/api/fees/vouchers/' + id, { void: true })) }) }) : null,
    btn(t('print'), { size: 'sm', onclick: e => printNode(e.target.closest('.voucher')) })),
    x.payments.length ? h('ul', { class: 'plain-list' }, x.payments.map(p => h('li', {}, fmtDate(p.paid_on), ' · ', h('b', {}, rs(p.amount)), ' · ', p.method, p.reference ? ' · ' + p.reference : '', p.reversed_at ? badge('neutral', t('reversed')) : btn(t('reverse'), { size: 'sm', v: 'ghost', onclick: () => formDialog({ title: t('reverse'), fields: [{ key: 'reason', label: t('reason'), required: true }], onSubmit: v => { act(() => api('POST', `/api/fees/payments/${p.id}/reverse`, { reason: v.reason })); } }) })))) : null);
  const d = sheetDialog(x.number, voucherView(x, info2, { footer: foot }));
}

async function plansTab(body, lk) {
  const plans = await api('GET', '/api/fees/plans');
  const editDlg = p => {
    const items = p ? p.items.map(i => ({ ...i })) : [{ head: 'Tuition', amount: 0 }]; const itemBox = h('div', {});
    const drawItems = () => itemBox.replaceChildren(...items.map((it, i) => h('div', { class: 'row-inputs' }, h('input', { class: 'input', value: it.head, 'aria-label': t('feeHead'), oninput: e => { it.head = e.target.value; } }), h('input', { class: 'input', type: 'number', min: 0, value: it.amount, 'aria-label': t('amount'), oninput: e => { it.amount = +e.target.value; } }), iconBtn('trash', t('del'), () => { items.splice(i, 1); drawItems(); }))), btn(t('addItem'), { size: 'sm', icon: 'plus', onclick: () => { items.push({ head: '', amount: 0 }); drawItems(); } }));
    drawItems();
    formDialog({ title: p ? t('edit') : t('newPlan'), wide: true, fields: [{ key: 'name', label: t('name'), value: p ? p.name : '', required: true }, { key: 'due_days', label: t('dueDays'), type: 'number', min: 1, value: p ? p.due_days : '30' }, { key: 'active', label: t('status'), type: 'select', value: p ? p.active : 1, options: [{ value: 1, label: t('active') }, { value: 0, label: '—' }] }, { custom: true, node: h('div', { class: 'field' }, h('label', {}, t('feeItems')), itemBox) }],
      onSubmit: v => { const b = { name: v.name, due_days: +v.due_days || 30, active: +v.active === 1, items: items.map(i => ({ head: String(i.head).trim(), amount: +i.amount })) }; (p ? api('PUT', '/api/fees/plans/' + p.id, b) : api('POST', '/api/fees/plans', b)).then(() => { toast(t('saved')); render(); }).catch(e => toast(e.message, 'error')); } });
  };
  const genDlg = p => formDialog({ title: `${t('generateVouchers')}: ${p.name}`, desc: `${t('total')}: ${rs(p.total)}`, fields: [{ key: 'section_id', label: t('section'), type: 'select', required: true, options: lk.sections.map(s => ({ value: s.id, label: `${s.program_code} ${s.name} (${num(s.students)})` })) }, { key: 'discount', label: t('discount'), type: 'number', min: 0, value: '0' }],
    onSubmit: v => { api('POST', `/api/fees/plans/${p.id}/generate`, { section_id: +v.section_id, discount: +v.discount || 0 }).then(r => { toast(`${t('created')}: ${num(r.created)} · ${t('skipped')}: ${num(r.skipped)}`); render(); }).catch(e => toast(e.message, 'error')); } });
  body.replaceChildren(h('div', { class: 'stack-page' }, h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), btn(t('newPlan'), { v: 'primary', icon: 'plus', onclick: () => editDlg(null) })),
    plans.length ? dataTable({ cols: [{ label: t('name'), render: r => r.name }, { label: t('total'), render: r => rs(r.total) }, { label: t('feeItems'), render: r => r.items.map(i => `${i.head} ${num(i.amount)}`).join(' · ') }, { label: t('status'), render: r => (r.active ? badge('success', t('active')) : badge('neutral', '—')) },
      { label: '', render: r => h('span', { class: 'row-actions' }, btn(t('generateVouchers'), { size: 'sm', onclick: () => genDlg(r) }), iconBtn('edit', t('edit'), () => editDlg(r))) }], rows: plans }) : emptyState({ iconName: 'database', title: t('noPlans'), desc: t('noPlansDesc'), actions: btn(t('newPlan'), { v: 'primary', onclick: () => editDlg(null) }) })));
}
function importTab(body) {
  const file = h('input', { type: 'file', accept: '.csv,.txt', class: 'input', 'aria-label': t('bankFile') }), res = h('div', {});
  body.replaceChildren(h('section', { class: 'card' }, h('h2', {}, t('bankImport')), h('p', { class: 'sub' }, t('bankImportHint')), h('div', { class: 'field' }, file), btn(t('import'), { v: 'primary', icon: 'upload', onclick: async () => {
    if (!file.files[0]) { toast(t('bankFile'), 'error'); return; }
    try { const rows = parseCsv(await file.files[0].text()); const head = rows[0].map(x => String(x).trim().toLowerCase()); const hasHead = head.some(x => /voucher|number|amount/.test(x)); const ix = re => head.findIndex(x => re.test(x));
      const iN = hasHead ? ix(/voucher|number|consumer/) : 0, iA = hasHead ? ix(/amount/) : 1, iR = hasHead ? ix(/ref|trans|stan/) : 2, iD = hasHead ? ix(/date/) : 3;
      const data = (hasHead ? rows.slice(1) : rows).map(r => ({ number: String(r[iN] ?? '').trim(), amount: Number(String(r[iA] ?? '').replace(/[^\d.]/g, '')), reference: String(r[iR] ?? '').trim(), paid_on: /^\d{4}-\d{2}-\d{2}$/.test(String(r[iD] ?? '').trim()) ? String(r[iD]).trim() : undefined }));
      let applied = 0, dup = 0; const errs = []; for (let i = 0; i < data.length; i += 1000) { const r = await apiPatient('POST', '/api/fees/payments/import', { rows: data.slice(i, i + 1000), method: 'bank' }); applied += r.applied; dup += r.duplicate; r.errors.forEach(e => errs.push({ row: e.row + i, error: e.error })); }
      res.replaceChildren(h('p', {}, `${t('applied')}: ${num(applied)} · ${t('duplicates')}: ${num(dup)} · ${t('errors')}: ${num(errs.length)}`), errs.length ? h('ul', { class: 'plain-list' }, errs.slice(0, 30).map(e => h('li', {}, `#${num(e.row)}: ${e.error}`))) : null);
    } catch (e) { toast(e.message, 'error'); } } }), res));
}
async function settingsTab(body) {
  const s = await api('GET', '/api/fees/settings'); const inp = {};
  const field = (k, label, type, extra = {}) => { const el = h(type === 'textarea' ? 'textarea' : 'input', { class: 'input', id: 'fs-' + k, type: type === 'textarea' ? null : type, rows: 3, value: s[k], ...extra }); if (type === 'textarea') el.value = s[k]; inp[k] = el; return h('div', { class: 'field' }, h('label', { for: 'fs-' + k }, label), el); };
  const save = btn(t('save'), { v: 'primary', type: 'submit', icon: 'save' });
  body.replaceChildren(h('section', { class: 'card', style: 'max-width:520px' }, h('form', { onsubmit: async e => { e.preventDefault(); save.disabled = true; try { await api('PUT', '/api/fees/settings', { college_name: inp.college_name.value, late_fine_per_day: +inp.late_fine_per_day.value, late_fine_cap: +inp.late_fine_cap.value, instructions: inp.instructions.value, ...(inp.voucher_prefix.disabled ? {} : { voucher_prefix: inp.voucher_prefix.value }) }); toast(t('saved')); } catch (ex) { toast(ex.message, 'error'); } save.disabled = false; } },
    field('college_name', t('collegeName'), 'text'), field('voucher_prefix', t('voucherPrefix'), 'text', { inputmode: 'numeric', maxlength: 6 }), field('late_fine_per_day', t('lateFinePerDay'), 'number', { min: 0 }), field('late_fine_cap', t('lateFineCap'), 'number', { min: 0 }), field('instructions', t('payInstructions'), 'textarea'), save)));
  api('GET', '/api/fees/vouchers?limit=1').then(r => { if (r.total) { inp.voucher_prefix.disabled = true; inp.voucher_prefix.title = t('prefixLocked'); } }).catch(() => {});
}
