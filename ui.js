/* Reusable UI primitives: DOM helper, toast, modals, form fields, buttons, badges, tables, charts. */
'use strict';

/* ---------- DOM helper ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(k));
  }
  return el;
}

/* ---------- toast ---------- */
function toast(msg, type = 'success', action) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); };
  const el = h('div', { class: 'toast ' + type }, icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check', 18), h('span', {}, msg),
    action ? h('button', { class: 'toast-action', onclick: () => { close(); action.fn(); } }, action.label) : null);
  box.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(close, action ? 7000 : type === 'error' ? 4500 : 2600);
}

/* ---------- buttons ---------- */
function btn(label, o = {}) {
  const b = h(o.href ? 'a' : 'button', {
    class: ['btn', o.v || 'secondary', o.size || '', o.iconOnly ? 'icon-only' : '', o.cls || ''].filter(Boolean).join(' '),
    type: o.href ? null : (o.type || 'button'), href: o.href, onclick: o.onclick, disabled: o.disabled,
    title: o.title, 'aria-label': o.iconOnly ? (o.title || label) : null
  }, o.icon ? icon(o.icon, o.size === 'sm' ? 16 : 18, o.flip ? 'flip' : '') : null, o.iconOnly ? null : h('span', {}, label));
  return b;
}
const iconBtn = (name, title, onclick, cls) => btn(title, { v: 'ghost', icon: name, iconOnly: true, title, onclick, cls });

/* ---------- modal / sheet ---------- */
function openDialog(cls) {
  const d = h('dialog', { class: 'modal ' + (cls || '') });
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('mousedown', e => { if (e.target === d) d.close(); });
  return d;
}
function modalShell(d, title, desc, body, footer) {
  const id = 'dlg-' + uid();
  d.setAttribute('aria-labelledby', id);
  d.append(
    h('div', { class: 'modal-head' }, h('div', {}, h('h2', { id }, title), desc ? h('p', { class: 'sub' }, desc) : null),
      iconBtn('x', t('close'), () => d.close())),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null);
}

