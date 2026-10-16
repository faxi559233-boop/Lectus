/* Two-step login (authenticator app) and active sessions. */
'use strict';
async function twoStepDialog() {
  if (P.user.totp_on) {
    formDialog({ title: t('twoStep'), desc: t('twoStepOn'), fields: [{ key: 'password', label: t('password'), type: 'password', required: true }, { key: 'code', label: t('authCodeOrBackup'), required: true }], submit: t('turnOff'),
      onSubmit: v => { api('POST', '/api/auth/2fa/disable', { password: v.password, code: v.code }).then(() => { P.user.totp_on = false; toast(t('saved')); }).catch(e => toast(e.message, 'error')); } });
    return;
  }
  try {
    const s = await api('POST', '/api/auth/2fa/setup', {});
    formDialog({ title: t('twoStep'), desc: t('twoStepHow'), fields: [
      { custom: true, node: h('div', { class: 'field' }, h('label', {}, t('setupKey')), h('code', { class: 'big-code', style: 'font-size:16px;word-break:break-all' }, s.secret), h('p', { class: 'help' }, t('setupKeyHint'))) },
      { key: 'code', label: t('authCode'), required: true, placeholder: '123456' }], submit: t('turnOn'),
    onSubmit: v => { api('POST', '/api/auth/2fa/enable', { code: v.code }).then(r => { P.user.totp_on = true; const d2 = sheetDialog(t('backupCodes'), h('div', {}, h('p', { class: 'sub' }, t('backupCodesHint')), h('pre', { class: 'pw', style: 'user-select:all' }, r.backup_codes.join('\n')), btn(t('close'), { onclick: () => d2.close() }))); }).catch(e => toast(e.message, 'error')); } });
  } catch (e) { toast(e.message, 'error'); }
}
async function sessionsDialog() {
  try {
    const list = await api('GET', '/api/auth/sessions');
    const d = sheetDialog(t('mySessions'), h('div', {}, h('ul', { class: 'plain-list' }, list.map(x => h('li', {}, x.current ? badge('success', t('thisDevice')) : null, h('span', { class: 'sub' }, `${x.ip || ''} · ${fmtTime(x.last_seen)}`), h('div', { class: 'sub' }, (x.ua || '').slice(0, 80))))),
      btn(t('signOutOthers'), { v: 'danger-ghost', onclick: () => api('POST', '/api/auth/sessions/revoke-others', {}).then(r => { toast(`${num(r.revoked)} ✓`); d.close(); }).catch(e => toast(e.message, 'error')) })));
  } catch (e) { toast(e.message, 'error'); }
}
