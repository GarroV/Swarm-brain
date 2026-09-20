/* Проверка стенда: щёлкает по нему как человек и СВЕРЯЕТ результат, а не смотрит на картинку.
   Обычный прогон:  node docs/redesign/stand/check.js
   Негативный:      node docs/redesign/stand/check.js break   — обязан напечатать дефекты
   Снимки:          второй аргумент или /tmp/swarm-stand-shots */
const puppeteer = require('/Users/garva/sb-smoke/node_modules/puppeteer-core');
const path = require('path'), fs = require('fs');
const OUT = process.argv[3] || '/tmp/swarm-stand-shots';
/* снимки прошлого прогона удаляются: иначе в папке лежат картинки кода, которого уже нет,
   и смотреть их глазами — значит проверять вчерашний стенд */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.join(__dirname, 'index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* статическая проверка: переменная без объявления в :root молча убивает всё правило */
/* статическая проверка: жёсткая обрезка строки без знака обрезки — текст обрывается на полуслове */
function clipCheck() {
  const bad = [];
  for (const f of fs.readdirSync(path.join(__dirname, 'js'))) {
    const src = fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\.slice\(0,\s*(2[0-9]|[3-9][0-9]|[0-9]{3,})\)/.test(line) && !line.includes('clip('))
        bad.push(`${f}:${i + 1} обрезка строки без «…»: ${line.trim().slice(0, 60)}`);
    });
  }
  return bad;
}