/* fields: [{key,label,type,required,help,placeholder,value,options,rows}] ; onSubmit(values) -> {key:error}|undefined */
function formDialog({ title, desc, fields, submit, onSubmit, extra, wide }) {
  const d = openDialog(wide ? 'wide' : '');
  const inputs = {}, errEls = {};
  const form = h('form', { novalidate: true });
  const real = fields.filter(f => !f.custom);
  fields.forEach(f => {
    if (f.custom) { form.append(f.node); return; }
    let el;
    const common = { id: 'f-' + f.key, name: f.key, placeholder: f.placeholder, 'aria-describedby': 'e-' + f.key, class: 'input' };
    if (f.type === 'days') {
      el = h('input', Object.assign({ type: 'hidden', value: f.value || '' }, { id: common.id }));
      const set = new Set(String(f.value || '').split(',').filter(Boolean));
      const wrap = h('div', { class: 'daypick', role: 'group', 'aria-label': f.label }, [1, 2, 3, 4, 5, 6, 0].map(d => {
        const b = h('button', { type: 'button', class: 'daychip' + (set.has(String(d)) ? ' on' : ''), 'aria-pressed': String(set.has(String(d))),
          onclick: () => { set.has(String(d)) ? set.delete(String(d)) : set.add(String(d)); b.classList.toggle('on'); b.setAttribute('aria-pressed', String(set.has(String(d)))); el.value = [...set].join(','); } }, weekdayShort(d));
        return b;
      }));
      inputs[f.key] = el; errEls[f.key] = h('p', { class: 'field-error', id: 'e-' + f.key });
      form.append(h('div', { class: 'field' }, h('label', {}, f.label), wrap, f.help ? h('p', { class: 'help' }, f.help) : null, el));
      return;
    }
    if (f.type === 'select') el = h('select', common, f.options.map(o => h('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
    else if (f.type === 'textarea') el = h('textarea', Object.assign({ rows: f.rows || 6 }, common), f.value || '');
    else el = h('input', Object.assign({ type: f.type || 'text', value: f.value ?? '', min: f.min, max: f.max, inputmode: f.inputmode, autocomplete: 'off' }, common));
    inputs[f.key] = el;
    errEls[f.key] = h('p', { class: 'field-error', id: 'e-' + f.key });
    form.append(h('div', { class: 'field' },
      h('label', { for: 'f-' + f.key }, f.label, f.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
      el, f.help ? h('p', { class: 'help' }, f.help) : null, errEls[f.key]));
    if (f.node) form.append(f.node);
  });
  form.append(h('button', { type: 'submit', hidden: true, tabindex: -1 }));
  const submitEl = btn(submit || t('save'), { v: 'primary' });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const vals = {}, errs = {};
    real.forEach(f => { vals[f.key] = (inputs[f.key].value || '').trim(); if (f.required && !vals[f.key]) errs[f.key] = t('errRequired'); });
    const more = Object.keys(errs).length ? null : onSubmit(vals);
    Object.assign(errs, more || {});
    real.forEach(f => { errEls[f.key].textContent = errs[f.key] || ''; inputs[f.key].setAttribute('aria-invalid', errs[f.key] ? 'true' : 'false'); });
    const first = real.find(f => errs[f.key]);
    if (first) inputs[first.key].focus(); else d.close();
  });
  modalShell(d, title, desc, form, [extra ? extra(d) : null, h('span', { class: 'grow' }), btn(t('cancel'), { v: 'ghost', onclick: () => d.close() }), submitEl].filter(Boolean));
  submitEl.addEventListener('click', e => { e.preventDefault(); form.requestSubmit(); });
  d.showModal();
  const firstInput = form.querySelector('input,textarea,select'); if (firstInput) setTimeout(() => firstInput.focus(), 40);
  return d;
}

function confirmDialog({ title, desc, confirm, danger = true, onConfirm }) {
  const d = openDialog('narrow');
  modalShell(d, title, null, h('p', { class: 'sub-lg' }, desc), [
    h('span', { class: 'grow' }), btn(t('cancel'), { v: 'ghost', onclick: () => d.close() }),
    btn(confirm || t('delete'), { v: danger ? 'danger' : 'primary', onclick: () => { d.close(); onConfirm(); } })]);
  d.showModal();
  return d;
}

function sheetDialog(title, body) {
  const d = openDialog('sheet');
  modalShell(d, title, null, body, null);
  d.showModal();
  return d;
}

/* ---------- display components ---------- */
function badge(tone, label, iconName) { return h('span', { class: 'badge ' + tone }, iconName ? icon(iconName, 12) : null, label); }

function avatar(name, size) {
  const initials = (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const hue = [...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  return h('span', { class: 'avatar h' + hue + (size ? ' ' + size : ''), 'aria-hidden': 'true' }, initials);
}

function emptyState({ iconName, title, desc, actions, compact }) {
  return h('div', { class: 'empty' + (compact ? ' compact' : '') },
    h('div', { class: 'empty-ic' }, icon(iconName || 'info', 22)),
    h(compact ? 'h3' : 'h2', {}, title), desc ? h('p', {}, desc) : null,
    actions ? h('div', { class: 'empty-actions' }, actions) : null);
}

function errorState(title, desc, onRetry) {
  return h('div', { class: 'empty error' }, h('div', { class: 'empty-ic' }, icon('alert', 22)), h('h3', {}, title), h('p', {}, desc),
    onRetry ? h('div', { class: 'empty-actions' }, btn(t('retry'), { v: 'primary', icon: 'refresh', onclick: onRetry })) : null);
}

function statCard({ label, value, hint, iconName, tone }) {
  return h('div', { class: 'card stat' },
    h('div', { class: 'stat-top' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-ic ' + (tone || '') }, icon(iconName, 16))),
    h('div', { class: 'stat-value' }, value), hint ? h('div', { class: 'stat-hint' }, hint) : null);
}

function progress(pct, tone) {
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct === null ? 0 : Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('i', { class: tone || '', style: `width:${pct === null ? 0 : Math.max(2, pct)}%` }));
}

function pageHeader({ crumbs, title, desc, actions }) {
  return h('header', { class: 'page-header' },
    crumbs ? h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, crumbs.flatMap((c, i) => [i ? icon('chevronRight', 14, 'sep flip') : null, c.href ? h('a', { href: c.href }, c.label) : h('span', { 'aria-current': 'page' }, c.label)])) : null,
    h('div', { class: 'ph-row' }, h('div', { class: 'ph-text' }, h('h1', {}, title), desc ? h('p', { class: 'sub' }, desc) : null),
      actions ? h('div', { class: 'ph-actions' }, actions) : null));
}

function searchInput(value, placeholder, oninput) {
  return h('label', { class: 'search' }, icon('search', 16), h('input', { type: 'search', class: 'input', value, placeholder, 'aria-label': placeholder, oninput }));
}

function selectInput(value, options, onchange, label) {
  return h('select', { class: 'input select', 'aria-label': label, onchange: e => onchange(e.target.value) },
    options.map(o => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
}

/* cols: [{label, render(row), cls, sort}] ; renders a table that stacks into cards on small screens */
function dataTable({ cols, rows, onRow, sortKey, sortDir, onSort }) {
  const head = h('tr', {}, cols.map(c => {
    const th = h('th', { scope: 'col', class: c.cls || '', 'aria-sort': c.sort && sortKey === c.sort ? (sortDir === 'asc' ? 'ascending' : 'descending') : null },
      c.sort ? h('button', { class: 'th-sort', onclick: () => onSort(c.sort) }, c.label, sortKey === c.sort ? icon('chevronDown', 14, sortDir === 'asc' ? 'up' : '') : null) : c.label);
    return th;
  }));
  const body = rows.map(r => h('tr', {
    class: onRow ? 'clickable' : '', tabindex: onRow ? 0 : null,
    onclick: onRow ? () => onRow(r) : null,
    onkeydown: onRow ? e => { if (e.key === 'Enter' && e.target === e.currentTarget) onRow(r); } : null
  }, cols.map(c => h('td', { 'data-label': c.label, class: c.cls || '' }, c.render(r)))));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table stack' }, h('thead', {}, head), h('tbody', {}, body)));
}

function pager(total, page, size, onPage) {
  if (total <= size) return null;
  const pages = Math.ceil(total / size), from = (page - 1) * size + 1, to = Math.min(total, page * size);
  return h('div', { class: 'pager' },
    h('span', { class: 'sub' }, `${num(from)}–${num(to)} ${t('of')} ${num(total)}`),
    h('div', { class: 'pager-btns' },
      btn(t('prev'), { v: 'secondary', size: 'sm', icon: 'chevronLeft', flip: true, disabled: page <= 1, onclick: () => onPage(page - 1) }),
      h('span', { class: 'sub' }, `${num(page)} / ${num(pages)}`),
      btn(t('next'), { v: 'secondary', size: 'sm', disabled: page >= pages, onclick: () => onPage(page + 1) })));
}

/* ---------- charts (inline SVG / CSS) ---------- */
function lineChart(points, minLine) {
  const W = 640, H = 230, L = 40, R = 14, T = 14, B = 30;
  const x = i => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = v => T + (1 - v / 100) * (H - T - B);
  const grid = [0, 25, 50, 75, 100].map(g => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="grid"/><text x="${L - 8}" y="${y(g) + 4}" text-anchor="end" class="axis">${num(g)}</text>`).join('');
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  const area = points.length > 1 ? `<path d="M${x(0).toFixed(1)},${y(0)} L${pts.join(' L')} L${x(points.length - 1).toFixed(1)},${y(0)} Z" class="area"/>` : '';
  const line = points.length > 1 ? `<polyline points="${pts.join(' ')}" class="line"/>` : '';
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" class="dot"><title>${p.label}: ${num(Math.round(p.value))}%</title></circle>`).join('');
  const idx = points.length <= 3 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const labels = idx.map(i => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis">${points[i].label}</text>`).join('');
  const minL = minLine ? `<line x1="${L}" x2="${W - R}" y1="${y(minLine)}" y2="${y(minLine)}" class="minline"/>` : '';
  return h('div', { class: 'chart', role: 'img', 'aria-label': t('trendChart'), html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${minL}${area}${line}${dots}${labels}</svg>` });
}

function distributionBar(P, A, L, T = 0) {
  const total = P + A + L + T;
  const seg = (n, cls) => (n ? h('i', { class: cls, style: `width:${(n / total) * 100}%`, title: String(n) }) : null);
  return h('div', {},
    h('div', { class: 'dist', role: 'img', 'aria-label': t('distribution') }, total ? [seg(P, 'p'), seg(T, 't'), seg(L, 'l'), seg(A, 'a')] : h('i', { class: 'none', style: 'width:100%' })),
    h('ul', { class: 'legend' },
      [['p', t('present'), P], ['t', t('late'), T], ['a', t('absent'), A], ['l', t('leave'), L]].map(([c, l, n]) =>
        h('li', {}, h('span', { class: 'dot ' + c }), h('span', {}, l), h('b', {}, num(n), total ? h('em', {}, ` ${num(Math.round((n / total) * 100))}%`) : null)))));
}

/* Calendar heatmap: last `weeks` weeks, Monday-first columns. cells: {'YYYY-MM-DD': {cls, title}} */
function heatmap(cells, legend, weeks = 16) {
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const dow = (end.getDay() + 6) % 7; // Monday=0
  const start = new Date(end); start.setDate(end.getDate() - dow - (weeks - 1) * 7);
  const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const grid = h('div', { class: 'heat', role: 'img', 'aria-label': t('calendar') });
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = iso(d), c = cells[key], future = d > end;
    grid.append(h('i', { class: 'hc ' + (future ? 'future' : c ? c.cls : ''), title: key + (c ? ' · ' + c.title : '') }));
  }
  return h('div', {}, grid, h('ul', { class: 'legend row' }, legend.map(([cls, label]) => h('li', {}, h('span', { class: 'dot hc ' + cls }), h('span', {}, label)))));
}
