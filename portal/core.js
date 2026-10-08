/* Portal core: state, i18n helpers, API client, router, app shell, sign-in, notifications and push. */
'use strict';
const P = { user: null, lang: (() => { try { return localStorage.getItem('gmc-lang') || 'en'; } catch { return 'en'; } })(), unread: 0, loginMsg: '' };
const lang = () => P.lang;
const t = k => (I18N[P.lang] && I18N[P.lang][k]) || I18N.en[k] || k;
const tf = (k, o) => Object.entries(o).reduce((s, [a, b]) => s.replace('{' + a + '}', b), t(k));
const num = n => (P.lang === 'ur' ? String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]) : String(n));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const weekdayShort = d => new Date(2024, 0, 7 + d).toLocaleDateString(P.lang === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'short' });
const fmtDate = d => (d ? num(new Date(d + 'T00:00:00').toLocaleDateString(P.lang === 'ur' ? 'ur-PK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })) : '—');
const fmtTime = ms => (ms ? num(new Date(ms).toLocaleString(P.lang === 'ur' ? 'ur-PK' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })) : t('never'));
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const pctTxt = p => (p === null || p === undefined ? '—' : num(Math.round(p * 10) / 10) + '%');
const TONE = { ok: 'success', warn: 'warning', bad: 'danger', none: 'neutral' };
const STATUS_KEY = { ok: 'stGood', warn: 'stWarning', bad: 'stShortage', none: 'stNoData' };
const statusBadge = s => badge(TONE[s] || 'neutral', t(STATUS_KEY[s] || 'stNoData'));
const toneCls = s => ({ ok: 'success', warn: 'warning', bad: 'danger' }[s] || '');
const outlookTxt = o => (!o ? '—' : o.need !== undefined ? tf('needNext', { n: num(o.need), m: '' }).replace(/\s*%?\s*$/, '').replace(/ to reach\s*$/, '') : tf('canMiss', { n: num(o.spare) }));
const dotted = parts => parts.filter(Boolean).flatMap((p, i) => [i ? ' · ' : null, h('bdi', {}, p)]);

/* ---------- API client ---------- */
class ApiError extends Error { constructor(status, code, message, retryAfter) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter; } }
async function api(method, path, body) {
  let res;
  try { res = await fetch(path, { method, credentials: 'same-origin', headers: { 'x-gmc': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { const err = new ApiError(0, 'network', t('offlineMsg')); err.network = true; throw err; }
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) { const e = new ApiError(res.status, json && json.error && json.error.code, (json && json.error && json.error.message) || res.statusText, +res.headers.get('retry-after') || 0); throw e; }
  return json;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Retries politely when the server says it is busy (503). */
async function apiPatient(method, path, body, tries = 4) {
  for (let i = 0; ; i++) { try { return await api(method, path, body); } catch (e) { if (e.status === 503 && i < tries) { toast(t('busyRetry'), 'info'); await sleep((e.retryAfter || 10) * 1000 + Math.random() * 3000); continue; } throw e; } }
}
const errMsg = e => (e && e.message) || t('loadFailed');

/* ---------- router ---------- */
const ROUTES = [];
function route(pattern, roles, fn) { ROUTES.push({ re: new RegExp('^' + pattern.replace(/:[a-z_]+/g, '([^/]+)') + '/?$'), roles, fn }); }
const go = p => { location.hash = '#' + p; };
const HOME = { student: '/me', teacher: '/courses', hod: '/dept', admin: '/admin' };
const NAV = {
  student: [['/me', 'dashboard', 'nHome'], ['/inbox', 'message', 'nInbox']],
  teacher: [['/courses', 'attendance', 'nCourses'], ['/inbox', 'message', 'nInbox']],
  hod: [['/dept', 'chart', 'nDept'], ['/courses', 'attendance', 'nAllCourses'], ['/inbox', 'message', 'nInbox']],
  admin: [['/admin', 'dashboard', 'nOverview'], ['/admin/structure', 'building', 'nStructure'], ['/admin/students', 'users', 'nStudents'], ['/admin/users', 'user', 'nUsers'], ['/courses', 'attendance', 'nAllCourses'], ['/dept', 'chart', 'nDept'], ['/admin/audit', 'database', 'nAudit'], ['/admin/settings', 'settings', 'nSettings']]
};
function applyPrefs() { document.documentElement.lang = P.lang; document.documentElement.dir = P.lang === 'ur' ? 'rtl' : 'ltr'; document.documentElement.dataset.theme = 'light'; }

/* ---------- shell ---------- */
function shell(active) {
  const items = NAV[P.user.role];
  const main = h('main', { class: 'content', id: 'main', tabindex: -1 }, h('div', { class: 'sk', style: 'height:30px;width:240px;margin-bottom:14px' }), h('div', { class: 'sk', style: 'height:140px' }));
  const link = ([to, ic, key]) => h('a', { href: '#' + to, class: 'nav-item' + (active === to ? ' active' : ''), 'aria-current': active === to ? 'page' : null }, icon(ic, 19), h('span', { class: 'nav-label' }, t(key)));
  const bell = h('button', { class: 'iconbtn bell btn ghost icon-only', 'aria-label': t('nInbox'), onclick: () => go('/inbox') }, icon('message', 20), P.unread ? h('span', { class: 'count' }, num(Math.min(P.unread, 99))) : null);
  const side = h('aside', { class: 'sidebar', 'aria-label': 'Primary' },
    h('a', { class: 'brand', href: '#' + HOME[P.user.role] }, h('img', { class: 'logo', src: '/icons/logo.jpg', alt: '', width: 32, height: 32 }), h('span', { class: 'brand-name' }, t('pTitle'))),
    h('nav', { class: 'nav' }, items.map(link)),
    h('div', { class: 'sidebar-foot' }, h('button', { class: 'profile', onclick: userMenu }, avatar(P.user.name), h('span', { class: 'profile-text' }, h('b', {}, P.user.name), h('small', {}, P.user.role)))));
  const top = h('header', { class: 'topbar' }, h('a', { class: 'brand mobile-brand', href: '#' + HOME[P.user.role], 'aria-label': t('pTitle') }, h('img', { class: 'logo', src: '/icons/logo.jpg', alt: '', width: 32, height: 32 })), h('b', { class: 'mobile-title' }, t('pTitle')), h('span', { class: 'grow' }), bell,
    h('button', { class: 'top-avatar-btn btn ghost icon-only', 'aria-label': t('signedInAs'), onclick: userMenu }, avatar(P.user.name)));
  const bottom = h('nav', { class: 'bottom-nav', 'aria-label': 'Mobile' }, items.slice(0, 4).map(([to, ic, key]) => h('a', { href: '#' + to, class: active === to ? 'active' : '' }, icon(ic, 22), h('span', {}, t(key)))),
    items.length > 4 ? h('button', { onclick: () => { const d = sheetDialog(t('nHome'), h('div', { class: 'sheet-list' }, items.slice(3).map(([to, ic, key]) => h('a', { href: '#' + to, onclick: () => d.close() }, icon(ic, 20), h('span', {}, t(key)), icon('chevronRight', 16, 'flip'))))); } }, icon('more', 22), h('span', {}, '…')) : h('button', { onclick: userMenu }, icon('user', 22), h('span', {}, t('signOut'))));
  const el = h('div', { class: 'shell', 'data-collapsed': window.innerWidth < 1024 }, side, h('div', { class: 'main' }, top, main), bottom);
  return { el, main };
}
function userMenu() {
  const d = sheetDialog(P.user.name, h('div', {},
    h('p', { class: 'sub' }, `${t('signedInAs')} ${P.user.email}`),
    h('div', { class: 'pill-row' }, h('span', {}, t('language') + ':'), ...[['en', 'English'], ['ur', 'اردو']].map(([c, l]) => btn(l, { v: P.lang === c ? 'primary' : 'secondary', size: 'sm', onclick: () => { P.lang = c; try { localStorage.setItem('gmc-lang', c); } catch { /* ignore */ } d.close(); render(); } }))),
    h('div', { class: 'pill-row' }, btn(t('enablePush'), { icon: 'message', onclick: () => enablePush(d) })),
    h('div', { class: 'pill-row' }, btn(t('signOut'), { v: 'danger-ghost', onclick: async () => { try { await api('POST', '/api/auth/logout', {}); } catch { /* ignore */ } P.user = null; d.close(); location.hash = '#/'; render(); } }))));
}

/* ---------- sign-in ---------- */
function loginView() {
  const err = h('p', { class: 'field-error', role: 'alert' }, P.loginMsg); P.loginMsg = '';
  const id = h('input', { class: 'input', id: 'login-id', name: 'id', autocomplete: 'username', autocapitalize: 'none', required: true, placeholder: t('loginId') });
  const pw = h('input', { class: 'input', id: 'login-pw', name: 'pw', type: 'password', autocomplete: 'current-password', required: true });
  const sub = btn(t('signIn'), { v: 'primary', type: 'submit' });
  const form = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; if (!id.value.trim() || !pw.value) { err.textContent = t('errRequired'); return; }
    sub.disabled = true;
    try { const r = await apiPatient('POST', '/api/auth/login', { email: id.value.trim(), password: pw.value }); P.user = r.user; if (!r.user.must_change) location.hash = '#' + HOME[r.user.role]; await refreshUnread(); render(); }
    catch (ex) { err.textContent = ex.message; sub.disabled = false; pw.value = ''; pw.focus(); }
  } },
    h('div', { class: 'field' }, h('label', { for: 'login-id' }, t('loginId')), id), h('div', { class: 'field' }, h('label', { for: 'login-pw' }, t('password')), pw), err, h('p', { class: 'help', style: 'margin-bottom:12px' }, t('loginHint')), sub);
  return h('main', { class: 'login-wrap' }, h('div', { class: 'card login-card' }, h('div', { class: 'brandrow' }, h('img', { class: 'logo', src: '/icons/logo.jpg', alt: '' }), h('div', {}, h('h1', {}, t('pTitle')), h('p', { class: 'sub' }, t('signIn')))), form,
    h('div', { class: 'pill-row', style: 'margin-top:14px;justify-content:center' }, ...[['en', 'English'], ['ur', 'اردو']].map(([c, l]) => btn(l, { v: P.lang === c ? 'secondary' : 'ghost', size: 'sm', onclick: () => { P.lang = c; try { localStorage.setItem('gmc-lang', c); } catch { /* ignore */ } render(); } })))));
}
function changePwView() {
  const err = h('p', { class: 'field-error', role: 'alert' });
  const f = (id, label, ac) => h('input', { class: 'input', id, type: 'password', autocomplete: ac, required: true, 'aria-label': label });
  const cur = f('cp-cur', t('currentPw'), 'current-password'), n1 = f('cp-n1', t('newPw'), 'new-password'), n2 = f('cp-n2', t('confirmPw'), 'new-password');
  const sub = btn(t('savePw'), { v: 'primary', type: 'submit' });
  const form = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; if (n1.value !== n2.value) { err.textContent = t('pwMismatch'); return; }
    sub.disabled = true;
    try { await apiPatient('POST', '/api/auth/change-password', { current: cur.value, new: n1.value }); P.user.must_change = false; toast(t('saved')); location.hash = '#' + HOME[P.user.role]; render(); }
    catch (ex) { err.textContent = ex.message; sub.disabled = false; }
  } }, h('div', { class: 'field' }, h('label', { for: 'cp-cur' }, t('currentPw')), cur), h('div', { class: 'field' }, h('label', { for: 'cp-n1' }, t('newPw')), n1), h('div', { class: 'field' }, h('label', { for: 'cp-n2' }, t('confirmPw')), n2), err, sub);
  return h('main', { class: 'login-wrap' }, h('div', { class: 'card login-card' }, h('h1', {}, t('mustChangeTitle')), h('p', { class: 'sub', style: 'margin:6px 0 16px' }, t('mustChangeDesc')), form,
    h('div', { style: 'margin-top:12px;text-align:center' }, btn(t('signOut'), { v: 'ghost', size: 'sm', onclick: async () => { try { await api('POST', '/api/auth/logout', {}); } catch { /* ignore */ } P.user = null; render(); } }))));
}

