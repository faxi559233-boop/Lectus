/* Marks entry (teacher), approval (HOD/admin), published results and transcript (student). */
'use strict';
const STATE_TONE = { draft: 'neutral', submitted: 'warning', approved: 'success' };
const numOrNull = x => (x === '' || x === null || x === undefined ? null : Number(x));

/** The "Marks" tab of a course page. Returns an element that fills itself. */
function marksPanel(offeringId, user) {
  const box = h('div', { class: 'stack-page' }, h('div', { class: 'sk', style: 'height:120px' }));
  const canEdit = user.role === 'teacher' || has(user, 'exams') && user.role === 'admin';
  const canApprove = user.role === 'hod' || user.role === 'admin';
  const load = async () => {
    const d = await api('GET', `/api/offerings/${offeringId}/assessment`);
    const draft = d.state.status === 'draft', locked = !draft;
    const stBadge = badge(STATE_TONE[d.state.status], t('rs_' + d.state.status));
    const edits = new Map();                                   // "studentId:componentId" -> {obtained, absent}
    const wsum = h('span', { class: 'sub' });
    /* ----- components editor ----- */
    const compRows = d.components.length ? d.components.map(c => ({ ...c })) : [];
    const compBox = h('div', {});
    const drawComps = () => {
      const total = Math.round(compRows.reduce((a, c) => a + (Number(c.weight) || 0), 0) * 100) / 100; wsum.textContent = `${t('weightSum')}: ${num(total)} / 100`; wsum.className = 'sub ' + (total === 100 ? 'ok' : 'warn-text');
      compBox.replaceChildren(...[h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, [t('compName'), t('maxMarks'), t('weight'), ''].map(x => h('th', {}, x)))),
        h('tbody', {}, compRows.map((c, i) => h('tr', {}, ...['name', 'max_marks', 'weight'].map(k => h('td', {}, h('input', { class: 'input sm', value: c[k] ?? '', disabled: locked || !canEdit, type: k === 'name' ? 'text' : 'number', min: 0, step: 'any', 'aria-label': t(k === 'name' ? 'compName' : k === 'max_marks' ? 'maxMarks' : 'weight'), oninput: e => { c[k] = k === 'name' ? e.target.value : e.target.value === '' ? '' : Number(e.target.value); const tot = Math.round(compRows.reduce((a, x) => a + (Number(x.weight) || 0), 0) * 100) / 100; wsum.textContent = `${t('weightSum')}: ${num(tot)} / 100`; wsum.className = 'sub ' + (tot === 100 ? 'ok' : 'warn-text'); } }))),
          h('td', {}, locked || !canEdit ? null : iconBtn('trash', t('del'), () => { compRows.splice(i, 1); drawComps(); }))))))),
        locked || !canEdit ? null : h('div', { class: 'toolbar' }, btn(t('addComponent'), { size: 'sm', icon: 'plus', onclick: () => { compRows.push({ name: '', max_marks: 100, weight: 10 }); drawComps(); } }),
          btn(t('presetComps'), { size: 'sm', onclick: () => { compRows.splice(0, compRows.length, { name: 'Sessional', max_marks: 15, weight: 15 }, { name: 'Mid', max_marks: 25, weight: 25 }, { name: 'Final', max_marks: 60, weight: 60 }); drawComps(); } }),
          h('span', { class: 'grow' }), wsum, btn(t('saveComps'), { v: 'primary', size: 'sm', icon: 'save', onclick: async () => {
            try { await api('PUT', `/api/offerings/${offeringId}/components`, { components: compRows.map(c => ({ name: String(c.name).trim(), max_marks: Number(c.max_marks), weight: Number(c.weight) })) }); toast(t('saved')); render(); } catch (e) { toast(e.message, 'error'); } } }))].filter(Boolean));
    };
    drawComps();
    /* ----- marks grid ----- */
    const cell = (row, c) => {
      const m = row.marks[c.id]; const key = row.id + ':' + c.id;
      const inp = h('input', { class: 'input sm mark', type: 'number', min: 0, max: c.max_marks, step: 'any', value: m && !m.absent && m.obtained !== null ? m.obtained : '', disabled: locked || !canEdit, 'aria-label': `${row.roll} ${c.name}`,
        oninput: () => { const cur = edits.get(key) || { absent: !!(m && m.absent) }; edits.set(key, { ...cur, obtained: numOrNull(inp.value), absent: ab.checked }); } });
      const ab = h('input', { type: 'checkbox', checked: !!(m && m.absent), disabled: locked || !canEdit, 'aria-label': `${t('absentShort')} ${row.roll} ${c.name}`, onchange: () => { edits.set(key, { obtained: numOrNull(inp.value), absent: ab.checked }); if (ab.checked) inp.value = ''; } });
      return h('td', { class: 'markcell' }, inp, h('label', { class: 'ab', title: t('absent') }, ab, 'AB'));
    };
    const grid = d.rows.length && d.components.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table marks-table' },
      h('thead', {}, h('tr', {}, h('th', {}, t('roll')), h('th', {}, t('name')), ...d.components.map(c => h('th', {}, `${c.name} (${num(c.max_marks)})`)), h('th', {}, t('total')), h('th', {}, t('grade')), h('th', {}, t('attPct')))),
      h('tbody', {}, d.rows.map(row => h('tr', {}, h('td', {}, row.roll), h('td', {}, row.name), ...d.components.map(c => cell(row, c)), h('td', {}, h('b', {}, num(row.total)), row.missing ? h('span', { class: 'sub' }, ` · ${tf('missingN', { n: num(row.missing) })}`) : null),
        h('td', {}, row.grade ?? '—'), h('td', { class: 'nowrap' }, pctTxt(row.att_pct), ' ', row.eligible ? null : badge('danger', t('notEligible')))))))) : emptyState({ iconName: 'chart', title: d.components.length ? t('noStudents') : t('setComponentsFirst'), compact: true });
    const act = async (path, body, okMsg) => { try { await api('POST', `/api/offerings/${offeringId}/results/${path}`, body || {}); toast(okMsg); render(); } catch (e) { toast(e.message, 'error'); } };
    const saveMarks = async () => {
      const entries = [...edits].map(([k, m]) => { const [sid, cid] = k.split(':').map(Number); return { student_id: sid, component_id: cid, obtained: m.absent ? null : m.obtained, absent: !!m.absent }; });
      if (!entries.length) { toast(t('saved')); return; }
      try { await apiPatient('PUT', `/api/offerings/${offeringId}/marks`, { op_id: uid() + uid(), entries }); toast(t('saved')); render(); } catch (e) { toast(e.network ? t('offlineMsg') : e.message, 'error'); }
    };
    const bar = h('div', { class: 'toolbar' }, stBadge, d.state.note ? h('span', { class: 'sub' }, d.state.note) : null, h('span', { class: 'grow' }),
      btn(t('exportCsv'), { size: 'sm', icon: 'download', onclick: () => downloadFile(`/api/offerings/${offeringId}/results.csv`, 'results.csv') }),
      draft && canEdit ? btn(t('saveMarks'), { size: 'sm', icon: 'save', onclick: saveMarks }) : null,
      draft && canEdit ? btn(t('submitResults'), { v: 'primary', size: 'sm', onclick: async () => { await saveMarks(); act('submit', {}, t('submitted')); } }) : null,
      d.state.status === 'submitted' && canApprove ? [btn(t('sendBack'), { size: 'sm', onclick: () => formDialog({ title: t('sendBack'), fields: [{ key: 'note', label: t('reason'), type: 'textarea', rows: 3, required: true }], onSubmit: v => { act('reject', { note: v.note }, t('saved')); } }) }),
        btn(t('publishResults'), { v: 'primary', size: 'sm', icon: 'check', onclick: () => confirmDialog({ title: t('publishResults'), desc: t('publishAsk'), confirm: t('publishResults'), danger: false, onConfirm: () => act('approve', {}, t('published')) }) })] : null,
      d.state.status === 'approved' && user.role === 'admin' ? btn(t('reopenResults'), { size: 'sm', onclick: () => formDialog({ title: t('reopenResults'), fields: [{ key: 'reason', label: t('reason'), type: 'textarea', rows: 3, required: true }], onSubmit: v => { act('reopen', { reason: v.reason }, t('saved')); } }) }) : null);
    box.replaceChildren(h('section', { class: 'card' }, h('h2', {}, t('marks')), bar, h('p', { class: 'sub' }, t('marksHint'))), h('section', { class: 'card' }, h('h3', {}, t('components')), compBox), h('section', { class: 'card' }, grid));
  };
  load().catch(e => box.replaceChildren(errorState(t('loadFailed'), errMsg(e), () => render())));
  return box;
}

