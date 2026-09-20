/* Проверка стенда редизайна: снимает экраны и МЕРЯЕТ вёрстку, а не смотрит на неё.
   Обычный прогон:   node docs/redesign/stand/check.js
   Негативный:       node docs/redesign/stand/check.js break   — обязан напечатать дефекты
   Снимки: второй аргумент или /tmp/swarm-stand-shots */
const puppeteer = require('/Users/garva/sb-smoke/node_modules/puppeteer-core');
const OUT = process.argv[3] || '/tmp/swarm-stand-shots';
require('fs').mkdirSync(OUT, { recursive: true });
const URL = 'file://' + require('path').join(__dirname, 'index.html');
(async () => {
  const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.setViewport({ width:1440, height:900, deviceScaleFactor:2 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: ' + m.text()); });
  await p.goto(URL, { waitUntil:'networkidle0' });
  // негативный прогон: ломаем вёрстку нарочно и ждём, что проверка заругается
  if (process.argv[2] === 'break') await p.addStyleTag({ content: '.ib{display:block!important}' });

  const measure = () => p.evaluate(() => {
    const bad = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push('горизонтальный скролл страницы');
    ['.chip','.btn','.tab','.item','.ft','.state'].forEach(sel => {
      const els = [...document.querySelectorAll(sel)].filter(e => e.offsetHeight > 0 && e.offsetParent);
      if (els.length < 2) return;
      const hs = els.map(e => e.offsetHeight).sort((a,b) => a-b);
      const med = hs[Math.floor(hs.length/2)];
      els.forEach(el => { if (el.offsetHeight > med + 6) bad.push('перенос в «' + el.textContent.trim().slice(0,28) + '» h=' + el.offsetHeight + ' при норме ' + med); });
    });
    const allRows = [...document.querySelectorAll('tbody tr')].filter(r => r.offsetHeight > 0 && !r.classList.contains('sect'));
    if (allRows.length > 2) {
      const med = Math.min(...allRows.map(r => r.offsetHeight));
      allRows.forEach(r => { if (r.offsetHeight > med + 14) bad.push('строка таблицы выше нормы: «' + r.textContent.trim().slice(0,22) + '» h=' + r.offsetHeight + ' при норме ' + med); });
    }
    document.querySelectorAll('tbody tr').forEach(r => [...r.children].forEach(td => {
      const c = td.lastElementChild;
      if (c && c.offsetHeight > 0 && c.getBoundingClientRect().bottom > r.getBoundingClientRect().bottom + 2) bad.push('содержимое вылезло из строки: ' + td.textContent.trim().slice(0,22));
    }));
    document.querySelectorAll('table').forEach(t => { if (t.scrollWidth > t.parentElement.clientWidth + 1) bad.push('таблица шире контейнера'); });
    document.querySelectorAll('.tr .ln, .rowset > div, .rowset .v, .rowset .k, .d-title').forEach(el => { if (el.scrollWidth > el.clientWidth + 1) bad.push('строка обрезана: ' + el.textContent.trim().slice(0,24)); });
    return bad;
  });
  const shot = async (name) => { await p.screenshot({ path: OUT + '/' + name + '.png' }); const bad = await measure(); if (bad.length) console.log(name + ': ' + JSON.stringify([...new Set(bad)], null, 0)); };
  const click = async (sel) => { await p.$eval(sel, e => e.click()); await new Promise(r => setTimeout(r, 120)); };

  await click('[data-sec="base"]');
  await click('[data-tab="files"]');           await shot('01-files');
  await click('[data-file="f2"]');             await shot('02-file-detail');
  await click('[data-close]');
  await click('[data-tab="all"]');
  await click('[data-country]');               await shot('03-country');
  await click('[data-rec="r1"]');              await shot('04-rec-detail');
  await click('[data-close]');
  await click('[data-sec="meetings"]');
  await click('[data-tab="draft"]');           await shot('05-dedup');
  await click('[data-meet="m6"]');             await shot('06-draft-detail');
  await click('[data-pub]');                   await shot('07-publish');
  await click('[data-mclose]');
  await click('[data-tab="review"]');
  await click('[data-meet="m1"]');             await shot('08-meet-detail');
  await click('[data-cmp]');                   await shot('09-compare');
  await click('[data-mclose]');
  console.log('ошибки JS: ' + (errs.length ? '\n' + errs.join('\n') : 'нет'));
  await b.close();
})();