/* ---------- notifications & push ---------- */
async function refreshUnread() { try { P.unread = (await api('GET', '/api/notifications')).unread; } catch { /* offline */ } }
const urlB64 = s => { const p = '='.repeat((4 - (s.length % 4)) % 4), b = (s + p).replace(/-/g, '+').replace(/_/g, '/'), r = atob(b); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
async function enablePush(dlg) {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { toast(isIos && !standalone ? t('pushIosHint') : t('pushUnsupported'), 'info'); return; }
  try {
    const perm = await Notification.requestPermission(); if (perm !== 'granted') { toast(t('pushDenied'), 'error'); return; }
    const key = (await api('GET', '/api/push/key')).key; if (!key) { toast(t('pushFail'), 'error'); return; }
    const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
    await api('POST', '/api/push/subscribe', sub.toJSON()); toast(t('pushOn')); if (dlg) dlg.close();
  } catch (e) { console.error(e); toast(t('pushFail'), 'error'); }
}

/* ---------- render loop ---------- */
let renderToken = 0;
async function render() {
  const app = document.getElementById('app'); const my = ++renderToken; applyPrefs();
  if (!P.user) { document.title = t('pTitle'); app.replaceChildren(loginView()); return; }
  if (P.user.must_change) { app.replaceChildren(changePwView()); return; }
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0], q = new URLSearchParams((location.hash.split('?')[1]) || '');
  let hit = null; for (const r of ROUTES) { const m = path.match(r.re); if (m && r.roles.includes(P.user.role)) { hit = { r, params: m.slice(1).map(decodeURIComponent) }; break; } }
  if (!hit) { if (path !== HOME[P.user.role]) { go(HOME[P.user.role]); return; } }
  const sh = shell(path); app.replaceChildren(sh.el); document.title = `${t('pTitle')}`;
  try { const el = await hit.r.fn(...hit.params, q); if (my !== renderToken) return; sh.main.replaceChildren(el); window.scrollTo(0, 0); }
  catch (e) {
    if (my !== renderToken) return;
    if (e.status === 401) { P.user = null; P.loginMsg = t('sessionExpired'); render(); return; }
    if (e.code === 'must_change_password') { P.user.must_change = true; render(); return; }
    sh.main.replaceChildren(errorState(t('loadFailed'), e.network ? t('loadFailedDesc') : errMsg(e), () => render()));
  }
}
window.addEventListener('hashchange', render);
setInterval(async () => { if (P.user && !document.hidden) { const before = P.unread; await refreshUnread(); if (before !== P.unread) { const b = document.querySelector('.bell'); if (b) { const c = b.querySelector('.count'); if (c) c.remove(); if (P.unread) b.append(h('span', { class: 'count' }, num(Math.min(P.unread, 99)))); } } } }, 60000);
