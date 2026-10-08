/* Portal end-to-end test against a real server.
   Usage: (cd server && GMC_INSECURE_COOKIES=1 GMC_STATIC=.. node index.mjs &) ; node tests/portal-e2e.js
   Env: BASE (default http://localhost:8787), OUT (screenshot dir), PW (demo password). Needs `playwright` and a seeded demo DB (cli.mjs seed-demo). */
const { chromium } = require('playwright');
const path = require('path'), os = require('os'), fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8787', PW = process.env.PW || 'demo-Password-123';
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'gmc-portal-'));
const fail = [], ok = (c, m) => { if (!c) { fail.push(m); console.log('FAIL', m); } else console.log('ok  ', m); };
const errs = [];
async function newPage(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true, ...opts }); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  return { ctx, p };
}
async function login(p, id, pw = PW) { await p.goto(BASE + '/portal/'); await p.fill('#login-id', id); await p.fill('#login-pw', pw); await p.click('button[type=submit]'); await p.waitForSelector('.shell', { timeout: 15000 }); }
const text = p => p.locator('#main').innerText();
(async () => {
  const b = await chromium.launch();
  /* ---------- sign-in ---------- */
  let { ctx, p } = await newPage(b);
  await p.goto(BASE + '/portal/'); await p.waitForSelector('#login-id');
  ok(await p.title() === 'GMC Check-in', 'login page title');
  await p.fill('#login-id', 'admin@demo.local'); await p.fill('#login-pw', 'wrong-password-1'); await p.click('button[type=submit]');
  await p.waitForFunction(() => document.querySelector('.field-error')?.textContent.length > 0); ok(true, 'wrong password shows an error');
  await p.fill('#login-pw', PW); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  ok((await text(p)).includes('System overview'), 'admin lands on overview');

  /* ---------- admin: structure ---------- */
  await p.goto(BASE + '/portal/#/admin/structure'); await p.waitForSelector('.tabs');
  ok((await text(p)).includes('ECO'), 'structure lists departments');
  await p.click('text=Add'); await p.fill('#f-code', 'MATH'); await p.fill('#f-name', 'Mathematics'); await p.click('dialog .btn.primary'); await p.waitForSelector('td:has-text("MATH")');
  ok(true, 'department created');
  await p.click('.tabs button:has-text("Offerings")'); await p.waitForSelector('td:has-text("ECO501")'); ok(true, 'offerings tab lists courses');

  /* ---------- admin: students import + logins ---------- */
  await p.goto(BASE + '/portal/#/admin/students'); await p.waitForSelector('.table');
  const csv = path.join(OUT, 'import.csv'); fs.writeFileSync(csv, 'Roll,Name,Phone\n22-ECO-001,Aisha Khan,0300-1234567\n22-ECO-002,Bilal Ahmed,03211234567\n22-ECO-003,"Chaudhry, Sana",\n');
  await p.click('button:has-text("Import students")'); await p.setInputFiles('dialog input[type=file]', csv);
  await p.selectOption('#f-section_id', { index: 1 }); await p.click('dialog .btn.primary');
  await p.waitForSelector('text=Import finished'); ok((await p.locator('dialog').last().innerText()).includes('Created: 3'), 'CSV import created 3 students');
  await p.click('dialog button:has-text("Close")'); await p.fill('input[type=search]', '22-ECO'); await p.waitForSelector('td:has-text("22-ECO-003")'); ok(true, 'imported students are listed');
  await p.click('button:has-text("Create logins")'); await p.selectOption('#f-section_id', { index: 0 }); await p.click('dialog .btn.primary');
  await p.waitForSelector('.cred-table'); const creds = await p.locator('.cred-table tbody tr').count(); ok(creds === 3, `logins created for the 3 new students (${creds})`);
  const pw1 = (await p.locator('.cred-table td.pw').first().innerText()).trim(); ok(pw1.length >= 12, 'generated password is long');
  const rollFirst = (await p.locator('.cred-table tbody tr td').first().innerText()).trim();
  await p.keyboard.press('Escape');

  /* ---------- admin: users, audit, settings ---------- */
  await p.goto(BASE + '/portal/#/admin/users'); await p.waitForSelector('.table');
  await p.click('button:has-text("Add user")'); await p.fill('#f-name', 'New Teacher'); await p.fill('#f-email', 'new.teacher@demo.local'); await p.click('dialog .btn.primary');
  await p.waitForSelector('.cred-table'); ok(true, 'teacher created with one-time password'); await p.keyboard.press('Escape');
  await p.goto(BASE + '/portal/#/admin/audit'); await p.waitForSelector('.table'); ok((await text(p)).includes('users.create'), 'audit log shows user creation');
  await p.goto(BASE + '/portal/#/admin/settings'); await p.waitForSelector('#s-min_pct'); await p.fill('#s-min_pct', '75'); await p.click('button[type=submit]'); await p.waitForSelector('.toast, [role=status]'); ok(true, 'settings save');
  await p.goto(BASE + '/portal/#/admin'); await p.waitForSelector('.stats'); const bk = p.locator('button:has-text("Back up now")'); await bk.click(); await p.waitForSelector('text=Backup completed'); ok(true, 'backup from the UI');
  await ctx.close();

  /* ---------- new student first login forces password change ---------- */
  ({ ctx, p } = await newPage(b));
  await p.goto(BASE + '/portal/'); await p.fill('#login-id', rollFirst); await p.fill('#login-pw', pw1); await p.click('button[type=submit]');
  await p.waitForSelector('#cp-n1'); ok(true, 'generated password forces a change');
  await p.fill('#cp-cur', pw1); await p.fill('#cp-n1', 'my-New-Password-77'); await p.fill('#cp-n2', 'my-New-Password-77'); await p.click('button[type=submit]'); await p.waitForSelector('.shell');
  ok(true, 'password changed, student enters the app'); await p.reload(); await p.waitForSelector('.shell'); ok(true, 'session survives reload (cookie)');
  await ctx.close();

  /* ---------- teacher: lecture, marking, check-in code ---------- */
  ({ ctx, p } = await newPage(b));
  await login(p, 'teacher1@demo.local'); await p.goto(BASE + '/portal/#/courses'); await p.waitForSelector('.course-card');
  const nCourses = await p.locator('.course-card').count(); ok(nCourses === 4, `teacher sees only own courses (${nCourses})`);
  await p.locator('.course-card').first().click(); await p.waitForSelector('.tabs');
  await p.click('button:has-text("New lecture")'); await p.click('dialog .btn.primary'); await p.waitForSelector('.roster');
  const nRoster = await p.locator('.roster li').count(); ok(nRoster >= 25, `roster shows enrolled students (${nRoster})`);
  /* check-in */
  await p.click('button:has-text("Open check-in")'); await p.click('dialog .btn.primary'); await p.waitForSelector('.code-box');
  const code = (await p.locator('.code-box').innerText()).trim(); ok(/^\d{6}$/.test(code), 'rotating code displayed');
  /* student checks in with that code (section A student) */
  const s = await newPage(b); await login(s.p, '21-ECO-001'); await s.p.waitForSelector('#ci-code'); ok(true, 'student sees open check-in');
  await s.p.fill('#ci-code', '000000'); await s.p.click('button:has-text("Check in")'); await s.p.waitForSelector('.field-error:not(:empty)'); ok(true, 'wrong code rejected');
  await s.p.fill('#ci-code', code); await s.p.click('button:has-text("Check in")'); await s.p.waitForSelector('text=You are marked present'); ok(true, 'correct code accepted');
  ok((await text(s.p)).includes('ECO5'), 'student dashboard lists courses'); await s.p.screenshot({ path: OUT + '/student.png', fullPage: true });
  await p.reload(); await p.waitForSelector('.roster'); ok(await p.locator('.roster li[data-roll="21-ECO-001"] em').count() === 1, 'teacher roster shows the code check-in');
  await p.click('button:has-text("Present ⇢")'); await p.locator('.roster li').first().locator('button.A').click();
  await p.click('button:has-text("Save")'); await p.waitForSelector('text=Attendance saved'); ok(true, 'attendance saved online');
  /* offline queue */
  await ctx.setOffline(true); await p.locator('.roster li').nth(1).locator('button.L').click(); await p.click('button:has-text("Save")');
  await p.waitForSelector('text=Waiting to sync'); ok(true, 'offline save is queued'); ok(await p.evaluate(() => JSON.parse(localStorage.getItem('gmc-queue') || '[]').length) === 1, 'queue persisted in localStorage');
  await ctx.setOffline(false); await p.waitForSelector('text=All saved', { timeout: 30000 }); ok(true, 'queue flushed when back online');
  /* student must not reach staff pages */
  await s.p.goto(BASE + '/portal/#/admin'); await s.p.waitForSelector('.shell'); ok(!(await text(s.p)).includes('System overview'), 'student cannot open admin page');
  const res = await s.p.evaluate(async () => (await fetch('/api/admin/users', { headers: { 'x-gmc': '1' } })).status); ok(res === 403, 'admin API forbidden for student (403)');
  await s.ctx.close();
  await p.screenshot({ path: OUT + '/teacher.png', fullPage: true }); await ctx.close();

  /* ---------- HOD ---------- */
  ({ ctx, p } = await newPage(b));
  await login(p, 'hod@demo.local'); await p.goto(BASE + '/portal/#/dept'); await p.waitForSelector('.stats'); ok((await text(p)).includes('Economics'), 'HOD sees own department');
  const dl = p.waitForEvent('download'); await p.click('button:has-text("Export CSV")'); const d = await dl; ok(/shortage\.csv/.test(d.suggestedFilename()), 'shortage CSV downloads');
  await p.screenshot({ path: OUT + '/hod.png', fullPage: true }); await ctx.close();

  /* ---------- Urdu, RTL, mobile ---------- */
  ({ ctx, p } = await newPage(b, { viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true }));
  await p.goto(BASE + '/portal/'); await p.evaluate(() => localStorage.setItem('gmc-lang', 'ur')); await login(p, '21-ECO-002');
  ok(await p.evaluate(() => document.documentElement.dir) === 'rtl', 'Urdu sets RTL');
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(over <= 1, `no horizontal overflow at 375px (${over})`);
  await p.screenshot({ path: OUT + '/mobile-ur.png', fullPage: true });
  ok((await p.locator('.bottom-nav').isVisible()), 'bottom navigation on mobile');
  await ctx.close();

  /* ---------- logged-out API and headers ---------- */
  const r = await fetch(BASE + '/api/my/offerings'); ok(r.status === 401, 'API requires login (401)');
  const hdr = (await fetch(BASE + '/portal/')).headers; ok(/default-src 'self'/.test(hdr.get('content-security-policy') || ''), 'CSP header present');
  ok(errs.length === 0, 'zero console errors' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASSED', '— screenshots in', OUT);
  await b.close(); process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