function tokenCheck() {
  const css = fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8');
  const defined = new Set();
  for (const block of css.match(/:root[^{]*\{[^}]*\}/g) || []) for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  const missing = new Set();
  for (const m of css.matchAll(/var\((--[a-z0-9-]+)\s*(,?)/g)) if (!defined.has(m[1]) && !m[2]) missing.add(m[1]);
  return missing.size ? ['токены без объявления: ' + [...missing].join(', ')] : [];
}

(async () => {
  const bad = [...tokenCheck(), ...clipCheck()], errs = [];
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  try {
  /* негативный прогон: ломаем нарочно то, что каждая проверка должна ловить */
  if (process.argv[2] === 'break') await p.addStyleTag({ content: `
    .ib{display:block!important}
    .list td.ck{width:10px!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .chip{white-space:normal!important;width:60px!important}
    .dtab .c{margin-left:0!important}` });

  const sel = (a, id) => `[data-act="${a}"]` + (id !== undefined ? `[data-id="${id}"]` : '');
  const click = async (s) => {
    const ok = await p.$eval(s, (e) => { e.click(); return true; }).catch(() => false);
    if (!ok) bad.push('НЕТ ЭЛЕМЕНТА: ' + s);
    await new Promise((r) => setTimeout(r, 90));
  };
  const go = (a, id) => click(sel(a, id));
  const gov = (a, v) => click(`[data-act="${a}"][data-v="${v}"]`);
  const count = (s) => p.$$eval(s, (els) => els.length);
  const text = (s) => p.$eval(s, (e) => e.textContent.trim()).catch(() => '');
  /* чтение, которое не валит прогон: элемента нет — вернётся null, и проверка честно упадёт */
  const seen = (s, fn) => p.$eval(s, fn).catch(() => null);
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
    document.querySelectorAll('.chip,.btn,.tab,.mini,.cev,.tdh').forEach((e) => {
      if (e.offsetHeight && e.scrollHeight > e.clientHeight + 2) out.push('текст не влез в «' + e.textContent.trim().slice(0, 22) + '»');
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
    /* однострочный подвал карточки не имеет права переноситься:
       из-за этого карточки в ряду разной высоты, а сетка выглядит рваной */
    document.querySelectorAll('.rec .m, .qh, .card .m').forEach((e) => {
      const lh = parseFloat(getComputedStyle(e).lineHeight) || 18;
      if (e.offsetHeight > lh * 1.75 + 6)
        out.push('подвал карточки перенёсся: «' + e.textContent.trim().slice(0, 24) + '» h=' + e.offsetHeight);
    });
    /* зачёркнутый текст — только у намеренно снятого (.dropped).
       Иначе это столкновение имён классов: новый .off перекрасил .state.off */
    document.querySelectorAll('.body *, .detail *').forEach((e) => {
      if (!e.offsetParent) return;
      if (getComputedStyle(e).textDecorationLine.includes('line-through') && !e.closest('.dropped'))
        out.push('зачёркнуто без причины: ' + e.textContent.trim().slice(0, 24));
    });
    /* заголовок колонки обрезан — колонку сделали уже её же названия */
    document.querySelectorAll('th').forEach((th) => {
      if (th.textContent.trim() && th.scrollWidth > th.clientWidth + 1)
        out.push('заголовок колонки обрезан: ' + th.textContent.trim());
    });
    /* имя человека нельзя обрезать: «Марко Дамья…» — это уже не идентификация */
    document.querySelectorAll('td').forEach((td) => {
      if (!td.querySelector('.av')) return;
      if (td.scrollWidth > td.clientWidth + 1) out.push('имя обрезано: ' + td.textContent.trim().slice(0, 22));
    });
    /* кнопки встали друг под друга там, где места хватало на строку */
    {
      const parents = new Set([...document.querySelectorAll('.btn')].map((b) => b.parentElement));
      parents.forEach((par) => {
        const bs = [...par.children].filter((c) => c.classList.contains('btn') && c.offsetHeight > 0);
        if (bs.length < 2) return;
        const tops = bs.map((b) => Math.round(b.getBoundingClientRect().top));
        if (Math.max(...tops) - Math.min(...tops) < 4) return;
        const need = bs.reduce((a, b) => a + b.offsetWidth, 0) + 8 * (bs.length - 1);
        if (need <= par.clientWidth) out.push('кнопки встали друг под друга, хотя строка вмещала: ' + bs.map((b) => b.textContent.trim().slice(0, 14)).join(' / '));
      });
    }
    /* глагол в мужском роде про человека, чей род не известен системе */
    {
      const txt = [document.querySelector('.body'), document.querySelector('.detail'), document.querySelector('.modal')]
        .filter(Boolean).map((e) => e.innerText).join('\n');
      /* \b в JS определён по ASCII, поэтому с кириллицей не работает —
         границы слова задаём явным отрицанием русских букв */
      const bad = txt.match(/(?<![а-яёА-ЯЁ])(создал|перевёл|взял|убрал|вернул|поменял|добавил|отметил|назначил|закрыл|открыл)(?![а-яёА-ЯЁ])/g);
      if (bad) out.push('глагол в мужском роде: ' + [...new Set(bad)].join(', '));
    }
    /* русские числительные: «2 задач» и «1 задачи» — ошибка в пользовательском тексте */
    {
      const txt = (document.querySelector('.body') || document.body).innerText;
      const forms = { 'задач': ['задача', 'задачи', 'задач'], 'встреч': ['встреча', 'встречи', 'встреч'],
        'фрагмент': ['фрагмент', 'фрагмента', 'фрагментов'], 'человек': ['человек', 'человека', 'человек'] };
      const right = (n, f) => { const a = Math.abs(n) % 100, b = a % 10;
        return a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]; };
      for (const stem of Object.keys(forms)) {
        const re = new RegExp('(\\d+)\\s(' + stem + '[а-яё]*)', 'g');
        let m;
        while ((m = re.exec(txt))) {
          const want = right(+m[1], forms[stem]);
          if (m[2] !== want) out.push(`числительное: «${m[0]}» вместо «${m[1]} ${want}»`);
        }
      }
    }
    /* таблица должна занимать свой контейнер: пустой хвост справа читается как сломанная вёрстка */
    document.querySelectorAll('.list table').forEach((tb) => {
      const cols = [...tb.querySelectorAll('thead th')].filter((t) => t.offsetWidth > 0);
      const sum = cols.reduce((a, t) => a + t.offsetWidth, 0);
      if (tb.clientWidth - sum > 24)
        out.push(`колонки не заполняют таблицу: ${sum}px из ${tb.clientWidth}px, справа пустая полоса`);
    });

    /* выбранное состояние должно быть видно: класс .on без своего стиля — невидимый выбор */
    document.querySelectorAll('.btn.on, .mini.on, .chip.on, .mi.on').forEach((on) => {
      const base = on.className.split(' ')[0];
      const sib = [...on.parentElement.children].find((e) =>
        e !== on && e.classList.contains(base) && !e.classList.contains('on'));
      if (!sib) return;
      const a = getComputedStyle(on), b = getComputedStyle(sib);
      if (a.backgroundColor === b.backgroundColor && a.color === b.color && a.borderColor === b.borderColor && a.fontWeight === b.fontWeight)
        out.push(`выбранное «${on.textContent.trim().slice(0, 24)}» выглядит как невыбранное`);
    });

    /* встречи дня не должны уезжать за край: скрытую встречу человек просто не увидит */
    document.querySelectorAll('.cal').forEach((c) => {
      if (c.scrollWidth > c.clientWidth + 2) out.push(`полоса встреч уходит за край на ${c.scrollWidth - c.clientWidth}px`);
    });

    /* поле ввода не должно обрезать собственное значение; у нативной даты обрезка внутренняя,
       её видно только по ширине — 130px это минимум под «дд.мм.гггг» и иконку календаря */
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!el.offsetParent || el.type === 'checkbox') return;
      if (el.scrollWidth > el.clientWidth + 2)
        out.push(`поле «${el.type || el.tagName.toLowerCase()}» уже своего содержимого на ${el.scrollWidth - el.clientWidth}px`);
      if (el.type === 'date' && el.clientWidth < 130)
        out.push(`поле даты шириной ${el.clientWidth}px — год и календарь не помещаются`);
    });

    /* содержимое не должно вылезать за ячейку: обрезанная кнопка нажимается вслепую */
    document.querySelectorAll('.list td').forEach((td) => {
      const box = td.getBoundingClientRect();
      td.querySelectorAll('.btn, .state, .tag').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > box.right + 2)
          out.push(`«${el.textContent.trim().slice(0, 24)}» вылезает из своей колонки на ${Math.round(r.right - box.right)}px`);
      });
    });

    /* вкладки не должны прятаться за краем: обрезанная вкладка недоступна */
    document.querySelectorAll('.dtabs, .tabs').forEach((t) => {
      if (t.scrollWidth > t.clientWidth + 2) out.push(`вкладки не помещаются и обрезаются: ${t.textContent.trim().slice(0, 60)}`);
    });

    /* красная дата читается как «просрочено»: уместна только в колонке срока и только у незакрытой задачи */
    document.querySelectorAll('table').forEach((tb) => {
      const heads = [...tb.querySelectorAll('thead th')].map((t) => t.textContent.trim().toLowerCase());
      tb.querySelectorAll('tbody tr').forEach((tr) => {
        [...tr.children].forEach((td, i) => {
          if (!td.querySelector('.due.now, .due.soon')) return;
          if (!/срок|дедлайн|просрочено/.test(heads[i] || '')) out.push(`дата покрашена как срок в колонке «${heads[i] || i}»`);
          else if (tr.querySelector('.d-done')) out.push('красный срок у завершённой задачи');
        });
      });
    });
    if (document.querySelector('[data-drop="done"] .due.now')) out.push('красный срок у карточки в колонке «Готово»');

    /* карточки одного ряда сетки должны быть одной высоты */
    const grids = document.querySelectorAll('.grid');
    grids.forEach((g) => {
      const kids = [...g.children].filter((c) => c.offsetHeight > 0);
      if (kids.length < 2) return;
      const byTop = {};
      kids.forEach((c) => { const t = Math.round(c.getBoundingClientRect().top); (byTop[t] = byTop[t] || []).push(c); });
      Object.values(byTop).forEach((row) => {
        if (row.length < 2) return;
        const h = row.map((c) => c.offsetHeight);
        if (Math.max(...h) - Math.min(...h) > 2) out.push('карточки в ряду разной высоты: ' + h.join('/'));
      });
    });

    /* сноска обязана указывать на существующий источник и открывать его:
       номер без строки в списке — выдуманная ссылка, проверить её человек не может */
    document.querySelectorAll('.answer').forEach((a) => {
      const nums = new Set([...a.querySelectorAll('.rowset .k')]
        .map((k) => (k.textContent.trim().match(/^(\d+)\s*·/) || [])[1]).filter(Boolean));
      a.querySelectorAll('sup').forEach((s) => {
        const n = s.textContent.trim();
        if (!nums.has(n)) out.push('сноска ' + n + ' без источника в списке');
        else if (!s.dataset.act) out.push('сноска ' + n + ' никуда не ведёт');
      });
    });

    /* data-act без обработчика: клик по такой кнопке не делает ничего и не жалуется.
       Поля формы не в счёт — их действие обрабатывают слушатели input/change */
    if (typeof ACTS === 'object') {
      const miss = new Set();
      document.querySelectorAll('[data-act]').forEach((e) => {
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)) return;
        if (!ACTS[e.dataset.act] && e.offsetParent) miss.add(e.dataset.act); });
      miss.forEach((a) => out.push('действие «' + a + '» некому обработать'));
    }

    /* чип-заглушка: выглядит фильтром (а с .on — включённым), но клик ничего не меняет */
    document.querySelectorAll('.chip[data-act="noop"]').forEach((c) =>
      out.push('чип «' + c.textContent.trim().slice(0, 24) + '» ничего не фильтрует'));

    /* в одной колонке пустое значение обязано выглядеть одинаково: либо везде прочерк, либо нигде.
       Иначе пустая клетка читается как «не поместилось», а не как «значения нет» */
    document.querySelectorAll('table').forEach((tb) => {
      const heads = [...tb.querySelectorAll('thead th')].map((t) => t.textContent.trim());
      const rows = [...tb.querySelectorAll('tbody tr')].filter((r) => !r.classList.contains('sect'));
      heads.forEach((h, i) => {
        let dash = 0, blank = 0;
        rows.forEach((r) => { const td = r.children[i]; if (!td) return;
          const t = td.textContent.trim();
          if (t === '—') dash++; else if (!t && !td.querySelector('input,button,svg,img')) blank++; });
        if (dash && blank) out.push(`колонка «${h}»: пустое то прочерком, то пустотой (${dash}/${blank})`);
      });
    });

    /* поле с одним значением не имеет права показывать несколько выбранных */
    document.querySelectorAll('[data-pick][data-one]').forEach((b) => {
      const on = b.querySelectorAll('.chip.on').length;
      if (on > 1) out.push(`в поле «${b.dataset.pick}» отмечено ${on} значения, а хранится одно`);
    });

    /* код, просочившийся в интерфейс: комментарий, невыполненная подстановка, «undefined».
       Это ловится только по тексту — ни одно правило вёрстки такого не видит */
    {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.parentElement && n.parentElement.closest('pre, code, script, style')) continue;
        const t = n.textContent;
        const hit = ['/*', '*/', '${', '[object Object]', 'undefined', 'NaN'].find((x) => t.includes(x));
        if (hit && !seen.has(hit)) { seen.add(hit);
          out.push(`в интерфейс попал код («${hit}»): ${t.trim().slice(0, 48)}`); }
      }
    }

    /* колонка, где у одних строк кнопка, а у других — слово состояния: заголовок обещает одно,
       а показывает то действие, то статус (и у части строк состояние вообще не названо) */
    document.querySelectorAll('table').forEach((tb) => {
      const heads = [...tb.querySelectorAll('thead th')].map((t) => t.textContent.trim());
      const rows = [...tb.querySelectorAll('tbody tr')].filter((r) => !r.classList.contains('sect'));
      heads.forEach((h, i) => {
        let btns = 0, states = 0;
        rows.forEach((r) => { const td = r.children[i]; if (!td) return;
          if (td.querySelector('button')) btns++;
          if (td.querySelector('.state')) states++; });
        if (btns && states) out.push(`колонка «${h}»: то кнопка, то состояние (${btns}/${states})`);
      });
    });

    /* «Просрочено» и «Сегодня» — это требование к действию: завершённой задаче там не место */
    {
      let head = '';
      document.querySelectorAll('tbody tr').forEach((r) => {
        if (r.classList.contains('sect')) { head = r.textContent.trim(); return; }
        if (/просрочено|сегодня/i.test(head) && r.querySelector('.d-done'))
          out.push(`в разделе «${head.split('·')[0].trim()}» лежит завершённая задача: ${r.textContent.trim().slice(0, 28)}`);
      });
    }
    return out;
  });
  /* одно состояние — один цвет во всём стенде: «в работе» не может быть зелёным в таблице
     и синим на доске, иначе цвет перестаёт что-либо значить */
  const stateSeen = new Map();
  const collectStates = async (name) => {
    const list = await p.evaluate(() => [...document.querySelectorAll('.state')]
      .map((e) => [e.textContent.trim(), e.className]));
    list.forEach(([t, cls]) => {
      const prev = stateSeen.get(t);
      if (!prev) stateSeen.set(t, { cls, where: name });
      else if (prev.cls !== cls)
        bad.push(`состояние «${t}» покрашено по-разному: «${prev.cls}» на ${prev.where}, «${cls}» на ${name}`);
    });
  };
  const shot = async (name) => { await p.screenshot({ path: `${OUT}/${name}.png` });
    await collectStates(name);
    (await measure()).forEach((m) => bad.push(`${name}: ${m}`)); };
  /* замер без снимка: состояние, которое живёт только между кликами, иначе правилами не проверяется */
  const scan = async (name) => (await measure()).forEach((m) => bad.push(`${name}: ${m}`));

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
  await gov('mk-filter', 'HR');
  const hrTasks = await count('tbody tr[data-act="open-task"]');
  await gov('mk-filter', '');
  const allTasks = await count('tbody tr[data-act="open-task"]');
  want(hrTasks < allTasks, `фильтр по рынку сузил список (${allTasks} → ${hrTasks})`);
  await go('tab', 'today');
  want((await count('.cal .cev')) === 3, 'календарь дня показывает встречи из Google');
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
  await go('dtab', 'links');
  await go('add-link');
  await go('do-link');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('[data-act="drop-link"]')) === 1, 'связь между задачами добавилась');
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
  /* пустой срез обязан объяснить себя и вернуть человека к данным */
  await p.type('[data-qin="tasks"]', 'щщщ');
  await new Promise((r) => setTimeout(r, 150));
  want((await count('tbody tr.row')) === 0, 'фильтр по названию может обнулить срез');
  want(/скрывают ещё \d+/.test(await text('.empty')), 'пустой срез называет, сколько скрыто фильтрами');
  want(await seen('[data-act="reset-filters"]', (e) => { const r = e.getBoundingClientRect();
    return r.width > 0 && r.bottom <= window.innerHeight; }) === true, 'кнопка «Показать все» видна, а не за краем экрана');
  await go('reset-filters');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('tbody tr.row')) > 0, '«Показать все» возвращает задачи в срез');
  /* «Все» = мои + командные (решение владельца 2026-08-20), чужие личные — только под «Все сотрудники» */
  want((await count('tbody tr.row')) === await p.evaluate(() =>
    S.tasks.filter((t) => t.arch && inLens(t, 'all')).length), 'архив под линзой «Все» показывает мои и командные')
  const archAll = await p.evaluate(() => S.tasks.filter((t) => t.arch).length);
  await go('tgl', 'staff');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('tbody tr.row')) === archAll, `«Все сотрудники» открывает весь архив (${archAll})`);
  await go('tgl', 'staff');
  await go('open-task', (await p.$eval('tbody tr[data-act="open-task"]', (e) => e.dataset.id)));
  const archActs = await p.$$eval('.detail .d-acts .btn', (els) => els.map((e) => e.textContent.trim()).join(' | '));
  want(archActs.includes('Вернуть'), `в архиве предлагается вернуть задачу (кнопки: ${archActs})`);
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
  /* помечено должно быть то, что требует действия: непроверенных пунктов столько же, сколько помечено */
  const cmp = await p.evaluate(() => {
    const m = S.meetings.find((x) => x.id === S.sel);
    const un = m.tez.reduce((n, s) => n + s.li.filter((x) => !tezConfirmed(m, x)).length, 0);
    return { un, marked: document.querySelectorAll('.modal .tez li.hl').length,
      hint: document.querySelector('.modal .hint').textContent };
  });
  want(cmp.un > 0 && cmp.marked === cmp.un, `помечены недоказанные пункты (${cmp.marked} из ${cmp.un})`);
  want(cmp.hint.includes(String(cmp.un)), 'подпись называет, сколько пунктов без подтверждения');
  await go('mclose');
  await go('harvest');
  await go('do-harvest');
  await new Promise((r) => setTimeout(r, 120));
  want((await text('.toast')).includes('Создано задач'), 'сбор задач из встречи отработал');
  await go('confirm-meet', firstMeet);
  await go('tab', 'review');
  want((await count(`tbody tr[data-act="open-meet"][data-id="${firstMeet}"]`)) === 0, 'подтверждённая встреча ушла из вычитки');
  await go('tab', 'draft'); await shot('10-drafts');
  /* черновик с кандидатом на дубль показан один раз, а не в обеих таблицах сразу */
  const dupTitle = await p.evaluate(() => (S.meetings.find((m) => m.st === 'draft' && m.dupOf) || {}).t);
  want(!!dupTitle, 'в данных есть черновик, похожий на дубль');
  want(await p.evaluate((t) => [...document.querySelectorAll('tbody tr')]
    .filter((r) => r.textContent.includes(t)).length === 1, dupTitle), 'черновик-дубль не задвоен на экране');
  /* «похож на» называет настоящую встречу, а не первую попавшуюся из списка */
  want(await p.evaluate(() => {
    const m = S.meetings.find((x) => x.st === 'draft' && x.dupOf);
    const o = S.meetings.find((x) => x.id === m.dupOf);
    return !!o && o.st !== 'draft' && document.body.innerText.includes(o.t);
  }), 'пара дубля — существующая разобранная встреча');
  const below = await count('.list:last-of-type tbody tr');
  await go('keep-dup', await p.evaluate(() => S.meetings.find((m) => m.st === 'draft' && m.dupOf).id));
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.list:last-of-type tbody tr')) === below + 1, '«Не дубль» переводит черновик в остальные, а не прячет его');
  await p.evaluate(() => { S.meetings = S.meetings.map((m) => m.dupOk ? { ...m, dupOk: false } : m); render(); });
  await new Promise((r) => setTimeout(r, 90));
  await go('tab', 'queue'); await shot('11-agent-queue');
  want((await count('.warn .wacts .btn')) === 2, 'подсказка про дубль даёт что-то сделать, а не только пугает');
  await go('not-dup', 'a2');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.warn')) === 0, '«не дубль» снимает пометку');
  const q0 = await count('.qcard');
  const qid = await p.$eval('[data-act="q-accept"]', (e) => e.dataset.id);
  const proposed = await p.evaluate((id) => S.queue.find((q) => q.id === id).tasks.length, qid);
  await p.$eval('[data-act="q-task-off"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 90));
  want((await count('.dropped')) >= 1, 'предложенную задачу можно снять до публикации');
  const tasksBefore = await p.evaluate(() => S.tasks.length);
  await p.$eval('[data-act="q-accept"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  const made = (await p.evaluate(() => S.tasks.length)) - tasksBefore;
  want((await count('.qcard')) === q0 - 1, 'агентская встреча опубликована и ушла из очереди');
  want(made === proposed - 1, `публикация создаёт только оставленные задачи (предложено ${proposed}, создано ${made})`);

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
  const dupIds = await p.evaluate(() => {
    const seen = {}, dup = [];
    [['entries', S.entries], ['files', S.files], ['tasks', S.tasks], ['meetings', S.meetings]].forEach(([k, list]) =>
      list.forEach((x) => { const key = k + ':' + x.id; if (seen[key]) dup.push(key); else seen[key] = 1; }));
    return dup;
  });
  want(dupIds.length === 0, `созданное не занимает чужой идентификатор (${dupIds.join(', ')})`);
  await go('close');
  await go('open-entry', 'r2');
  await go('reader'); await shot('35-reader');
  const readP = await p.$$eval('.reader p', (els) => els.map((e) => e.textContent.trim()));
  const readTitle = await text('.modal .mh b, .modal h3, .modal .mtitle');
  want(readP.length >= 2 && readP.every((t) => t.length > 40) && new Set(readP).size === readP.length,
    `читалка показывает настоящий текст записи, а не заглушку (заголовок: ${readTitle}; абзацев: ${readP.length}; первый: ${(readP[0] || '').slice(0, 50)})`);
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
  /* число у корня обязано сходиться с суммой веток: иначе человек ищет потерянные задачи */
  const tree = await p.evaluate(() => ({
    root: +document.querySelector('.tnode.root .n').textContent,
    label: document.querySelector('.tnode.root').childNodes[0].textContent.trim(),
    tops: [...document.querySelectorAll('.tkids > .tbr > .tnode')].map((e) => +e.querySelector('.n').textContent),
    ws: (S.workspaces.find((w) => w.active) || {}).name,
  }));
  want(tree.root === tree.tops.reduce((a, b) => a + b, 0),
    `корень карты равен сумме веток (${tree.root} против ${tree.tops.join('+')})`);
  want(tree.label === tree.ws, `корень карты назван текущим воркспейсом (${tree.label} против ${tree.ws})`);
  /* имя воркспейса меняется — карта обязана поехать за ним; совпадение с зашитой строкой ничего не доказывает */
  await p.evaluate(() => { S.workspaces = S.workspaces.map((w) => w.active ? { ...w, name: 'Проверка имени' } : w); render(); });
  await new Promise((r) => setTimeout(r, 90));
  want((await text('.tnode.root')).startsWith('Проверка имени'), 'корень карты берёт имя из воркспейса, а не зашит в код');
  await p.evaluate((n) => { S.workspaces = S.workspaces.map((w) => w.active ? { ...w, name: n } : w); render(); }, tree.ws);
  await new Promise((r) => setTimeout(r, 90));
  await go('sec', 'sprints'); await shot('18-board');
  const cardsC2 = await count('.card[data-card]');
  await go('set-cycle', 'c3');
  await new Promise((r) => setTimeout(r, 120));
  const cardsC3 = await count('.card[data-card]');
  want(cardsC3 > 0 && cardsC3 !== cardsC2, `переключатель цикла меняет доску (c2: ${cardsC2}, c3: ${cardsC3})`);
  await go('tab', 'timeline');
  await new Promise((r) => setTimeout(r, 120));
  const tlC3 = await count('.tdi');
  await go('set-cycle', 'c2');
  await new Promise((r) => setTimeout(r, 120));
  const tlC2 = await count('.tdi');
  want(tlC2 !== tlC3, `таймлайн следует за циклом (c3: ${tlC3}, c2: ${tlC2})`);
  await go('tab', 'board');
  await new Promise((r) => setTimeout(r, 120));
  const doneBefore = await count('[data-drop="done"] .card');
  const dragOk = await p.evaluate(() => { const c = document.querySelector('.card[data-card]');
    if (!c) return false;
    c.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() })); return true; });
  want(dragOk, 'на доске есть карточка, которую можно потянуть');
  await new Promise((r) => setTimeout(r, 40));
  await p.evaluate(() => { const z = document.querySelector('[data-drop="done"]'); if (!z) return; const dt = new DataTransfer();
    z.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    z.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt })); });
  await new Promise((r) => setTimeout(r, 140));
  const doneAfter = await count('[data-drop="done"] .card');
  want(doneAfter === doneBefore + 1, `перетаскивание переносит карточку (${doneBefore} → ${doneAfter})`);
  await shot('19-board-after-drop');
  const openBefore = await count('[data-drop="open"] .card');
  await p.$eval('[data-qadd="open"]', (e) => { e.focus(); e.value = 'Быстрая задача с доски'; });
  await p.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 150));
  const openAfter = await count('[data-drop="open"] .card');
  want(openAfter === openBefore + 1, `быстрый ввод в колонке создал карточку (${openBefore} → ${openAfter})`);
  await shot('42-quick-add');
  await go('tab', 'timeline'); await shot('36-timeline');
  want((await count('.tday')) > 3, 'таймлайн разложил задачи по дням');
  await go('tab', 'pool'); await shot('20-initiatives');
  const prop = await count('[data-act="accept-init"]');
  await p.$eval('[data-act="accept-init"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 90));
  await shot('39-accept-dialog');
  await p.$eval('[data-act="do-accept"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  want((await count('[data-act="accept-init"]')) === prop - 1, 'инициатива принята в цикл через диалог');
  await go('tab', 'check'); await shot('21-check');
  const checkRows = await p.$$eval('.rowset > div', (rows) => rows.map((r) => ({
    v: r.querySelector('.v').textContent.trim(), late: (r.querySelector('.a') || {}).textContent || '' })));
  const liar = checkRows.find((r) => /^(\d+) из \1 закрыто$/.test(r.v) && /просрочено/.test(r.late));
  want(!liar, `строка не спорит сама с собой: ${liar ? liar.v + ' · ' + liar.late : 'нет таких'}`);
  await go('tab', 'analytics'); await shot('22-analytics');
  want((await count('.rowset .state.bad')) === 1, 'просрочка в аналитике выделена, а не спрятана среди прочих чисел');
  want((await text('.rowset')).includes('в прошлом цикле'), 'скорость цикла сравнивается с прошлым');
  await go('person-tasks', '501');
  await new Promise((r) => setTimeout(r, 120));
  want((await text('h1')) === 'Задачи', 'клик по полосе нагрузки уводит в задачи человека');
  await go('sec', 'sprints'); await go('tab', 'analytics');
  await go('tab', 'journal'); await shot('23-journal');
  const jm = await p.$$eval('.tl.log .e', (els) => els.map((e) => +e.dataset.m));
  want(jm.length > 3 && jm.every((v, i) => i === 0 || jm[i - 1] <= v),
    `журнал идёт от свежего к старому (${jm.join(' ')})`);
  const jIds = await p.$$eval('.tl.log .lnk', (els) => els.map((e) => +e.textContent.replace(/\D/g, '')));
  const offCycle = await p.evaluate((ids) => ids.filter((id) => (S.tasks.find((t) => t.id === id) || {}).sprint !== S.cycle), jIds);
  want(offCycle.length === 0, `в журнале цикла только задачи цикла (чужие: ${offCycle.join(',')})`);
  await go('set-cycle', 'c3');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.tl.log .e')) === 0 && (await count('.empty b')) === 1,
    'в цикле без движений журнал объясняет пустоту, а не показывает чужие события');
  await go('set-cycle', 'c2');
  await new Promise((r) => setTimeout(r, 120));

  /* ── люди и система ─────────────────────────────────────── */
  await go('sec', 'team'); await shot('24-team');
  const lateCells = await p.$$eval('tbody tr', (rows) => rows.map((r) => {
    const c = r.querySelectorAll('td'); return { late: c[6].textContent.trim(), red: !!c[6].querySelector('.due.now') }; }));
  want(lateCells.some((c) => c.red) && lateCells.some((c) => c.late === '—'),
    'колонка «просрочено» различает людей: у кого-то красное число, у кого-то прочерк');
  const teamAll = await count('tbody tr');
  await go('tgl', 'activeOnly');
  await new Promise((r) => setTimeout(r, 90));
  const teamActive = await count('tbody tr');
  want(teamActive > 0 && teamActive < teamAll, `«только с открытыми задачами» сужает команду (${teamAll} → ${teamActive})`);
  await go('tgl', 'activeOnly');
  await new Promise((r) => setTimeout(r, 90));
  await go('person-tasks', '504');
  await new Promise((r) => setTimeout(r, 120));
  want((await text('h1')) === 'Задачи', 'клик по человеку уводит в его задачи');
  const ofPerson = await count('tr.row');
  want(ofPerson > 0 && (await p.evaluate(() => S.tasks.filter((t) => t.who.includes(504)).length)) >= ofPerson,
    'в списке только задачи выбранного человека');
  await go('drop-assignee');
  await new Promise((r) => setTimeout(r, 90));
  want((await count('tr.row')) > ofPerson, 'фильтр по человеку снимается крестиком');
  await go('sec', 'team');
  await go('tab', 'ws'); await shot('25-workspaces');
  /* читаем клетку по ЗАГОЛОВКУ колонки: «третья ячейка первой таблицы» — это на вкладке
     участников «Рынок» (RS → NaN), и проверка падала случайно, в зависимости от того, что открыто */
  const wsUsers = await p.evaluate(() => {
    const tb = [...document.querySelectorAll('.body table')].find((t) =>
      [...t.querySelectorAll('thead th')].some((h) => h.textContent.trim() === 'Участников'));
    if (!tb) return null;
    const i = [...tb.querySelectorAll('thead th')].findIndex((h) => h.textContent.trim() === 'Участников');
    return +tb.querySelector('tbody tr').children[i].textContent.trim();
  });
  const realUsers = await p.evaluate(() => S.users.length);
  want(wsUsers !== null, 'вкладка воркспейсов открылась');
  want(wsUsers === realUsers, `у текущего воркспейса счётчик людей совпадает с вкладкой «Участники» (${wsUsers} против ${realUsers})`);
  await go('sec', 'projects');
  const prBefore = await count('tr.row');
  await go('switch-ws', 'latam');
  await new Promise((r) => setTimeout(r, 120));
  want(prBefore > 0 && (await count('tr.row')) === 0, 'переключение воркспейса меняет данные, а не только подпись');
  want((await text('.empty b')).length > 0, 'пустой воркспейс объясняет себя, а не показывает белый лист');
  await go('switch-ws', 'cee');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('tr.row')) === prBefore, 'возврат в свой воркспейс возвращает данные');
  await go('sec', 'team');
  await go('sec', 'settings'); await shot('26-settings');
  await go('tab', 'integr');
  await go('integr', 'granola');
  want((await text('.toast')).includes('переключена'), 'интеграция переключается');
  await go('tab', 'notif');
  const onBefore = await count('.state.on');
  await go('notif-pref', 'tez');
  await new Promise((r) => setTimeout(r, 90));
  want((await count('.state.on')) === onBefore - 1, 'уведомление выключается и это видно в списке');
  await go('tab', 'tokens');
  const tokBefore = await text('.rowset code');
  await go('reissue', 'mcp');
  await new Promise((r) => setTimeout(r, 90));
  want((await text('.rowset code')) !== tokBefore, `токен перевыпускается (${tokBefore} → ${await text('.rowset code')})`);
  await go('tab', 'columns'); await shot('27-columns');
  want(await seen('[data-v="0:-1"]', (e) => e.disabled) === true, 'вверх у первой колонки недоступно, а не молчит');
  const lastDown = await p.evaluate(() => S.cols.length - 1);
  want(await seen(`[data-v="${lastDown}:1"]`, (e) => e.disabled) === true, 'вниз у последней колонки недоступно');
  await gov('col-tgl', '1');
  await new Promise((r) => setTimeout(r, 90));
  want((await text('.rowset')).includes('скрыта'), 'скрытая колонка названа словом, а не только текстом кнопки');
  await gov('col-tgl', '1');
  const colsBefore = await count('[data-act="col-tgl"]');
  await go('add-col');
  await p.type('[data-f="n"]', 'На проверке');
  await go('do-add-col');
  await new Promise((r) => setTimeout(r, 90));
  want((await count('[data-act="col-tgl"]')) === colsBefore + 1, 'колонка доски добавляется');
  await go('reset-cols');
  await new Promise((r) => setTimeout(r, 90));
  want((await count('[data-act="col-tgl"]')) === colsBefore, 'колонки возвращаются по умолчанию');
  await go('tab', 'labels'); await shot('37-labels');
  const labelsBefore = await count('[data-act="rename-label"]');
  await go('add-label');
  await p.type('[data-f="n"]', 'приёмка');
  await go('save-label');
  await new Promise((r) => setTimeout(r, 90));
  want((await count('[data-act="rename-label"]')) === labelsBefore + 1, 'метка добавилась');
  await go('sec', 'admin'); await shot('28-admin');
  const allUsers = await count('tbody tr');
  await go('tgl-nomail');
  await new Promise((r) => setTimeout(r, 90));
  const noMail = await count('tbody tr');
  want(noMail > 0 && noMail < allUsers, `фильтр «только без почты» сужает список (было ${allUsers}, стало ${noMail})`);
  want((await count('[data-act="user-profile"].attn')) === noMail, 'кнопка «привязать почту» стоит ровно у тех, у кого почты нет');
  await go('tgl-nomail');
  await new Promise((r) => setTimeout(r, 90));
  await go('new-user');
  await p.type('[data-f="n"]', 'Петар Ковачевич');
  await go('save-user');
  await new Promise((r) => setTimeout(r, 90));
  want((await count('tbody tr')) === allUsers + 1, 'новый сотрудник добавляется в воркспейс');
  await go('user-profile', '504'); await shot('38-user-profile');
  /* модель хранит один рынок: форма не должна позволять отметить несколько */
  await p.$$eval('[data-pick="mk"] .chip', (els) => { els[0].click(); els[3].click(); });
  want((await count('[data-pick="mk"] .chip.on')) === 1, 'рынок в профиле выбирается один, а не молча теряется при сохранении');
  await scan('38-профиль-выбор-рынка');
  const wantMk = await p.$eval('[data-pick="mk"] .chip.on', (e) => e.dataset.v);
  await go('save-user', '504');
  await new Promise((r) => setTimeout(r, 90));
  want((await p.evaluate(() => S.users.find((u) => u.id === 504).mk)) === wantMk,
    `сохранился именно выбранный рынок (${wantMk})`);
  await go('user-profile', '504');
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
  const fbAll = await count('tbody tr.row');
  await go('fb-open');
  await new Promise((r) => setTimeout(r, 90));
  const fbOpen = await count('tbody tr.row');
  want(fbOpen < fbAll && fbOpen === await p.evaluate(() => S.feedback.filter((f) => f.st === 'open').length),
    'чип «Открыто» фильтрует список, а не украшает шапку');
  want((await text('.bar .right')).includes(`Показано ${fbOpen} из ${fbAll}`), 'шапка говорит, сколько показано из скольких');
  await go('fb-open');
  await new Promise((r) => setTimeout(r, 90));
  want(await p.evaluate(() => [...document.querySelectorAll('tbody tr.row')].every((r) =>
    r.children[4].textContent.trim() === 'открыт' || r.children[4].textContent.trim() === 'закрыт'),
  ), 'статус фидбека назван словом в своей колонке');
  const openFb = await count('[data-act="resolve-fb"]');
  await p.$eval('[data-act="resolve-fb"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 90));
  want((await count('[data-act="resolve-fb"]')) === openFb - 1, 'фидбек закрывается');
  await go('tab', 'review'); await shot('40-review-counts');
  /* два числа на экране не должны спорить: в шапке названы и встречи, и строки по людям */
  const seats = await p.evaluate(() => {
    const tb = document.querySelector('.body table');
    const i = [...tb.querySelectorAll('thead th')].findIndex((h) => h.textContent.trim() === 'Ждёт вычитки');
    return [...tb.querySelectorAll('tbody tr')].reduce((n, r) => n + (+r.children[i].textContent.trim() || 0), 0);
  });
  want((await text('.bar .right')).includes(`${seats}`), `шапка очереди называет сумму по людям (${seats})`);
  want((await text('.bar > span')).includes(await p.evaluate(() => String(S.meetings.filter((m) => m.st === 'pending').length))),
    'шапка очереди называет число невычитанных встреч');
  await go('sec', 'map'); await shot('30-map');

  /* ── поиск и тема ───────────────────────────────────────── */
  await go('search');
  await p.type('#q', 'смета');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.pal .r')) > 1, 'поиск находит по данным');
  want(await p.evaluate(() => { const rows = [...document.querySelectorAll('.pal .res > *')];
    const i = rows.findIndex((e) => e.dataset.act === 'show-all');
    return i > 0 && rows[i - 1].className === 'grp'; }),
    'служебные действия палитры отделены заголовком, а не висят хвостом группы «Файлы»');
  await shot('31-palette');
  await p.$eval('[data-act="show-all"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  want((await text('h1')) === 'Результаты поиска', 'экран поиска открывается из палитры');
  want((await p.evaluate(() => searchAll('смета').tasks.some((t) => t.t.toLowerCase().includes('смету')))),
    'поиск находит слово в другой форме («смета» → «смету»)');
  want((await count('.srch mark')) > 0, 'в результатах видно, за что нашлось — совпадение подсвечено');
  want((await count('.srch .rowset > div')) > 1, 'на экране поиска есть находки');
  await shot('41-search');
  await go('search');
  await p.type('#q', 'смета');
  await new Promise((r) => setTimeout(r, 120));
  await p.$eval('.pal .r.ask', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  want((await text('h1')) === 'Ответ по базе', 'вопрос к базе открывает ответ');
  await shot('32-answer');
  /* сноска — рабочая ссылка на источник, а не значок */
  await p.$eval('.answer sup', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  want((await text('.detail .d-title')).includes('Планёрка по открытию'), 'сноска в ответе открывает свой источник');
  /* вне своей темы написанный от руки ответ был бы выдумкой со ссылками на непричастные встречи */
  await go('search');
  await p.type('#q', 'график');
  await new Promise((r) => setTimeout(r, 120));
  await p.$eval('.pal .r.ask', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  want(!(await text('.answer .a')).includes('смета по оборудованию'), 'ответ на другой запрос не пересказывает чужую тему');
  const ansSrc = await p.$$eval('.answer .rowset .v', (els) => els.map((e) => e.textContent.trim()));
  want(ansSrc.length > 0 && await p.evaluate((list) => { const r = searchAll('график');
    const all = [...r.tasks.map((t) => t.t), ...r.meetings.map((m) => m.t),
      ...r.entries.map((e) => e.h), ...r.files.map((f) => f.n)];
    return list.every((x) => all.includes(x)); }, ansSrc), 'источники ответа — реально найденные записи');
  await shot('32-answer-other');
  /* пустой ответ говорит «нет», а не показывает выдуманные источники */
  await go('search');
  await p.type('#q', 'ксилофон');
  await new Promise((r) => setTimeout(r, 120));
  await p.$eval('.pal .r.ask', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.answer .rowset')) === 0 && (await text('.answer .a')).includes('нет ничего'),
    'на пустой запрос ответ честен: источников нет');
  /* узкое окно ноутбука */
  await p.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 });
  await go('sec', 'tasks');
  await p.$eval('tbody tr[data-act="open-task"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 120));
  await shot('43-narrow-1200');
  /* 1160 — зазор между «деталь в сетке» и «деталь поверх»: пороги CSS и JS должны совпадать */
  await p.setViewport({ width: 1160, height: 800, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 200));
  await shot('45-narrow-1160');
  await p.setViewport({ width: 1100, height: 780, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 200));
  await shot('44-narrow-1100');
  await go('close');
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  /* палитра с клавиатуры */
  await go('search');
  await p.type('#q', 'смет');
  await new Promise((r) => setTimeout(r, 120));
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 150));
  want((await count('.detail .d-title')) === 1, 'палитра открывает находку с клавиатуры');
  await go('close');
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await go('sec', 'tasks'); await shot('33-dark');
  await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

  /* пустой воркспейс: ни один экран не имеет права быть белым листом */
  await p.evaluate(() => A.switchWorkspace('latam'));
  await new Promise((r) => setTimeout(r, 120));
  const secs = await p.evaluate(() => [...document.querySelectorAll('[data-act="sec"]')].map((e) => e.dataset.id));
  for (const sec of secs) {
    await p.evaluate((x) => A.go(x), sec);
    await new Promise((r) => setTimeout(r, 90));
    const tabs = await p.evaluate(() => [...document.querySelectorAll('[data-act="tab"]')].map((e) => e.dataset.id));
    for (const tab of (tabs.length ? tabs : [null])) {
      if (tab) { await p.evaluate((x) => A.tab(x), tab); await new Promise((r) => setTimeout(r, 90)); }
      const info = await p.evaluate(() => ({
        empty: !!document.querySelector('.empty'),
        rows: document.querySelectorAll('tr.row').length,
        len: (document.querySelector('.body') || document.body).innerText.trim().length,
        rowset: document.querySelectorAll('.rowset > div').length,
      }));
      if (!info.empty && !info.rows && !info.rowset && info.len < 260)
        bad.push(`пустой экран без объяснения: ${sec}${tab ? ' / ' + tab : ''}`);
    }
  }
  await p.evaluate(() => A.switchWorkspace('cee'));
  await new Promise((r) => setTimeout(r, 120));

  } catch (e) {
    /* упавший $eval раньше убивал прогон: отчёт не печатался, а все проверки ниже молча не выполнялись */
    bad.push('ПРОГОН ОБОРВАЛСЯ: ' + e.message + ' — проверки после этого места не выполнялись');
  }
  console.log(bad.length ? 'ДЕФЕКТЫ:\n' + [...new Set(bad)].join('\n') : 'дефектов вёрстки и поведения: нет');
  console.log('ошибки JS: ' + (errs.length ? '\n' + errs.join('\n') : 'нет'));
  await b.close();
  process.exit(bad.length || errs.length ? 1 : 0);
})();
