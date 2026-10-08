/* End-to-end smoke test. Usage:  npm i playwright && python3 -m http.server 8123 &  node tests/e2e.js
   Env: BASE (default http://localhost:8123/index.html), OUT (screenshot/download dir). */
const { chromium } = require('playwright');
const path = require('path'), os = require('os'), fs = require('fs');
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'gmc-e2e-')); const SH = OUT + '/'; const B = process.env.BASE || 'http://localhost:8123/index.html';
const FIX = path.join(__dirname, 'fixtures', 'students-30.xlsx');
const fail=[]; const ok=(c,m)=>{ if(!c){fail.push(m);console.log('FAIL',m);} else console.log('ok  ',m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads:true });
  const p = await ctx.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push('PAGEERR '+e.message)); p.on('console',m=>{ if(m.type()==='error'&&!/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(B); await p.waitForSelector('.shell');
  await p.click('.content >> text=Create semester'); await p.fill('#f-name','BS ECO (5th Semester)'); await p.click('dialog .btn.primary'); await p.waitForSelector('dialog',{state:'detached'});
  ok((await p.title()).includes('GMC Check-in'),'title ok');
  ok(await p.locator('.start').count()===1,'getting-started checklist shown');
  // subjects with schedule incl. today
  const wd=await p.evaluate(()=>new Date().getDay());
  await p.click('.nav-item:has-text("Attendance")');
  for (const [n,min,days] of [['Micro Economics',null,[wd]],['Macro Economics','60',[]],['Statistics',null,[(wd+1)%7]]]) {
    await p.click('.ph-actions >> text=Add subject'); await p.fill('#f-name',n);
    if(min) await p.fill('#f-min',min);
    for (const d of days) { await p.locator('.daychip').nth([1,2,3,4,5,6,0].indexOf(d)).click(); }
    if(days.length) await p.fill('#f-time','09:30');
    await p.click('dialog .btn.primary'); await p.waitForSelector('dialog',{state:'detached'});
  }
  // xlsx import
  await p.click('.nav-item:has-text("Students")'); await p.click('.empty >> text=Import list');
  await p.setInputFiles('dialog input[type=file]',FIX); await p.waitForFunction(()=>document.getElementById('f-list').value.includes('21-ECO-030'));
  ok((await p.inputValue('#f-list')).includes('محمد علی'),'xlsx import reads Urdu names');
  await p.click('dialog .btn.primary'); await p.waitForSelector('dialog',{state:'detached'});
  ok(await p.locator('table tbody tr').count()===25,'30 students imported (page 1 = 25)');
  // template download
  await p.click('.ph-actions >> text=Import list');
  const [dl]=await Promise.all([p.waitForEvent('download'),p.click('dialog >> text=Download Excel template')]);
  await dl.saveAs(SH+'template.xlsx'); ok(true,'template downloaded'); await p.click('dialog >> text=Cancel');
  // mark attendance with Late + topic; 4 lectures for Micro
  for (let l=0;l<4;l++){
    await p.goto(B+'#/attendance'); await p.waitForSelector('table'); await p.locator('table tbody tr').first().locator('text=Mark').click(); await p.waitForSelector('.att-row');
    await p.click('text=Mark all present');
    if(l<3){ await p.locator('.att-row').nth(0).locator('.seg-btn.A').click(); }           // student1 absent x3
    await p.locator('.att-row').nth(1).locator('.seg-btn.T').click();                        // student2 late
    await p.locator('.att-row').nth(2).focus(); await p.keyboard.press('l');                 // student3 leave (keyboard)
    ok(await p.locator('.att-row').nth(2).getAttribute('data-mark')==='L','keyboard L (lecture '+(l+1)+')');
    await p.fill('#m-date',`2026-09-0${l+1}`); await p.fill('#m-topic','Chapter '+(l+1));
    await p.click('.savebar >> text=Save attendance'); await p.waitForSelector('text=Lecture history');
  }
  ok(await p.locator('.topic:has-text("Chapter 4")').count()===1,'topic shown in history');
  // outlook: student1 present 1/4 = 25%  => needs lectures to reach 75% : (75*4-100*1)/25=8
  const row1=await p.locator('table tbody tr').first().innerText(); console.log('   row1:',row1.replace(/\s+/g,' '));
  ok(/Attend next 8 lectures to reach 75%/.test(row1),'calculator says attend next 8 lectures');
  ok(await p.locator('table tbody tr').first().locator('a[href*="wa.me"], button[title="WhatsApp reminder"]').count()===1,'reminder button for shortage student');
  await p.screenshot({path:SH+'v3_subject.png'});
  // student profile with phone + whatsapp link
  await p.click('table tbody tr >> nth=0'); await p.waitForSelector('.heat');
  const wa=await p.locator('a:has-text("WhatsApp reminder")').getAttribute('href'); console.log('   wa:',decodeURIComponent(wa).slice(0,200));
  ok(wa.startsWith('https://wa.me/923001234501'),'wa.me link normalised to +92'); ok(decodeURIComponent(wa).includes('25%'),'reminder text has pct');
  ok(await p.locator('.hc.bad').count()>=3,'heatmap shows absences');
  await p.screenshot({path:SH+'v3_student.png'});
  // undo delete student
  await p.click('.ph-actions >> text=Delete'); await p.click('dialog .btn.danger'); await p.waitForSelector('.toast-action');
  ok(await p.locator('.toast-action').count()===1,'undo toast shown'); await p.click('.toast-action'); await p.waitForSelector('text=Change undone');
  await p.goto(B+'#/students'); ok(await p.locator('text=Student 1').count()>0,'student restored by undo');
  // subject min override on Macro (60): status uses 60
  // dashboard
  await p.goto(B+'#/dashboard'); await p.waitForSelector('.stats');
  ok(await p.locator('.time-chip:has-text("09:30")').count()===1,'today lecture listed on dashboard');
  ok(await p.locator('.notice.warn:has-text("back")').count()>=1,'backup banner shown');
  await p.screenshot({path:SH+'v3_dashboard.png',fullPage:true});
  // reports + xlsx export validated
  await p.goto(B+'#/reports'); await p.waitForSelector('.stats.six');
  await p.screenshot({path:SH+'v3_reports.png',fullPage:true});
  const [x]=await Promise.all([p.waitForEvent('download'),p.click('.ph-actions >> text=Excel')]); await x.saveAs(SH+'export.xlsx');
  const [c]=await Promise.all([p.waitForEvent('download'),p.click('.ph-actions >> text=CSV')]); await c.saveAs(SH+'export.csv');
  // settings subject late toggle
  await p.goto(B+'#/settings'); await p.click('.set-nav >> text=Academic'); await p.screenshot({path:SH+'v3_settings.png'});
  // urdu
  await p.click('.set-nav >> text=General'); await p.click('.choice-btn:has-text("اردو")'); await p.goto(B+'#/dashboard'); await p.waitForSelector('.stats'); await p.screenshot({path:SH+'v3_urdu.png',fullPage:true});
  await p.goto(B+'#/students'); await p.waitForSelector('table'); await p.locator('table tbody tr').first().click(); await p.waitForSelector('.heat'); await p.screenshot({path:SH+'v3_urdu_student.png',fullPage:true});
  // print register opens (stub print)
  await p.evaluate(()=>{window.print=()=>{window.__printed=true}}); await p.click('.set-nav >> text=General').catch(()=>{});
  await p.goto(B+'#/reports'); await p.waitForSelector('.stats.six'); await p.selectOption('.toolbar select',{index:1}); await p.click('.ph-actions >> text=PDF'); await p.waitForTimeout(300);
  ok(await p.evaluate(()=>window.__printed===true && document.querySelectorAll('#print-area tbody tr').length===30),'print register built with 30 rows');
  // mobile
  const m = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const mp = await m.newPage(); mp.on('pageerror',e=>errs.push('MOBILE '+e.message));
  await mp.goto(B); await mp.evaluate(d=>{localStorage['lectus-data-v1']=d},await p.evaluate(()=>{const o=JSON.parse(localStorage['lectus-data-v1']);o.settings.lang='en';return JSON.stringify(o)}));
  await mp.reload(); await mp.waitForSelector('.stats'); await mp.screenshot({path:SH+'v3_m_dashboard.png',fullPage:true});
  await mp.goto(B+'#/attendance'); await mp.locator('.table.stack tbody tr').first().locator('text=Mark').click(); await mp.waitForSelector('.att-row'); await mp.screenshot({path:SH+'v3_m_mark.png'});
  ok(await mp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal overflow (mobile mark)');
  await mp.goto(B+'#/reports'); await mp.waitForSelector('.stats.six'); ok(await mp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal overflow (mobile reports)');
  console.log('JS errors:',errs); console.log('FAILS:',fail); console.log('Artifacts in', OUT); await b.close(); process.exit(fail.length||errs.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