async function downloadFile(url, name) {
  try { const res = await fetch(url, { credentials: 'same-origin', headers: { 'x-gmc': '1' } }); if (!res.ok) throw new Error(res.statusText); const blob = await res.blob(); const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); }
  catch (e) { toast(e.message, 'error'); }
}

/** Result tables shared by the student's own page and the staff transcript. */
function resultTables(d) {
  const out = h('div', { class: 'stack-page printable' });
  if (!d.terms.length) { out.append(emptyState({ iconName: 'cap', title: t('noResults'), desc: t('noResultsDesc') })); return out; }
  out.append(h('div', { class: 'stats' }, statCard({ label: 'CGPA', value: d.cgpa === null ? '—' : num(d.cgpa.toFixed(2)), iconName: 'cap' }), statCard({ label: t('creditsEarned'), value: num(d.credits), iconName: 'book' })));
  for (const term of d.terms) out.append(h('section', { class: 'card' }, h('div', { class: 'toolbar' }, h('h2', {}, term.term), h('span', { class: 'grow' }), h('b', {}, `GPA ${term.gpa === null ? '—' : num(term.gpa.toFixed(2))}`)),
    dataTable({ cols: [{ label: t('course'), render: r => h('span', {}, h('b', {}, r.code), ' ', h('span', { class: 'sub' }, r.name)) }, { label: t('credits'), render: r => num(r.credits) }, { label: t('total'), render: r => num(r.total) }, { label: t('grade'), render: r => h('b', {}, r.grade ?? '—') }, { label: 'GP', render: r => (r.gp === null ? '—' : num(r.gp.toFixed(2))) },
      { label: '', render: r => (r.eligible ? null : badge('danger', t('notEligible'))) }], rows: term.courses })));
  return out;
}
route('/results', ['student'], async () => {
  const d = await api('GET', '/api/my/results');
  return h('div', { class: 'stack-page' }, pageHeader({ title: t('nResults'), desc: h('span', {}, h('bdi', {}, d.student.roll), ' · ', d.student.name), actions: btn(t('print'), { icon: 'download', onclick: () => window.print() }) }),
    h('p', { class: 'notice' }, t('resultsNotice')), resultTables(d));
});
route('/transcript/:id', ['admin', 'hod'], async id => {
  const d = await api('GET', `/api/students/${id}/transcript`);
  return h('div', { class: 'stack-page' }, pageHeader({ crumbs: [{ label: t('nStudents'), href: '#/admin/students' }, { label: d.student.roll }], title: d.student.name, desc: h('span', {}, h('bdi', {}, d.student.roll), d.student.program ? ' · ' + d.student.program : ''), actions: btn(t('print'), { icon: 'download', onclick: () => window.print() }) }), resultTables(d));
});
