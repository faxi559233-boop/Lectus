/* Timetable (weekly grid, clash check) and term rollover. */
'use strict';
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const endTime = (start, mins) => { const [h_, m] = start.split(':').map(Number); const t_ = h_ * 60 + m + (mins || 60); return String(Math.floor(t_ / 60) % 24).padStart(2, '0') + ':' + String(t_ % 60).padStart(2, '0'); };
route('/timetable', ['student', 'teacher', 'hod', 'admin'], async () => {
  const list = await api('GET', '/api/timetable'); const staff = P.user.role === 'hod' || P.user.role === 'admin';
  const out = h('div', { class: 'stack-page' }, pageHeader({ title: t('nTimetable'), actions: staff ? btn(t('checkClashes'), { icon: 'alert', onclick: checkClashes }) : null }));
  if (!list.length) { out.append(emptyState({ iconName: 'calendar', title: t('noTimetable'), desc: t('noTimetableDesc') })); return out; }
  for (const d of DAY_ORDER) {
    const rows = list.filter(o => o.days.split(',').map(Number).includes(d)).sort((a, b) => a.start_time.localeCompare(b.start_time)); if (!rows.length) continue;
    out.append(h('section', { class: 'card' }, h('h2', {}, weekdayShort(d)), h('ul', { class: 'plain-list tt' }, rows.map(o => h('li', {}, h('b', { class: 'nowrap' }, `${num(o.start_time)}–${num(endTime(o.start_time, o.duration_min))}`), h('span', {}, h('b', {}, o.course_code), ' ', o.course_name), h('span', { class: 'sub' }, dotted([o.section_name, o.room, P.user.role === 'student' || staff ? o.teacher_name : null])))))));
  }
  return out;
});
async function checkClashes() {
  try {
    const c = await api('GET', '/api/admin/timetable/clashes');
    sheetDialog(t('checkClashes'), c.length ? h('ul', { class: 'plain-list' }, c.slice(0, 80).map(x => h('li', {}, badge('danger', t('clash_' + x.kind)), ` ${x.a.label} (${x.a.start}) ↔ ${x.b.label} (${x.b.start}) · ${x.days.map(d => weekdayShort(+d)).join(', ')} · ${x.who || ''}`))) : h('p', {}, t('noClashes')));
  } catch (e) { toast(e.message, 'error'); }
}
async function rolloverDialog() {
  const terms = await api('GET', '/api/admin/terms'); const opts = terms.map(x => ({ value: x.id, label: x.name }));
  formDialog({ title: t('rollover'), desc: t('rolloverHint'), fields: [{ key: 'from_term_id', label: t('fromTerm'), type: 'select', options: opts }, { key: 'to_term_id', label: t('toTerm'), type: 'select', options: opts, value: opts[0] && opts[0].value }],
    onSubmit: v => { confirmDialog({ title: t('rollover'), desc: t('rolloverAsk'), confirm: t('rollover'), danger: false, onConfirm: () => api('POST', '/api/admin/rollover', { from_term_id: +v.from_term_id, to_term_id: +v.to_term_id }).then(r => { toast(`${t('sections')}: ${num(r.sections)} · ${t('nStudents')}: ${num(r.students)} · ${t('graduated')}: ${num(r.graduated)}`); render(); }).catch(e => toast(e.message, 'error')) }); } });
}
