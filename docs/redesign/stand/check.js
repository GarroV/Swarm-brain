/* Проверка стенда: щёлкает по нему как человек и СВЕРЯЕТ результат, а не смотрит на картинку.
   Обычный прогон:  node docs/redesign/stand/check.js
   Негативный:      node docs/redesign/stand/check.js break   — обязан напечатать дефекты
   Снимки:          второй аргумент или /tmp/swarm-stand-shots */
const puppeteer = require('/Users/garva/sb-smoke/node_modules/puppeteer-core');
const path = require('path'), fs = require('fs');
const OUT = process.argv[3] || '/tmp/swarm-stand-shots';
fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.join(__dirname, 'index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* статическая проверка: переменная без объявления в :root молча убивает всё правило */
function tokenCheck() {
  const css = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
  const defined = new Set();
  for (const block of css.match(/:root[^{]*\{[^}]*\}/g) || []) for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  const missing = new Set();
  for (const m of css.matchAll(/var\((--[a-z0-9-]+)\s*(,?)/g)) if (!defined.has(m[1]) && !m[2]) missing.add(m[1]);
  return missing.size ? ['токены без объявления: ' + [...missing].join(', ')] : [];
}

(async () => {
  const bad = [...tokenCheck()], errs = [];
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  /* негативный прогон: ломаем нарочно то, что каждая проверка должна ловить */
  if (process.argv[2] === 'break') await p.addStyleTag({ content: `
    .ib{display:block!important}
    .list td.ck{width:10px!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .chip{white-space:normal!important;width:60px!important}` });

  const sel = (a, id) => `[data-act="${a}"]` + (id !== undefined ? `[data-id="${id}"]` : '');
  const click = async (s) => { await p.$eval(s, (e) => e.click()); await new Promise((r) => setTimeout(r, 90)); };
  const go = (a, id) => click(sel(a, id));
  const gov = (a, v) => click(`[data-act="${a}"][data-v="${v}"]`);
  const count = (s) => p.$$eval(s, (els) => els.length);
  const text = (s) => p.$eval(s, (e) => e.textContent.trim()).catch(() => '');
  const want = (cond, msg) => { if (!cond) bad.push('НЕ СРАБОТАЛО: ' + msg); };

  const measure = () => p.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('горизонтальный скролл страницы');
    ['.chip', '.btn', '.tab', '.item', '.ft', '.state', '.mini'].forEach((s) => {
      const els = [...document.querySelectorAll(s)].filter((e) => e.offsetHeight > 0 && e.offsetParent);
      if (els.length < 2) return;
      const med = Math.min(...els.map((e) => e.offsetHeight));
      els.forEach((e) => { if (e.offsetHeight > med + 8) out.push('перенос в «' + e.textContent.trim().slice(0, 24) + '» h=' + e.offsetHeight); });
    });
    const rows = [...document.querySelectorAll('tbody tr')].filter((r) => r.offsetHeight > 0 && !r.classList.contains('sect'));
    if (rows.length > 2) { const m = Math.min(...rows.map((r) => r.offsetHeight));
      rows.forEach((r) => { if (r.offsetHeight > m + 14) out.push('строка выше нормы: «' + r.textContent.trim().slice(0, 20) + '» h=' + r.offsetHeight); }); }
    document.querySelectorAll('tbody tr').forEach((r) => [...r.children].forEach((td) => { const c = td.lastElementChild;
      if (c && c.offsetHeight > 0 && c.getBoundingClientRect().bottom > r.getBoundingClientRect().bottom + 2)
        out.push('содержимое вылезло из строки: ' + td.textContent.trim().slice(0, 20)); }));
    document.querySelectorAll('tr.sect td').forEach((td) => { const t = td.closest('table');
      if (Math.abs(td.offsetWidth - t.offsetWidth) > 2) out.push('разделитель не на всю ширину: ' + td.textContent.trim().slice(0, 16)); });
    document.querySelectorAll('table').forEach((t) => { if (t.scrollWidth > t.parentElement.clientWidth + 1) out.push('таблица шире контейнера'); });
    document.querySelectorAll('td').forEach((td) => {
      if (!td.textContent.trim() && td.scrollWidth > td.clientWidth + 1) out.push('пустая ячейка с обрезкой: ширина ' + td.clientWidth);
    });
    document.querySelectorAll('.rowset .v, .rowset .k, .d-title, .tr .ln').forEach((e) => {
      if (e.scrollWidth > e.clientWidth + 1) out.push('обрезано: ' + e.textContent.trim().slice(0, 20)); });
    return out;
  });
  const shot = async (name) => { await p.screenshot({ path: `${OUT}/${name}.png` });
    (await measure()).forEach((m) => bad.push(`${name}: ${m}`)); };

  /* ── задачи ─────────────────────────────────────────────── */
  await shot('01-tasks-today');
  const mine = await count('tbody tr[data-act="open-task"]');
  await go('lens', 'all');
  const all = await count('tbody tr[data-act="open-task"]');
  want(all > mine, `линза «Все» шире «Моих» (было ${mine}, стало ${all})`);
  await go('status', 'done');
  const withDone = await count('tbody tr[data-act="open-task"]');
  want(withDone >= all, 'добавление статуса «Готово» не сузило список');
  await go('status', 'done');
  await go('tgl', 'byMarket'); await shot('02-tasks-by-market');
  want((await count('tr.sect')) > 1, 'группировка по рынкам дала больше одной секции');
  await go('tgl', 'byMarket');
  await go('tab', 'all'); await shot('03-tasks-all');

  /* создание задачи */
  await go('new-task');
  await p.type('[data-f="title"]', 'Проверить приёмку второй линии');
  await click('[data-pick="labels"] .chip');
  await go('create-task');
  await new Promise((r) => setTimeout(r, 120));
  want((await text('.d-title')).includes('Проверить приёмку'), 'созданная задача открылась в детали');
  want((await text('.toast')).includes('создана'), 'после создания показан тост');
  await shot('04-task-created');

  /* действия в детали */
  await go('take');
  want((await p.$eval('.detail .mini.on', (e) => e.textContent)).includes('В работе'), 'кнопка «Взять в работу» сменила статус');
  await go('dtab', 'talk');
  await p.type('.cbox textarea', 'Проверил, вторая линия готова.');
  await p.$eval('[data-act="comment"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 90));
  want((await count('.cm')) === 1, 'комментарий добавился');
  await go('dtab', 'hist');
  want((await count('.tl .e')) >= 2, 'история пишет движения');
  await shot('05-task-detail-history');
  await go('close');

  /* массовые действия */
  await go('tab', 'archive');
  const beforeArch = await count('tbody tr[data-act="open-task"]');
  await go('tab', 'all');
  await click('tbody tr[data-act="open-task"] input[type=checkbox]');
  want((await count('.bulk')) === 1, 'панель массовых действий появилась');
  await go('bulk-archive');
  await go('tab', 'archive');
  const afterArch = await count('tbody tr[data-act="open-task"]');
  want(afterArch === beforeArch + 1, `массовый архив сработал (${beforeArch} → ${afterArch})`);
  await shot('06-archive');
  await go('open-task', (await p.$eval('tbody tr[data-act="open-task"]', (e) => e.dataset.id)));
  want((await text('.detail .btn')).includes('Вернуть'), 'в архиве предлагается вернуть задачу');
  await go('close');

  /* ── встречи ────────────────────────────────────────────── */
  await go('sec', 'meetings'); await shot('07-meetings-review');
  const rev = await count('tbody tr[data-act="open-meet"]');
  await gov('mf-src', 'Granola');
  const gr = await count('tbody tr[data-act="open-meet"]');
  want(gr < rev, `фильтр по источнику сузил список (${rev} → ${gr})`);
  await go('mf-clear');
  const firstMeet = await p.$eval('tbody tr[data-act="open-meet"]', (e) => e.dataset.id);
  await go('open-meet', firstMeet); await shot('08-meeting-detail');
  await go('compare'); await shot('09-compare');
  await go('mclose');
  await go('harvest');
  await go('do-harvest');
  await new Promise((r) => setTimeout(r, 120));
  want((await text('.toast')).includes('Создано задач'), 'сбор задач из встречи отработал');
  await go('confirm-meet', firstMeet);
  await go('tab', 'review');
  want((await count(`tbody tr[data-act="open-meet"][data-id="${firstMeet}"]`)) === 0, 'подтверждённая встреча ушла из вычитки');
  await go('tab', 'draft'); await shot('10-drafts');
  await go('tab', 'queue'); await shot('11-agent-queue');
  const q0 = await count('.qcard');
  await p.$eval('[data-act="q-accept"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.qcard')) === q0 - 1, 'агентская встреча опубликована и ушла из очереди');

  /* сбор задач из встречи, чтение записи, таймлайн, метки, профиль */
  await go('tab', 'review');
  const anyPending = await p.$$eval('tbody tr[data-act="open-meet"]', (e) => e.length ? e[0].dataset.id : null);
  if (anyPending) {
    await go('open-meet', anyPending);
    await go('harvest');
    await shot('34-harvest');
    const tasksBefore = await p.evaluate(() => S.tasks.length);
    await p.$eval('.hrv .hrow:nth-child(2) input[type=checkbox]', (e) => e.click());
    await go('do-harvest');
    await new Promise((r) => setTimeout(r, 120));
    const tasksAfter = await p.evaluate(() => S.tasks.length);
    want(tasksAfter === tasksBefore + 1, `сбор задач создал только отмеченные (${tasksBefore} → ${tasksAfter})`);
    await go('review-next', anyPending);
    want((await p.evaluate(() => S.sel)) !== anyPending, 'вычитка подряд переключает на следующую встречу');
    await go('close');
  }

  /* ── база ───────────────────────────────────────────────── */
  await go('sec', 'base'); await shot('12-base');
  const recs = await count('.rec');
  await gov('b-cc', 'HR');
  const hr = await count('.rec');
  want(hr < recs, `фильтр по стране сузил базу (${recs} → ${hr})`);
  await gov('b-cc', '');
  await go('new-entry');
  await p.type('[data-f="title"]', 'Заметка со стенда');
  await go('create-entry');
  await new Promise((r) => setTimeout(r, 120));
  want((await text('.d-title')) === 'Заметка со стенда', 'новая запись открылась в детали');
  await go('close');
  await go('open-entry', 'r2');
  await go('reader'); await shot('35-reader');
  want((await count('.reader p')) >= 2, 'запись открывается целиком');
  await go('mclose'); await go('close');
  await go('tab', 'files'); await shot('13-files');
  await go('open-file', 'f2'); await shot('14-file-detail');
  await go('close');

  /* ── проекты и спринты ──────────────────────────────────── */
  await go('sec', 'projects'); await shot('15-projects');
  await go('open-proj', 'p1'); await shot('16-project-detail');
  await go('close');
  await go('tab', 'map'); await shot('17-projects-map');
  await go('sec', 'sprints'); await shot('18-board');
  const doneBefore = await count('[data-drop="done"] .card');
  await p.evaluate(() => { const c = document.querySelector('.card[data-card]');
    c.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() })); });
  await new Promise((r) => setTimeout(r, 40));
  await p.evaluate(() => { const z = document.querySelector('[data-drop="done"]'); const dt = new DataTransfer();
    z.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    z.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt })); });
  await new Promise((r) => setTimeout(r, 140));
  const doneAfter = await count('[data-drop="done"] .card');
  want(doneAfter === doneBefore + 1, `перетаскивание переносит карточку (${doneBefore} → ${doneAfter})`);
  await shot('19-board-after-drop');
  await go('tab', 'timeline'); await shot('36-timeline');
  want((await count('.tday')) > 3, 'таймлайн разложил задачи по дням');
  await go('tab', 'pool'); await shot('20-initiatives');
  const prop = await count('[data-act="accept-init"]');
  await p.$eval('[data-act="accept-init"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 90));
  want((await count('[data-act="accept-init"]')) === prop - 1, 'инициатива принята в цикл');
  await go('tab', 'check'); await shot('21-check');
  await go('tab', 'analytics'); await shot('22-analytics');
  await go('tab', 'journal'); await shot('23-journal');

  /* ── люди и система ─────────────────────────────────────── */
  await go('sec', 'team'); await shot('24-team');
  await go('tab', 'ws'); await shot('25-workspaces');
  await go('sec', 'settings'); await shot('26-settings');
  await go('tab', 'integr');
  await go('integr', 'granola');
  want((await text('.toast')).includes('переключена'), 'интеграция переключается');
  await go('tab', 'columns'); await shot('27-columns');
  await go('tab', 'labels'); await shot('37-labels');
  const labelsBefore = await count('[data-act="rename-label"]');
  await go('add-label');
  await p.type('[data-f="n"]', 'приёмка');
  await go('save-label');
  await new Promise((r) => setTimeout(r, 90));
  want((await count('[data-act="rename-label"]')) === labelsBefore + 1, 'метка добавилась');
  await go('sec', 'admin'); await shot('28-admin');
  await go('user-profile', '504'); await shot('38-user-profile');
  await p.$eval('[data-f="em"]', (e) => { e.value = 'luka.new@imf.example'; });
  await go('save-user', '504');
  await new Promise((r) => setTimeout(r, 90));
  want((await p.evaluate(() => S.users.find((u) => u.id === 504).em)) === 'luka.new@imf.example', 'профиль в админке сохраняется');
  await go('tab', 'broadcast');
  await go('broadcast');
  await p.type('[data-f="text"]', 'Проверка рассылки со стенда');
  await go('do-broadcast');
  await new Promise((r) => setTimeout(r, 90));
  want((await count('tbody tr')) >= 3, 'рассылка добавилась в список');
  await go('tab', 'feedback'); await shot('29-feedback');
  const openFb = await count('[data-act="resolve-fb"]');
  await p.$eval('[data-act="resolve-fb"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 90));
  want((await count('[data-act="resolve-fb"]')) === openFb - 1, 'фидбек закрывается');
  await go('sec', 'map'); await shot('30-map');

  /* ── поиск и тема ───────────────────────────────────────── */
  await go('search');
  await p.type('#q', 'смета');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.pal .r')) > 1, 'поиск находит по данным');
  await shot('31-palette');
  await p.$eval('.pal .r.ask', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  want((await text('h1')) === 'Ответ по базе', 'вопрос к базе открывает ответ');
  await shot('32-answer');
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await go('sec', 'tasks'); await shot('33-dark');
  await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

  console.log(bad.length ? 'ДЕФЕКТЫ:\n' + [...new Set(bad)].join('\n') : 'дефектов вёрстки и поведения: нет');
  console.log('ошибки JS: ' + (errs.length ? '\n' + errs.join('\n') : 'нет'));
  await b.close();
  process.exit(bad.length || errs.length ? 1 : 0);
})();
