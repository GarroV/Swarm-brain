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

/* статическая проверка: разрушительное действие обязано спрашивать.
   Вручную такое не удержишь — удаление метки молча снимало её с семи задач, «Вернуть
   колонки» выбрасывало добавленные пользователем. Список разрушителей берётся из
   store.js сам, чтобы правило срабатывало и на те, которых ещё не написали: метод
   разрушителен, если назван del/drop/delete/remove/reset/revoke/purge/clear ИЛИ
   выбрасывает элементы из набора, ничего не создавая взамен. Действие с таким методом
   либо открывает modal(), либо само зовётся do-* и достижимо только из этой модалки. */
function confirmCheck() {
  const src = (f) => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
  const store = src('store.js'), app = src('app.js');
  /* Осознанные исключения — с причиной, а не молча: правило без причины превращается
     в список «тут не смотрим», и следующий человек припишет туда что угодно. */
  const ALLOWED = {
    dropLink: 'связь снимается и возвращается на том же экране кнопкой «Связать» — два клика, терять нечего',
    resetFilters: 'сброс вида, а не данных',
    close: 'закрывает панель детали, данных не трогает',
    dropItem: 'задача выходит из спринта и тут же видна в пуле слева кнопкой «Взять» — терять нечего',
  };
  /* разбор методов store: однострочный `  name(a) { … },` и многострочный до `  },` */
  const methods = [];
  {
    const lines = store.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].match(/^  (\w+)\(/);
      if (!h) continue;
      let body = lines[i];
      if (!/\},\s*$/.test(lines[i]))
        for (let j = i + 1; j < lines.length && !/^  \},/.test(lines[j - 1]); j++) body += '\n' + lines[j];
      methods.push({ name: h[1], body });
    }
  }
  const destructive = new Set();
  for (const { name, body } of methods) {
    if (ALLOWED[name]) continue;
    const byName = /^(del|drop|delete|remove|reset|revoke|purge|clear|close)/.test(name);
    /* создаёт взамен (новая задача, встреча, добавление в набор) — это ход процесса,
       а не потеря: принятие из очереди уносит карточку, но взамен появляются строки */
    const makes = /mk(Task|Meet)\(|= \[[^\]]*\.\.\.S\./.test(body);
    const byShape = /S\.\w+ = S\.\w+\.filter\(/.test(body) && !makes;
    if (byName || byShape) destructive.add(name);
  }
  /* разбор карты действий app.js: заголовок — строка вида `  "имя": (…) =>` */
  const acts = [];
  let cur = null;
  for (const line of app.split('\n')) {
    const h = line.match(/^  "?([\w-]+)"?:\s*(\(|async)/);
    if (h) { cur = { name: h[1], body: line }; acts.push(cur); }
    else if (cur) cur.body += '\n' + line;
  }
  const calls = (body) => [...destructive].filter((d) => new RegExp('A\\.' + d + '\\b').test(body));
  const bad = [];
  for (const a of acts) {
    const hit = calls(a.body);
    if (!hit.length || a.name.startsWith('do-') || /\bmodal\(/.test(a.body)) continue;
    bad.push(`действие «${a.name}» рушит данные (${hit.join(', ')}) без подтверждения`);
  }
  /* обратная сторона: подтверждающее do-* обязано жить только в модалке — кнопка с ним
     на экране минует вопрос, и правило выше становится декорацией */
  const screens = fs.readdirSync(path.join(__dirname, 'js')).filter((f) => f.startsWith('screens') || f === 'detail.js');
  for (const a of acts) {
    if (!a.name.startsWith('do-') || !calls(a.body).length) continue;
    for (const f of screens)
      if (src(f).includes(`"${a.name}"`)) bad.push(`подтверждающее «${a.name}» вызывается с экрана ${f} в обход вопроса`);
  }
  return bad;
}

/* статическая проверка: два ключа с одним именем в объекте. JavaScript молча оставляет
   ПОСЛЕДНИЙ, поэтому свежий код может быть мёртв с рождения: в store.js рядом лежали
   работающий closeCycle и старая заглушка, побеждала заглушка — кнопка печатала
   «Цикл закрыт, хвосты перенесены» и не делала ничего. */
function dupKeyCheck() {
  const bad = [];
  for (const f of fs.readdirSync(path.join(__dirname, 'js'))) {
    const lines = fs.readFileSync(path.join(__dirname, 'js', f), 'utf8').split('\n');
    /* имена считаем В ПРЕДЕЛАХ ОДНОГО объекта: «tasks» законно живёт и в TABS, и в SCREENS */
    let seen = new Map(), obj = '';
    lines.forEach((line, i) => {
      const open = line.match(/^(?:const|let|var)\s+(\w+)\s*=\s*\{\s*$/);
      if (open) { seen = new Map(); obj = open[1]; return; }
      if (/^\};?\s*$/.test(line)) { seen = new Map(); obj = ''; return; }
      if (!obj) return;
      const m = line.match(/^  "?([\w-]+)"?\s*[:(]/);
      if (!m) return;
      if (seen.has(m[1])) bad.push(`${f}: в ${obj} ключ «${m[1]}» объявлен дважды (строки ${seen.get(m[1])} и ${i + 1}) — работает последний`);
      else seen.set(m[1], i + 1);
    });
  }
  return bad;
}

/* статическая проверка: зашитый идентификатор сущности в создании. Урок продукта —
   `group_id: "cee"` в read-ai-webhook: ренейм слага молча ломал логику. В стенде так же
   молча всё созданное из встречи приписывалось проекту «p1». */
function hardIdCheck() {
  const bad = [];
  for (const f of fs.readdirSync(path.join(__dirname, 'js'))) {
    if (f === 'data.js') continue;   /* данные стенда — это и есть литералы */
    fs.readFileSync(path.join(__dirname, 'js', f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\/?\*)/.test(line)) return;   /* в комментарии литерал — это объяснение, а не привязка */
      const m = line.match(/\b(pr|group_id|parent|sprint|ws)\s*:\s*"([a-z]+\d+[a-z]?)"/);
      if (m) bad.push(`${f}:${i + 1} зашитый идентификатор ${m[1]}: "${m[2]}" — привяжется молча и не к тому`);
    });
  }
  return bad;
}

/* статическая проверка: действие, которое ТОЛЬКО сообщает об успехе. closeCycle печатал
   «Цикл закрыт, хвосты перенесены» и не трогал ни цикл, ни задачи — такая кнопка хуже
   отсутствующей, потому что человек считает дело сделанным. */
function toastOnlyCheck() {
  const bad = [];
  const store = fs.readFileSync(path.join(__dirname, 'js', 'store.js'), 'utf8').split('\n');
  for (let i = 0; i < store.length; i++) {
    const h = store[i].match(/^  (\w+)\(/);
    if (!h) continue;
    let body = store[i], j = i;
    while (!/\},\s*$/.test(store[j]) && j < store.length - 1) body += '\n' + store[++j];
    const inner = body.replace(/^[^{]*\{/, '').replace(/\},\s*$/, '');
    const lines = inner.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('//'));
    if (!lines.length) continue;
    const onlyToast = lines.every((l) => /^A\.toast\(/.test(l) || /^render\(\);?$/.test(l));
    if (onlyToast && /toast/.test(inner) && !/^toast$/.test(h[1]))
      bad.push(`${h[1]}() только печатает сообщение об успехе и ничего не меняет`);
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
  const bad = [...tokenCheck(), ...clipCheck(), ...confirmCheck(), ...dupKeyCheck(), ...hardIdCheck(), ...toastOnlyCheck()], errs = [];
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  /* первый замер уходил раньше, чем каркас успевал отрисоваться и применить шрифт:
     прогон изредка печатал «НЕТ ЭЛЕМЕНТА» и «заголовок колонки обрезан» на ровном
     месте (примерно раз на восемь прогонов). Проверяющий, который иногда врёт,
     обесценивает зелёный результат, поэтому ждём готовности явно. */
  const ready = await p.waitForFunction(() => window.__renders > 0
    && document.querySelector('.nav [data-act="sec"]'), { timeout: 15000 })
    .then(() => true).catch(() => false);
  if (!ready) { console.log('ПРОГОН НЕ НАЧАЛСЯ: стенд не отрисовался за 15 с'); await b.close(); process.exit(1); }
  /* замер обязан идти по ФИРМЕННОМУ шрифту: запасной шире, и по нему заголовки честно
     не помещаются — прогон печатал «заголовок колонки обрезан» на ровном месте */
  await p.evaluate(() => document.fonts && document.fonts.ready);
  const brand = await p.evaluate(() => !document.fonts || document.fonts.check('600 12px "Golos Text"'));
  if (!brand) console.log('ВНИМАНИЕ: фирменный шрифт не загрузился (сеть?) — замеры идут по запасному, он шире');
  await new Promise((r) => setTimeout(r, 60));
  try {
  /* негативный прогон: ломаем нарочно то, что каждая проверка должна ловить */
  if (process.argv[2] === 'break') await p.addStyleTag({ content: `
    .ib{display:block!important}
    .list td.ck{width:10px!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .chip{white-space:normal!important;width:60px!important}
    .dtab .c{margin-left:0!important}
    .detail .dmenu{display:block!important}
    .bar .drop:hover .dmenu{display:none!important}
    .top{min-height:200px!important}
    .bar .dmenu{display:block!important}
    .list tbody tr{height:64px!important}
    .calv .cev{width:90px!important;white-space:nowrap!important;overflow:hidden!important}
    .pchip .k{width:auto!important}
    .app.with-detail{grid-template-columns:var(--nav-w) minmax(0,1fr) 300px!important}
    .list th.opt{display:none!important}
    .pchip .v{max-width:40px!important}
    .list td.r{padding-left:70px!important}
    .bar{flex-wrap:wrap!important;max-width:430px!important}
    .detail{width:300px!important}
    .seg .sg.on{background:transparent!important;color:var(--ink-2)!important;font-weight:500!important}` });

  const sel = (a, id) => `[data-act="${a}"]` + (id !== undefined ? `[data-id="${id}"]` : '');
  /* ждём ФАКТА перерисовки, а не фиксированной паузы: пауза давала мигающее падение —
     на загруженной машине замер успевал раньше, чем экран менялся */
  const settled = async (was) => {
    /* потолок 600 мс: перерисовка нормально укладывается в кадр, а действие, которое
       вовсе не перерисовывает (открыватель меню), не должно стоить прогону двух секунд */
    for (let i = 0; i < 60; i++) {
      const now = await p.evaluate(() => window.__renders || 0);
      if (now !== was) { await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); return; }
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const click = async (s) => {
    const was = await p.evaluate(() => window.__renders || 0);
    const ok = await p.$eval(s, (e) => { e.click(); return true; }).catch(() => false);
    if (!ok) bad.push('НЕТ ЭЛЕМЕНТА: ' + s);
    else await settled(was);
  };
  const go = (a, id) => click(sel(a, id));
  const gov = (a, v) => click(`[data-act="${a}"][data-v="${v}"]`);
  /* нажать действие по паре id+значение: одно и то же действие живёт в нескольких
     строках, и без пары клик уходил в первую попавшуюся */
  const gov2 = (a, id, v) => click(`[data-act="${a}"][data-id="${id}"]` + (v ? `[data-v="${v}"]` : ''));
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
    /* колонка прячется целиком или не прячется вовсе: спрятанный заголовок при живых
       ячейках сдвигает всю строку, и данные встают под чужой подписью — молча */
    document.querySelectorAll('.list table').forEach((tb) => {
      const vis = (e) => e.offsetParent !== null || getComputedStyle(e).display !== 'none';
      const th = [...tb.querySelectorAll('thead th')].filter(vis).length;
      const tr = tb.querySelector('tbody tr.row');
      if (!tr) return;
      const td = [...tr.children].filter(vis).length;
      if (th !== td) out.push(`колонок в шапке ${th}, а в строке ${td}: данные встают под чужой подписью`);
    });
    /* заголовок колонки обрезан — колонку сделали уже её же названия */
    document.querySelectorAll('th').forEach((th) => {
      if (th.textContent.trim() && th.scrollWidth > th.clientWidth + 1)
        out.push('заголовок колонки обрезан: ' + th.textContent.trim());
    });
    /* колонка с датой или числом задана в пикселях и обрезаться не должна вовсе:
       «17 …» вместо «17 сен» человек прочитает как исправный срок и ошибётся */
    document.querySelectorAll('.list td.r').forEach((td) => {
      if (td.textContent.trim() && td.scrollWidth > td.clientWidth + 1)
        out.push('число или срок обрезан: ' + td.textContent.trim().slice(0, 18));
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
    document.querySelectorAll('.btn.on, .mini.on, .chip.on, .mi.on, .sg.on, .dtab.on').forEach((on) => {
      const base = on.className.split(' ')[0];
      const sib = [...on.parentElement.children].find((e) =>
        e !== on && e.classList.contains(base) && !e.classList.contains('on'));
      if (!sib) return;
      const a = getComputedStyle(on), b = getComputedStyle(sib);
      if (a.backgroundColor === b.backgroundColor && a.color === b.color && a.borderColor === b.borderColor && a.fontWeight === b.fontWeight)
        out.push(`выбранное «${on.textContent.trim().slice(0, 24)}» выглядит как невыбранное`);
    });

    /* встреча в колонке не должна обрезаться: скрытую встречу человек просто не увидит */
    document.querySelectorAll('.calv .cev').forEach((c) => {
      if (c.scrollWidth > c.clientWidth + 2) out.push(`встреча дня обрезана на ${c.scrollWidth - c.clientWidth}px: ${c.textContent.trim().slice(0, 28)}`);
    });

    /* обрезанное значение свойства — это потерянное значение: человек читает «Сербия»
       как «Серб…» и не знает, дочитал он или нет */
    document.querySelectorAll('.pchip .v').forEach((v) => {
      if (v.scrollWidth > v.clientWidth + 1) out.push(`значение свойства обрезано на ${v.scrollWidth - v.clientWidth}px: ${v.textContent.trim().slice(0, 20)}`);
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

    /* строки списков: соседи в одной строке не накладываются друг на друга. Кнопка
       «Взять» в пуле легла ПОВЕРХ названия задачи — глазами это видно сразу, а ни одно
       правило не падало: проверяли только выход за ячейку таблицы, не наложение. */
    document.querySelectorAll('.pit, .strow, .pcard .h, .rv').forEach((row) => {
      const kids = [...row.children].map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width > 1 && x.r.height > 1);
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].r, b = kids[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2)
          out.push(`в строке наложение на ${Math.round(ox)}px: «${kids[i].el.textContent.trim().slice(0, 20)}» и «${kids[j].el.textContent.trim().slice(0, 20)}»`);
      }
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
    /* срок закрытой задачи не красят никак — ни красным, ни «скоро»: просрочка закрытого
       ничего не значит, а цвет заставляет искать проблему там, где её нет */
    document.querySelectorAll('[data-drop="done"] .due.now, [data-drop="done"] .due.soon, [data-drop="done"] .due.late')
      .forEach((d) => out.push(`срок закрытой задачи окрашен как живой: «${d.textContent.trim()}» (${d.className})`));

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
    document.querySelectorAll('.chip').forEach((c) => {
      if (c.closest('[data-pick]')) return;            /* чипы выбора в формах живут по своим правилам */
      const dead = c.dataset.act === 'noop' || (!c.dataset.act && c.classList.contains('on'));
      if (dead) out.push('чип «' + c.textContent.trim().slice(0, 24) + '» ничего не фильтрует');
    });

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

    /* в таймлайне «просрочено» висит на дне, а не на строке: правило для таблиц его не видит */
    document.querySelectorAll('.tday.late').forEach((d) => {
      const items = [...d.querySelectorAll('.tdi')];
      if (items.length && items.every((i) => i.querySelector('.d-done')))
        out.push('день помечен просроченным, хотя все задачи в нём закрыты: ' + d.querySelector('.tdh').textContent.trim());
    });

    /* значение строки продублировано выбранной кнопкой рядом: читатель ищет разницу там, где её нет */
    document.querySelectorAll('.rowset > div').forEach((r) => {
      const v = r.querySelector('.v'), on = r.querySelector('.a .on');
      if (v && on && v.textContent.trim() && v.textContent.trim() === on.textContent.trim())
        out.push(`значение «${v.textContent.trim().slice(0, 24)}» повторено выбранной кнопкой в той же строке`);
    });

    /* русский интерфейс: дробное число пишется через запятую. Точка выдаёт цифру,
       собранную мимо общего форматирования — рядом всегда найдётся «1,2 МБ» */
    {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.parentElement && n.parentElement.closest('pre, code, script, style, input')) continue;
        const m = n.textContent.match(/(?<![\w.])\d+\.\d+(?![\w.])/);
        if (m) { out.push(`дробное число через точку: «${m[0]}» в «${n.textContent.trim().slice(0, 32)}»`); break; }
      }
    }
    /* ISO-дата на экране: «2026-09-17» — формат базы, а не человека; везде в стенде
       даты выглядят как «17 сен», и одно такое поле ломает чтение */
    {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.parentElement && n.parentElement.closest('pre, code, script, style, input, textarea')) continue;
        const m = n.textContent.match(/\b\d{4}-\d{2}-\d{2}\b/);
        if (m) { out.push(`дата в машинном виде: «${m[0]}» в «${n.textContent.trim().slice(0, 40)}»`); break; }
      }
    }
    /* заголовок карточки, дословно повторяющий заголовок экрана: строка занята, а
       сказано ничего — «Карта системы» стояла дважды подряд */
    {
      const h1 = (document.querySelector('h1') || {}).textContent;
      document.querySelectorAll('.body h3').forEach((h) => {
        if (h1 && h.textContent.trim() === h1.trim()) out.push(`заголовок «${h1.trim()}» повторён дважды подряд`);
      });
    }
    /* главное действие экрана живёт в одном месте: раньше «+ Задача» и «+ Проект» стояли
       справа, а «+ Запись», «+ Пользователь», «+ Воркспейс» — слева, и глаз искал заново */
    document.querySelectorAll('.bar').forEach((bar) => {
      const pri = bar.querySelector('.btn.pri');
      if (!pri) return;
      const right = bar.querySelector('.right');
      if (!right || !right.contains(pri) || right.lastElementChild !== pri)
        out.push(`главное действие «${pri.textContent.trim()}» стоит не в конце панели`);
    });
    /* две кнопки с разными подписями и одним действием: подпись обещает одно, делает другое */
    document.querySelectorAll('tbody tr, .bar').forEach((box) => {
      const seen = new Map();
      box.querySelectorAll('button[data-act]').forEach((b) => {
        if (b.dataset.act === 'noop') return;   /* открыватель выпадающего меню ничего не обещает */
        const key = b.dataset.act + ':' + (b.dataset.id || '') + ':' + (b.dataset.v || '');
        const t = b.textContent.trim().replace(/×$/, '').trim();
        if (seen.has(key) && seen.get(key) !== t)
          out.push(`«${seen.get(key)}» и «${t}» — разные подписи у одного действия ${b.dataset.act}`);
        else seen.set(key, t);
      });
    });
    /* счётчик показанного без целого: «Показано 3» не говорит, сколько спрятали
       фильтры, и человек не знает, надо ли их снимать */
    [...document.querySelectorAll('.bar .right span, .head .right span')].forEach((e) => {
      const t = e.textContent.replace(/\s+/g, ' ').trim();
      if (/^Показано\s+\d+$/.test(t)) out.push(`счётчик «${t}» не называет целое`);
      /* и наоборот: названное показанным обязано совпасть со строками под ним —
         в шапке Базы стояло «Записей 14», а на вкладке «Документы» лежало четыре */
      const m = t.match(/^[А-Яа-яЁё]+\s+(\d+)\s+из\s+(\d+)$/);
      const rows = document.querySelectorAll('.body tbody tr.row').length;
      if (m && rows && +m[1] !== rows) out.push(`счётчик «${t}» расходится со строками на экране: ${rows}`);
    });
    /* содержимое ячейки, обрезанное CSS: человек видит «регулярно ⋯» и не может ни
       прочитать скрытое, ни узнать, сколько его. Обрезка допустима только осознанная —
       через clip(), которая ставит «…» в САМ ТЕКСТ и сообщает целое в title. */
    {
      const clipped = [...document.querySelectorAll('td, .cell, .chipwrap')].filter((e) => {
        if (e.offsetParent === null) return false;
        if (e.scrollWidth <= e.clientWidth + 1) return false;
        const t = e.textContent.trim();
        /* подсказка засчитывается, только если несёт ВЕСЬ текст: «подробнее» в title
           скрытого не возвращает */
        return !t.endsWith('…') && e.title !== t;
      });
      clipped.slice(0, 3).forEach((e) => out.push(
        `содержимое обрезано без следа: «${e.textContent.trim().slice(0, 40)}» (видно ${e.clientWidth}px из ${e.scrollWidth}px)`));
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

  /* ── главная ────────────────────────────────────────────── */
  /* дом открывается по входу: сюда человек попадает, не нажимая ничего */
  want(await p.$eval('.item.on', (e) => e.textContent.includes('Главная')), 'по входу открыт дом, а не раздел');
  await shot('00-home');
  const homeRows = await count('.home tbody tr[data-act="open-task"]');
  want(homeRows > 0, 'на главной видны свои задачи');
  want((await count('.home .nw')) >= 5, 'на главной есть топ новостей');
  /* встречи дня переехали в правый столбец: полосой наверху они забирали ширину у работы */
  want((await count('.home .hcol.side .calv .cev')) === 3, 'встречи дня стоят колонкой справа на главной');
  /* «Задачи команды» — панель дашборда продукта: в ней ничьи общие задачи, и ни одной
     своей или личной. Иначе панель дублирует «Мои задачи» и обещает не то. */
  const teamPanel = await p.evaluate(() => {
    const labs = [...document.querySelectorAll('.home .lab')];
    const lab = labs.find((e) => e.textContent.includes('Задачи команды'));
    if (!lab) return null;
    const tbl = lab.nextElementSibling;
    const ids = [...tbl.querySelectorAll('tbody tr[data-act="open-task"]')].map((r) => +r.dataset.id);
    const rows = ids.map((id) => S.tasks.find((t) => t.id === id)).filter(Boolean);
    return { said: +(lab.textContent.match(/·\s*(\d+)/) || [])[1], shown: ids.length,
      mine: rows.filter((t) => t.who.includes(ME)).length,
      priv: rows.filter((t) => t.priv).length,
      real: S.tasks.filter((t) => !t.arch && t.st !== 'done' && !t.priv && !t.who.length).length };
  });
  want(teamPanel !== null && teamPanel.shown > 0, 'на главной есть панель «Задачи команды»');
  want(teamPanel && teamPanel.mine === 0 && teamPanel.priv === 0,
    `в «Задачах команды» нет ни своих, ни личных (своих ${teamPanel && teamPanel.mine}, личных ${teamPanel && teamPanel.priv})`);
  want(teamPanel && teamPanel.said === teamPanel.real,
    `счётчик панели команды равен числу ничьих задач (${teamPanel && teamPanel.said} против ${teamPanel && teamPanel.real})`);
  /* календарь без подключения обязан сказать об этом: пустой список читается как
     «встреч сегодня нет», и человек не узнаёт, что чинить */
  await p.evaluate(() => { S.cal = 'off'; render(); });
  await new Promise((r) => setTimeout(r, 120));
  const calOff = await p.evaluate(() => {
    const box = document.querySelector('.home .calv');
    return { text: box ? box.textContent : '', hasBtn: !!(box && box.querySelector('[data-act="cal-connect"]')),
      events: box ? box.querySelectorAll('.cev').length : -1 }; });
  want(calOff.events === 0 && /не подключ/i.test(calOff.text) && calOff.hasBtn,
    `неподключённый календарь объясняет себя и даёт дорогу («${calOff.text.trim().slice(0, 40)}»)`);
  await p.evaluate(() => { S.cal = 'on'; render(); });
  await new Promise((r) => setTimeout(r, 120));
  /* «идёт сейчас» — отдельный факт от «рекордер включится»: путать их нельзя */
  const nowMark = await p.evaluate(() => {
    const live = [...document.querySelectorAll('.home .cev')].filter((e) => e.classList.contains('now'));
    return { live: live.length, said: live.map((e) => e.textContent).filter((t) => /идёт сейчас/.test(t)).length,
      real: CALENDAR.filter((c) => c.at <= NOW_HM && NOW_HM < c.to).length }; });
  want(nowMark.real > 0 && nowMark.live === nowMark.real && nowMark.said === nowMark.real,
    `идущая сейчас встреча помечена словом (идёт ${nowMark.real}, помечено ${nowMark.said})`);

  /* ── задачи ─────────────────────────────────────────────── */
  await go('sec', 'tasks');
  await shot('01-tasks-today');
  /* свёрнутые фильтры обязаны РАСКРЫВАТЬСЯ мышью: щелчок по скрытому пункту из кода
     проходит всегда, поэтому зелёный замер без этой проверки ничего не доказывает */
  await p.hover('.bar .drop:last-of-type .btn');
  await new Promise((r) => setTimeout(r, 120));
  const menuOpen = await p.evaluate(() => {
    const ds = document.querySelectorAll('.bar .drop');
    const m = ds[ds.length - 1].querySelector('.dmenu');
    return m && m.offsetParent !== null && [...m.querySelectorAll('.mi')].some((e) => e.textContent.includes('архив'));
  });
  want(menuOpen, 'наведение на «Ещё» раскрывает меню с редкими срезами');
  /* статусы владелец просил вернуть чипами: они обязаны быть НА ВИДУ, а не в меню */
  const stChips = await p.$$eval('.bar > .chip', (e) => e.map((x) => x.textContent.trim()));
  want(['Открыто', 'В работе', 'Готово'].every((n) => stChips.includes(n)),
    `статусы стоят чипами в панели (видно: ${stChips.join(', ') || 'ничего'})`);
  /* убираем курсор с «Фильтров»: оставленное наведение держит меню раскрытым, и
     дальнейшие замеры считают его пункты за контролы панели */
  await p.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 60));
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
  await shot('03-tasks-all');
  /* ось времени больше не вкладки: группы по сроку живут в самом списке */
  const sects = await p.$$eval('tr.sect', (e) => e.map((x) => x.textContent.replace(/·.*/, '').trim()));
  want(sects.some((x) => x === 'Просрочено') && sects.some((x) => x === 'Сегодня'),
    `список сам делится по сроку (секции: ${sects.join(', ') || 'нет'})`);
  /* плотность: хром не должен съедать верх экрана, а панель фильтров — пестреть
     переключателями. До правки было 160–291px и полтора десятка контролов подряд. */
  const dens = await p.evaluate(() => {
    const row = document.querySelector('.list tbody tr');
    const bar = document.querySelector('.body .bar');
    const vis = (e) => e.offsetParent !== null;
    return {
      chrome: row ? Math.round(row.getBoundingClientRect().top) : 0,
      barH: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
      barWrap: bar ? getComputedStyle(bar).flexWrap : '',
      rowH: row ? Math.round(row.getBoundingClientRect().height) : 0,
    };
  });
  want(dens.chrome > 0 && dens.chrome <= 130, `до первой строки данных не больше 130px (сейчас ${dens.chrome})`);
  want(dens.barH > 0 && dens.barH <= 60, `панель фильтров стоит в одну строку (высота ${dens.barH}px, перенос «${dens.barWrap}»)`);
  want(dens.rowH > 0 && dens.rowH <= 40, `строка списка держит ритм не выше 40px (сейчас ${dens.rowH})`);

  /* создание задачи */
  await go('new-task');
  await p.type('[data-f="title"]', 'Проверить приёмку второй линии');
  await click('[data-pick="labels"] .chip');
  await go('create-task');
  await new Promise((r) => setTimeout(r, 120));
  want((await text('.d-title')).includes('Проверить приёмку'), 'созданная задача открылась в детали');
  /* срок правится выбором даты и сохраняется сразу: раньше это был текстовый ввод с
     ISO-строкой, сохранявшийся только по Enter — о нём никто не догадывался */
  const dueField = await p.$eval('[data-act="set-due"]', (e) => e.type);
  want(dueField === 'date', `срок правится полем даты, а не строкой (сейчас «${dueField}»)`);
  await p.$eval('[data-act="set-due"]', (e) => { e.value = '2026-10-15'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await new Promise((r) => setTimeout(r, 120));
  want((await p.evaluate(() => (S.tasks.find((t) => t.id === S.sel) || {}).due)) === '2026-10-15',
    'выбранная дата сохраняется сразу, без нажатия Enter');
  want((await text('.toast')).includes('создана'), 'после создания показан тост');
  await shot('04-task-created');

  /* действия в детали */
  await go('take');
  const statusChip = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.detail .props .pchip')]
      .find((e) => (e.querySelector('.k') || {}).textContent === 'Статус');
    return c ? c.querySelector('.v').textContent.trim() : '';
  });
  want(statusChip.includes('В работе'), `кнопка «Взять в работу» сменила статус (в чипе «${statusChip}»)`);
  /* работать с задачей в колонке 372px нельзя — это была форточка, а не рабочее место */
  const dw = await p.$eval('.detail', (e) => Math.round(e.clientWidth));
  want(dw >= 520, `рабочая область задачи шире 520px (сейчас ${dw})`);
  /* «криво косо висят»: значения свойств обязаны стоять по одной линии в своей колонке */
  const spread = await p.evaluate(() => {
    const byCol = {};
    [...document.querySelectorAll('.detail .props .pchip')].filter((e) => e.offsetParent).forEach((c) => {
      const v = c.querySelector('.v'); if (!v) return;
      const x = Math.round(c.getBoundingClientRect().left);
      (byCol[x] = byCol[x] || []).push(Math.round(v.getBoundingClientRect().left));
    });
    const cols = Object.values(byCol).filter((xs) => xs.length > 1);
    return cols.length ? Math.max(...cols.map((xs) => Math.max(...xs) - Math.min(...xs))) : -1;
  });
  want(spread >= 0 && spread <= 1, `значения свойств стоят по одной линии (разброс ${spread}px)`);
  /* панель показывает ЗНАЧЕНИЯ, а не все варианты сразу: иначе она читается как форма настроек,
     а не как задача. Порог — поля плюс небольшой запас на переключатели вроде приватности. */
  const panelOpts = await p.evaluate(() => {
    const d = document.querySelector('.detail');
    const vis = (e) => e.offsetParent !== null;
    return { fields: d.querySelectorAll('.f dt, .props .pchip').length,
      opts: [...d.querySelectorAll('.mini, .props .chip, .mi')].filter(vis).length };
  });
  want(panelOpts.opts <= panelOpts.fields + 2,
    `панель детали показывает значения, а не варианты (видно вариантов ${panelOpts.opts} на ${panelOpts.fields} полей)`);
  /* Комментарии живут на ОСНОВНОМ окне задачи, под остальным (просьба владельца
     21.09): во вкладке разговор не виден, пока туда не вспомнишь зайти. Проверяем, что
     поле ввода доступно без переключения вкладок и что отправленное сразу видно. */
  want((await count('[data-act="dtab"][data-id="talk"]')) === 0, 'отдельной вкладки «Комментарии» больше нет');
  const talkPlace = await p.evaluate(() => {
    const body = document.querySelector('.detail .d-body');
    const box = body && body.querySelector('.cbox');
    if (!box) return null;
    const note = body.querySelector('.note');
    return { after: !!note && note.compareDocumentPosition(box) === Node.DOCUMENT_POSITION_FOLLOWING,
      visible: box.offsetParent !== null };
  });
  want(talkPlace && talkPlace.visible && talkPlace.after,
    'комментарии стоят на обзоре задачи, ниже описания');
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

  /* архив: задача уходит из списка и возвращается оттуда. Массовое выделение строк из
     стенда снято — в продукте его нет (сверка 21.09), архивируют по одной из панели. */
  await go('tgl', 'archOn');
  const beforeArch = await count('tbody tr[data-act="open-task"]');
  await go('tgl', 'archOn');
  const archId = await p.evaluate(() => { const tr = document.querySelector('tbody tr[data-act="open-task"]');
    return tr ? tr.dataset.id : null; });
  await go('open-task', archId);
  await go('archive', archId);
  await go('close');
  await go('tgl', 'archOn');
  const afterArch = await count('tbody tr[data-act="open-task"]');
  want(afterArch === beforeArch + 1, `архивация убрала задачу из списка и добавила в архив (${beforeArch} → ${afterArch})`);
  await shot('06-archive');
  /* дорога назад из архива проверяется ниже, на панели архивной задачи */
  await go('open-task', archId);
  await go('restore', archId);
  await go('close');
  await new Promise((r) => setTimeout(r, 120));
  const afterRestore = await count('tbody tr[data-act="open-task"]');
  want(afterRestore === afterArch - 1, `возврат из архива убрал строку из архива (${afterArch} → ${afterRestore})`);
  /* пинг — ручное напоминание продукта: ставится в панели, виден в строке и гаснет,
     когда отзвонил. Висящий значок сгоревшего пинга обещал бы то, чего не будет. */
  await go('tgl', 'archOn');
  const pingRow = await p.evaluate(() => {
    const t = S.tasks.find((x) => !x.arch && !x.ping && visibleTasks().includes(x));
    return t ? t.id : null; });
  const pingsBefore = await count('.list .ping');
  /* пинг ставится быстрым чипом ПРЯМО ИЗ СТРОКИ — перенос TaskQuickActions продукта:
     самое частое движение в списке не должно стоить открытия карточки */
  await gov2('set-ping-q', pingRow, '7');
  await new Promise((r) => setTimeout(r, 140));
  want((await count('.list .ping')) === pingsBefore + 1, `пинг ставится быстрым чипом прямо из строки (${pingsBefore} → ${await count('.list .ping')})`);
  want((await p.evaluate((id) => (S.history[id] || [])[0].k === 'Напоминание', pingRow)),
    'пинг записался в историю задачи, а не только в поле');
  const burnt = await p.evaluate(() => S.tasks.filter((t) => !t.arch && t.ping && t.pinged).length);
  const burntShown = await p.evaluate(() => [...document.querySelectorAll('.list tbody tr')].filter((tr) => {
    const id = +tr.dataset.id; const t = S.tasks.find((x) => x.id === id);
    return t && t.pinged && tr.querySelector('.ping'); }).length);
  want(burnt > 0 && burntShown === 0, `сгоревший пинг в строке не висит (сгоревших ${burnt}, показано ${burntShown})`);
  /* Панель задачи показывает ЗАПОЛНЕННОЕ: поле «Рынок: не указан» занимает строку и
     ничего не сообщает — из-за таких строк панель читалась как анкета (просьба владельца
     21.09). Спрятанное достаётся одной кнопкой, а не правкой кода. */
  await go('open-task', pingRow);
  const keys = () => p.evaluate(() => [...document.querySelectorAll('.detail .props .pchip')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => ({ k: (e.querySelector('.k') || {}).textContent, empty: !!e.querySelector('.v .muted') })));
  const shownFields = await keys();
  want(shownFields.length > 0 && shownFields.every((f) => !f.empty),
    `панель задачи не показывает пустых полей (пустых ${shownFields.filter((f) => f.empty).length} из ${shownFields.length})`);
  const moreBtn = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.detail .props.opt .btn')].find((x) => /Все поля/.test(x.textContent));
    return b ? b.textContent.trim() : null; });
  want(moreBtn !== null, `спрятанные поля названы числом на кнопке («${moreBtn}»)`);
  await go('tgl', 'allProps');
  await new Promise((r) => setTimeout(r, 120));
  const allFields = await keys();
  want(allFields.length > shownFields.length,
    `«Все поля» достаёт спрятанное (${shownFields.length} → ${allFields.length})`);
  await go('tgl', 'allProps');
  await new Promise((r) => setTimeout(r, 120));
  await go('drop-ping', pingRow);
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.list .ping')) === pingsBefore, 'пинг снимается тем же местом, где ставился');
  await go('close');
  /* период — ось продукта (RangePicker): сужает список по сроку и снимается */
  const allShown = await count('tbody tr[data-act="open-task"]');
  await gov('set-period', 'today');
  await new Promise((r) => setTimeout(r, 120));
  const todayShown = await count('tbody tr[data-act="open-task"]');
  want(todayShown > 0 && todayShown < allShown, `период сужает список (все ${allShown}, сегодня ${todayShown})`);
  want((await p.evaluate(() => visibleTasks().every((t) => t.due && daysTo(t.due) <= 0))),
    'в срезе «сегодня» нет задач с будущим сроком и без срока');
  await gov('set-period', 'any');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('tbody tr[data-act="open-task"]')) === allShown, 'период снимается и список возвращается');

  /* создание в списке, который созданное не покажет, выглядит как молчаливый отказ */
  await go('new-task');
  await p.type('[data-f="title"]', 'Задача, созданная из архива');
  await go('create-task');
  await new Promise((r) => setTimeout(r, 140));
  const seenAfterCreate = await p.evaluate(() => [...document.querySelectorAll('tbody tr[data-act="open-task"]')]
    .some((tr) => tr.textContent.includes('созданная из архива')));
  want(seenAfterCreate, 'созданная задача видна в списке, а не только в панели справа');
  await go('close');
  await go('tgl', 'archOn');
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
  /* «Показать все» снимает и срез архива — это фильтр как любой другой */
  want((await p.evaluate(() => S.archOn)) === false, '«Показать все» снимает и срез архива');
  await go('tgl', 'archOn');
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
  /* счётчик в полосе описывает показанное, а не соседние вкладки: раньше тут висели
     «Невычитано 3» и «Черновиков 2» — числа, на которые фильтры рядом не влияли */
  const grSaid = (await text('.bar .right')).replace(/\s+/g, ' ').trim();
  want(grSaid.includes(`Показано ${gr} из`), `счётчик полосы встреч следует за фильтром (строк ${gr}, в полосе «${grSaid}»)`);
  await go('mf-clear');
  /* сверка с транскриптом и подтверждение — действия ВЫЧИТКИ, поэтому берём встречу
     из очереди вычитки, а не первую попавшуюся: у разобранной их на экране нет */
  const firstMeet = await p.$eval('.revhead .rv', (e) => e.dataset.id);
  await go('open-meet', firstMeet); await shot('08-meeting-detail');
  want((await count('.detail .dtab')) === 3, 'у встречи на вычитке три вкладки: обзор, тезисы, транскрипт');
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
  /* «Сгенерировать задачи» переключает ТО ЖЕ окно встречи на список предложенного и
     ничего не создаёт молча; задача заводится из обычной формы, где её правят и
     прикладывают ссылки (просьба владельца 21.09). */
  const tasksBeforeHarvest = await p.evaluate(() => S.tasks.length);
  await go('gen-tasks', firstMeet);
  await new Promise((r) => setTimeout(r, 140));
  const genView = await p.evaluate(() => ({
    tab: ((document.querySelector('.detail .dtab.on') || {}).textContent || '').trim(),
    rows: document.querySelectorAll('.detail .glist .grow').length,
    made: S.tasks.length }));
  want(genView.rows > 0 && genView.made === tasksBeforeHarvest,
    `«Сгенерировать задачи» показывает список в том же окне и молча ничего не создаёт (строк ${genView.rows})`);
  await go('gen-open', '0');
  const genForm = await p.evaluate(() => ({
    title: (document.querySelector('.modal [data-f="title"]') || {}).value || '',
    urls: !!document.querySelector('.modal [data-f="urls"]'),
    project: !!document.querySelector('.modal [data-f="pr"]') }));
  want(genForm.title.length > 0 && genForm.urls && genForm.project,
    `предложенная задача открывается в обычной форме — с проектом и ссылками («${genForm.title.slice(0, 32)}»)`);
  await p.type('.modal [data-f="urls"]', 'https://example.com/smeta');
  await go('gen-save', '0');
  await new Promise((r) => setTimeout(r, 160));
  const afterGen = await p.evaluate((mid) => {
    const t = S.tasks[0];
    return { n: S.tasks.length, urls: (t.urls || []).length,
      linked: (S.meetings.find((m) => m.id === mid) || { tasks: [] }).tasks.includes(t.id) }; }, firstMeet);
  const harvested = afterGen.n - tasksBeforeHarvest;
  want(harvested === 1, `задача из встречи создана по одной, а не пачкой (создано ${harvested})`);
  want(afterGen.urls === 1 && afterGen.linked,
    `оформленная задача унесла ссылку и привязалась к встрече (ссылок ${afterGen.urls})`);
  await go('gen-close');
  await go('confirm-meet', firstMeet);
  /* вычитка теперь шапка экрана, а не вкладка: подтверждённая встреча уходит из неё сразу */
  want((await count(`.revhead .rv[data-id="${firstMeet}"]`)) === 0, 'подтверждённая встреча ушла из вычитки');
  want((await count('.revhead .rv')) > 0, 'очередь вычитки видна на экране встреч без переключения вкладок');
  /* встреча без задач: только в этом состоянии на экране обе кнопки сбора — сверху
     и в пустой секции. Они звались по-разному, и правило о двух подписях одного
     действия молчало, потому что такое состояние ни разу не открывали */
  await go('tab', 'all');
  await go('open-meet', 'm12');
  await new Promise((r) => setTimeout(r, 120));
  /* Встречу открывают ради разобранного текста: главное окно — ГОТОВЫЕ ТЕЗИСЫ, а
     транскрипт стоит отдельной вкладкой и у подтверждённой встречи тоже — сверять его
     приходится и после вычитки (просьба владельца 21.09). */
  const tabsDone = await p.$$eval('.detail .dtab', (e) => e.map((x) => x.textContent.replace(/\d+$/, '').trim()));
  want(tabsDone[0] === 'Тезисы', `встреча открывается тезисами (вкладки: ${tabsDone.join(', ')})`);
  want(tabsDone.includes('Транскрипт'), 'транскрипт лежит отдельной вкладкой');
  const meetOpenOn = await p.evaluate(() => ({
    tab: ((document.querySelector('.detail .dtab.on') || {}).textContent || '').replace(/\d+$/, '').trim(),
    tez: document.querySelectorAll('.detail .tez li').length }));
  want(meetOpenOn.tab === 'Тезисы' && meetOpenOn.tez > 0,
    `открытая встреча сразу показывает тезисы, а не карточку («${meetOpenOn.tab}», пунктов ${meetOpenOn.tez})`);
  await scan('08б-встреча-без-задач');
  await go('dtab', 'overview');
  const meetSt = await p.evaluate(() => {
    const dt = [...document.querySelectorAll('.detail dt')].find((e) => e.textContent.trim() === 'Статус');
    const dd = dt && dt.nextElementSibling;
    return { chip: !!(dd && dd.querySelector('.state')), text: dd ? dd.textContent.trim() : 'поля нет' }; });
  want(meetSt.chip, `статус встречи показан плашкой, как везде в стенде, а не голым текстом («${meetSt.text}»)`);
  /* переобработка тезисов: продукт спрашивает ЧТО поменять, а не «пересобрать» вслепую.
     Текст обязан измениться и тост — назвать пожелание, иначе кнопка врёт об успехе. */
  await go('open-meet', 'm1');
  await new Promise((r) => setTimeout(r, 120));
  const tezBefore = await p.evaluate(() => JSON.stringify((S.meetings.find((m) => m.id === 'm1') || {}).tez));
  const regenItems = await p.$$eval('[data-act="regen"], [data-act="regen-own"]', (e) => e.map((x) => x.textContent.trim()));
  want(regenItems.length >= 5, `переобработка предлагает пожелания, а не одну кнопку (${regenItems.join(', ') || 'нет'})`);
  await gov2('regen', 'm1', 'short');
  await new Promise((r) => setTimeout(r, 140));
  const tezAfter = await p.evaluate(() => JSON.stringify((S.meetings.find((m) => m.id === 'm1') || {}).tez));
  want(tezAfter !== tezBefore, 'переобработка действительно меняет тезисы, а не печатает «готово»');
  want((await text('.toast')).includes('короче'), 'тост называет, каким пожеланием переобработали');
  /* пометки на полях — то, что писали ВО ВРЕМЯ встречи: с автором и временем */
  await go('dtab', 'overview');
  await new Promise((r) => setTimeout(r, 120));
  const notes = await p.evaluate(() => {
    const m = S.meetings.find((x) => x.id === 'm1') || {};
    const shown = [...document.querySelectorAll('.mn')];
    return { real: (m.notes || []).length, shown: shown.length,
      withWho: shown.filter((n) => n.querySelector('.w b')).length };
  });
  want(notes.real > 0 && notes.shown === notes.real, `пометки на полях показаны все (${notes.shown} из ${notes.real})`);
  want(notes.withWho === notes.shown, 'у каждой пометки назван автор — без него непонятно, чьё это');
  /* название встречи правится и меняется ВЕЗДЕ, а не только в панели */
  await go('rename-meet', 'm1');
  await p.$eval('[data-f="n"]', (e) => { e.value = ''; });
  await p.type('[data-f="n"]', 'Планёрка по открытию — уточнённая');
  await go('do-rename-meet', 'm1');
  await new Promise((r) => setTimeout(r, 140));
  want((await text('.d-title')).includes('уточнённая'), 'новое название встало в панели');
  want(await p.evaluate(() => [...document.querySelectorAll('.body tbody tr')].some((r) => r.textContent.includes('уточнённая'))),
    'новое название встало и в списке встреч, а не только в панели');
  /* удаление встречи уносит расшифровку — спрашиваем */
  await go('del-meet', 'm1');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.modal .hint')) === 1, 'удаление встречи сперва спрашивает');
  await go('mclose');
  await go('close');

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
  await go('sec', 'meetings');
  const anyPending = await p.$$eval('.revhead .rv', (e) => e.length ? e[0].dataset.id : null);
  if (anyPending) {
    await go('open-meet', anyPending);
    await go('gen-tasks', anyPending);
    await shot('34-harvest');
    const tasksBefore = await p.evaluate(() => S.tasks.length);
    await go('gen-open', '1');
    await go('gen-save', '1');
    await new Promise((r) => setTimeout(r, 140));
    const tasksAfter = await p.evaluate(() => S.tasks.length);
    want(tasksAfter === tasksBefore + 1, `оформлена ровно одна выбранная задача (${tasksBefore} → ${tasksAfter})`);
    /* созданная задача помечена в списке, и повторное нажатие не плодит вторую */
    const marked = await p.evaluate(() => ({ made: S.gen.filter((g) => g.made).length,
      shown: document.querySelectorAll('.detail .glist .grow.made').length }));
    want(marked.made === 1 && marked.shown === 1,
      `созданная задача помечена в списке предложенных (помечено ${marked.shown})`);
    await go('gen-close');
    await go('review-next', anyPending);
    want((await p.evaluate(() => S.sel)) !== anyPending, 'вычитка подряд переключает на следующую встречу');
    await go('close');
  }

  /* ── база ───────────────────────────────────────────────── */
  await go('sec', 'base');
  /* «В задачу» из записи: в продукте RecordDetail так и делает, и задача обязана
     унести с собой текст записи — иначе человек копирует руками и теряет источник */
  {
    const before = await p.evaluate(() => S.tasks.length);
    const entryId = await p.evaluate(() => (S.entries.find((e) => e.p) || {}).id);
    await go('open-entry', entryId);
    await go('task-from-entry', entryId);
    await new Promise((r) => setTimeout(r, 140));
    const made = await p.evaluate((id) => {
      const e = S.entries.find((x) => x.id === id);
      const t = S.tasks[0];
      return { grew: S.tasks.length, tookText: !!t && t.note === e.p, titled: !!t && t.t.length > 0 };
    }, entryId);
    want(made.grew === before + 1, `задача из записи создана (${before} → ${made.grew})`);
    want(made.tookText && made.titled, 'задача из записи унесла её текст и название, а не пустую форму');
    /* пересказ модели не выдумывается: у записи без текста его нет */
    const aiHonest = await p.evaluate(() => {
      const withText = aiSum({ p: 'Первое предложение. Второе.', ty: 'note', ix: { n: 3 } });
      const without = aiSum({ p: '', ty: 'note', ix: { n: 0 } });
      return { withText, without };
    });
    want(aiHonest.withText.includes('Первое предложение.'), 'пересказ опирается на текст записи');
    want(/нечего/.test(aiHonest.without), `у записи без текста пересказ не выдумывается («${aiHonest.without}»)`);
    await go('close');
  }
 await shot('12-base');
  const recs = await count('tbody tr[data-act="open-entry"]');
  await gov('b-cc', 'HR');
  const hr = await count('tbody tr[data-act="open-entry"]');
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
  /* вкладка типа: под счётчиком обязано лежать ровно то, что он назвал */
  await go('tab', 'document'); await scan('12-база-документы');
  const docsShown = await count('tbody tr[data-act="open-entry"]');
  const docsSaid = +(await text('.bar .right span')).replace(/\D+/, '').match(/\d+/)[0];
  want(docsShown === docsSaid && docsShown > 0, `счётчик вкладки «Документы» сходится со строками (${docsSaid} против ${docsShown})`);
  await go('tab', 'all');
  await go('tab', 'files'); await shot('13-files');
  /* фильтры бара обязаны действовать и здесь: файл наследует страну от своей записи,
     иначе два включённых фильтра на этой вкладке молча ничего не делают */
  const filesAll = await count('tbody tr[data-act="open-file"]');
  await gov('b-cc', 'HR');
  const filesHr = await count('tbody tr[data-act="open-file"]');
  want(filesHr < filesAll, `страна сужает и список файлов (${filesAll} → ${filesHr})`);
  await gov('b-cc', '');
  await go('open-file', 'f2'); await shot('14-file-detail');
  await go('close');

  /* ── проекты и спринты ──────────────────────────────────── */
  await go('sec', 'projects');
  /* доска продукта: вкладки досок сверху, проект раскрывается в колонки. Для проверок
     карточек берём обзор всех вкладок и складываем раскрытый по умолчанию проект. */
  await go('set-board', 'all');
  await go('toggle-open', 'p1');
  await shot('15-projects');
  /* проект заводится с экрана: в продукте это есть (RoyProjectsScreen → createProject),
     и стенд обязан уметь то же, иначе «перенесён весь функционал» — неправда */
  const projBefore = await count('.pcard');
  await go('new-project');
  await p.type('[data-f="n"]', 'Открытие BA');
  await go('do-project');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.pcard')) === projBefore + 1, 'проект заводится с экрана «Проекты»');
  want((await text('.d-title')) === 'Открытие BA', 'созданный проект открылся в детали');
  await go('close');
  /* одно и то же «всего задач» на списке и на карте: раньше список считал архивные,
     карта — нет, и один проект показывал 18 в списке против 16 на карте */
  const listTotals = await p.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('.pcard')].map((c) =>
      [c.querySelector('.nm').textContent.trim(), +c.querySelector('.all').textContent.trim()])));
  await go('open-proj', 'p1'); await shot('16-project-detail');
  /* панель детали и строка списка говорят про ОДИН проект — значит одно и то же число */
  const pair = await p.evaluate(() => {
    const card = document.querySelector('.pcard.sel');
    const dd = [...document.querySelectorAll('.detail dt')].find((e) => e.textContent.trim() === 'Задачи');
    const said = dd ? dd.nextElementSibling.textContent.trim() : '';
    const m = said.match(/(\d+)\D+(\d+)/);
    return { rowOpen: card ? +card.querySelector('.open').textContent : null,
      rowAll: card ? +card.querySelector('.all').textContent : null,
      panelOpen: m ? +m[1] : null, panelAll: m ? +m[2] : null, said };
  });
  want(pair.rowAll === pair.panelAll && pair.rowOpen === pair.panelOpen,
    `карточка и панель дают одни числа по проекту (карточка ${pair.rowOpen}/${pair.rowAll}, панель «${pair.said}»)`);
  await go('close');
  /* доска: раскрытый проект показывает четыре колонки продукта, а карточек в колонке
     столько, сколько задач этого статуса у проекта — иначе колонка декоративная */
  await go('toggle-open', 'p1');
  await new Promise((r) => setTimeout(r, 120));
  const secCols = await p.evaluate(() => [...document.querySelectorAll('.psec .cols > .col h3')].map((h) => h.childNodes[1].textContent.trim()));
  want(secCols.slice(0, 4).join('/') === 'Бэклог/Открыто/В работе/Готово', `раскрытый проект дал колонки продукта (${secCols.join('/')})`);
  const colPair = await p.evaluate(() => {
    const col = [...document.querySelectorAll('.psec .cols > .col')].find((c) => c.querySelector('h3').textContent.includes('В работе'));
    const real = S.tasks.filter((t) => !t.arch && t.pr === 'p1' && t.st === 'in_progress').length;
    return { cards: col ? col.querySelectorAll('.card').length : -1, real };
  });
  want(colPair.cards === colPair.real, `в колонке столько карточек, сколько задач (${colPair.cards} против ${colPair.real})`);
  /* «Бэклог» — живой статус продукта, но в списке задач он приглушён: задача из бэклога
     не должна появиться в «Задачах», иначе список врёт про охват */
  const backlogLeak = await p.evaluate(() => {
    /* проверяем при ВСЕХ включённых статусах — именно так список выглядит после «сбросить
       фильтры». При наборе по умолчанию бэклог не виден сам собой, и правило ничего не ловит */
    const keep = { ...S, statuses: S.statuses };
    S.statuses = new Set(Object.keys(ST_LABEL));
    /* самый широкий охват: любой уцелевший от прошлых шагов фильтр прятал бы бэклог
       вместо приглушения — и правило молча проходило бы на сломанном коде */
    S.lens = 'all'; S.staff = true; S.q = ''; S.mk = null; S.assignee = null;
    S.noProject = false; S.recurOnly = false; S.archOn = false;
    const ids = new Set(S.tasks.filter((t) => t.st === 'backlog' && !t.arch).map((t) => t.id));
    const shown = visibleTasks().filter((t) => ids.has(t.id)).length;
    Object.assign(S, { statuses: keep.statuses, lens: keep.lens, staff: keep.staff, q: keep.q, mk: keep.mk,
      assignee: keep.assignee, noProject: keep.noProject, recurOnly: keep.recurOnly, archOn: keep.archOn });
    return { total: ids.size, shown };
  });
  want(backlogLeak.total > 0 && backlogLeak.shown === 0, `бэклог живёт на доске и не течёт в список задач (${backlogLeak.total} задач, в списке ${backlogLeak.shown})`);
  /* вкладки досок делят проекты: переключение вкладки обязано менять состав экрана */
  const boardCounts = await p.evaluate(async () => {
    const at = () => document.querySelectorAll('.pcard, .psec').length;
    const out = {};
    for (const id of ['all', 'b1', 'b2']) { ACTS['set-board'](id); await new Promise((r) => requestAnimationFrame(r)); out[id] = at(); }
    ACTS['set-board']('all'); await new Promise((r) => requestAnimationFrame(r));
    return out;
  });
  want(boardCounts.b1 + boardCounts.b2 === boardCounts.all && boardCounts.b1 > 0 && boardCounts.b2 > 0,
    `вкладки досок делят проекты без потерь (${boardCounts.b1} + ${boardCounts.b2} = ${boardCounts.all})`);
  await go('toggle-open', 'p1');
  await go('tab', 'map'); await shot('17-projects-map');
  const mapTotals = await p.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('.tkids > .tbr > .tnode')].map((e) => {
      const n = e.querySelector('.n');
      return [e.textContent.replace(n.textContent, '').trim(), +n.textContent];
    })));
  const clash = Object.keys(listTotals).filter((k) => mapTotals[k] !== undefined && mapTotals[k] !== listTotals[k]);
  want(clash.length === 0, `список и карта дают одно число задач на проект (расходятся: ${
    clash.map((k) => `${k}: ${listTotals[k]} против ${mapTotals[k]}`).join('; ')})`);
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
  /* задача без проекта видна на карте и узел ведёт к ней: иначе корень считает задачи,
     которых под ним нет, и найти их нечем */
  const loose = await p.evaluate(() => S.tasks.filter((t) => !t.arch && !S.projects.some((x) => x.id === t.pr)).length);
  if (loose > 0) {
    want((await text('.tkids')).includes('Без проекта'), `задачи без проекта показаны на карте отдельной ветвью (их ${loose})`);
    await go('tasks-no-project');
    await new Promise((r) => setTimeout(r, 120));
    const n = await count('tbody tr[data-act="open-task"]');
    want(n === loose, `узел «Без проекта» открыл ровно эти задачи (${n} против ${loose})`);
    want((await text('.bar')).includes('без проекта'), 'сужение списка видно снимаемым чипом, а не действует втихую');
    await go('drop-no-project');
    await go('sec', 'projects'); await go('tab', 'map');
    await new Promise((r) => setTimeout(r, 90));
  }
  /* имя воркспейса меняется — карта обязана поехать за ним; совпадение с зашитой строкой ничего не доказывает */
  await p.evaluate(() => { S.workspaces = S.workspaces.map((w) => w.active ? { ...w, name: 'Проверка имени' } : w); render(); });
  await new Promise((r) => setTimeout(r, 90));
  want((await text('.tnode.root')).startsWith('Проверка имени'), 'корень карты берёт имя из воркспейса, а не зашит в код');
  await p.evaluate((n) => { S.workspaces = S.workspaces.map((w) => w.active ? { ...w, name: n } : w); render(); }, tree.ws);
  await new Promise((r) => setTimeout(r, 90));
  await go('sec', 'sprints'); await shot('18-board');
  const cardsC2 = await count('.strow');
  await go('set-cycle', 'c3');
  await new Promise((r) => setTimeout(r, 120));
  const cardsC3 = await count('.strow');
  want(cardsC3 > 0 && cardsC3 !== cardsC2, `переключатель цикла меняет список спринта (c2: ${cardsC2}, c3: ${cardsC3})`);
  await go('tab', 'timeline');
  await new Promise((r) => setTimeout(r, 120));
  const tlC3 = await count('.tdi');
  await go('set-cycle', 'c2');
  await new Promise((r) => setTimeout(r, 120));
  const tlC2 = await count('.tdi');
  want(tlC2 !== tlC3, `таймлайн следует за циклом (c3: ${tlC3}, c2: ${tlC2})`);
  /* доска — вид спринта, а не вкладка: список по умолчанию, канбан переключателем */
  await go('tab', 'sprint');
  await new Promise((r) => setTimeout(r, 150));
  const sprintSects = await p.$$eval('.sprint .ini', (e) => e.length);
  want(sprintSects > 0, 'спринт по умолчанию — список по инициативам, а не доска');
  want((await count('.kpi')) >= 4, 'над спринтом стоят счётчики цикла');
  await gov('set-view', 'board');
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
  /* доска и таймлайн — две вкладки ОДНОГО цикла: таймлайн показывает те же задачи,
     только с датой, поэтому он не может насчитать больше доски */
  const inCycleSaid = await p.evaluate(() => {
    const k = document.querySelector('.kpi b');
    const m = k ? k.textContent.match(/\d+\/(\d+)/) : null;
    return m ? +m[1] : null; });
  await go('tab', 'timeline'); await shot('36-timeline');
  want((await count('.tday')) > 3, 'таймлайн разложил задачи по дням');
  const tl = await p.evaluate(() => {
    const said = [...document.querySelectorAll('.bar .right span')].map((e) => e.textContent).find((x) => /Задач со сроком/.test(x)) || '';
    return { n: said ? +said.replace(/\D+/g, '') : null, items: document.querySelectorAll('.tdi').length, said }; });
  want(tl.n === tl.items, `счётчик таймлайна равен числу карточек на нём (счётчик ${tl.n}, карточек ${tl.items})`);
  want(inCycleSaid !== null && tl.n !== null && tl.n <= inCycleSaid,
    `таймлайн не насчитывает больше задач, чем спринт (в спринте ${inCycleSaid}, таймлайн ${tl.n})`);

  /* ── спринт: состав, сверка, перенос, приёмка ───────────── */
  await go('tab', 'sprint');
  await gov('set-view', 'list');           /* до этого места вид переключали на канбан */
  await new Promise((r) => setTimeout(r, 140));
  /* счётчик наверху обязан сходиться с тем, что на экране: «сделано 3/12» при девяти
     строках — это два разных факта об одном спринте */
  const sprintCount = await p.evaluate(() => {
    const k = document.querySelector('.kpi b');
    const m = k ? k.textContent.match(/(\d+)\/(\d+)/) : null;
    return { said: m ? +m[2] : null, rows: document.querySelectorAll('.strow').length,
      doneSaid: m ? +m[1] : null, doneRows: [...document.querySelectorAll('.strow .dot')].filter((d) => d.classList.contains('d-done')).length };
  });
  want(sprintCount.said === sprintCount.rows, `счётчик спринта сходится со строками состава (${sprintCount.said} против ${sprintCount.rows})`);
  want(sprintCount.doneSaid === sprintCount.doneRows, `«сделано» сходится с закрытыми строками (${sprintCount.doneSaid} против ${sprintCount.doneRows})`);
  /* группировка «по людям» перекладывает ТЕ ЖЕ задачи: если после переключения их стало
     больше или меньше, одна из раскладок врёт */
  await gov('set-group', 'people'); await shot('20-sprint-people');
  await new Promise((r) => setTimeout(r, 120));
  const byPeople = await count('.strow');
  await gov('set-group', 'ini');
  await new Promise((r) => setTimeout(r, 120));
  want(byPeople === sprintCount.rows, `группировка по людям показывает тот же состав (${byPeople} против ${sprintCount.rows})`);
  /* отметка сверки ставится прямо в строке (отдельный экран «Сверка» снят 19.09) */
  const kpiOf = (word) => p.evaluate((w) => {
    const k = [...document.querySelectorAll('.kpi')].find((e) => e.querySelector('span').textContent.trim() === w);
    return k ? +k.querySelector('b').textContent : null; }, word);
  const riskBefore = await kpiOf('риск');
  /* отметку ставят из меню чипа: берём строку, где отметки ещё нет */
  const chkId = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.strow')].find((r) => r.querySelector('.ck:not(.on)'));
    const mi = row && [...row.querySelectorAll('.dmenu .mi')].find((e) => e.textContent.trim() === 'риск');
    if (mi) { mi.click(); return mi.dataset.id; }
    return null;
  });
  await new Promise((r) => setTimeout(r, 120));
  want(chkId !== null && (await kpiOf('риск')) === riskBefore + 1, `отметка сверки ставится в строке и считается наверху (было ${riskBefore})`);
  want((await p.evaluate((id) => {
    const row = [...document.querySelectorAll('.strow')].find((r) => r.querySelector(`[data-act="set-chk"][data-id="${id}"]`));
    const chip = row && row.querySelector('.ck');
    return !!chip && chip.classList.contains('on') && chip.textContent.trim() === 'риск';
  }, chkId)), 'чип строки показывает поставленную отметку словом, а не только цветом');
  await gov2('set-chk', chkId, '');
  await new Promise((r) => setTimeout(r, 120));
  want((await kpiOf('риск')) === riskBefore, 'отметку можно снять — «не отмечено» достижимо обратно');
  /* пометка «к переносу» спрашивает причину: перенос без причины на приёмке никто не вспомнит */
  const carryBefore = await kpiOf('к переносу');
  const carryId = await p.evaluate(() => { const b = [...document.querySelectorAll('.strow [data-act="tgl-carry"]')]
    .find((e) => e.textContent.includes('Перенести')); if (!b) return null; b.click(); return b.dataset.id; });
  await new Promise((r) => setTimeout(r, 120));
  /* «.modal» в разметке стоит всегда (пустой контейнер) — спрашиваем про ПОЛЕ причины,
     иначе правило проходит на коде, который ничего не спросил */
  const askedWhy = (await count('.modal [data-f="r"]')) === 1;
  want(askedWhy && carryId !== null, 'пометка переноса сперва спрашивает причину');
  if (askedWhy) {
    await p.type('[data-f="r"]', 'поставщик не ответил');
    await go('do-carry', carryId);
  }
  await new Promise((r) => setTimeout(r, 140));
  want((await kpiOf('к переносу')) === carryBefore + 1, `пометка переноса считается наверху (было ${carryBefore})`);
  want((await p.evaluate((id) => { const el = [...document.querySelectorAll('.strow .carry')]
    .find((e) => e.title.includes('поставщик не ответил')); return !!el; }, carryId)),
    'причина переноса сохранилась у строки, а не растворилась в вопросе');
  /* пул набора: взятая задача уходит из пула в состав, и «сверх плана» растёт —
     спринт уже идёт, значит это добавленная работа, а не план */
  await go('tgl', 'poolOpen');
  await new Promise((r) => setTimeout(r, 140));
  await shot('21-sprint-pool');
  const poolBefore = await count('.pit');
  const overBefore = await kpiOf('сверх плана');
  const rowsBefore = await count('.strow');
  await p.$eval('.pit [data-act="take-item"]', (e) => e.click());
  await new Promise((r) => setTimeout(r, 140));
  want((await count('.pit')) === poolBefore - 1, `взятая задача ушла из пула (${poolBefore} → ${await count('.pit')})`);
  want((await count('.strow')) === rowsBefore + 1, 'взятая задача появилась в составе спринта');
  want((await kpiOf('сверх плана')) === overBefore + 1, `задача, взятая после старта, считается сверх плана (было ${overBefore})`);
  await go('tgl', 'poolOpen');
  /* отчёт спринта: он же «Итоги» продукта — план, сделано, перенесено, кто сколько закрыл */
  await go('tgl', 'report');
  await new Promise((r) => setTimeout(r, 140));
  await shot('39-sprint-report');
  const report = await text('.pane');
  want(['План', 'Сделано', 'Сверх плана', 'Перенесено', 'Кто сколько закрыл', 'По проектам'].every((w) => report.includes(w)),
    'отчёт спринта называет план, сделанное, перенос и разрез по людям и проектам');
  await go('tgl', 'report');
  /* приёмка: спрашивает, переносит незакрытое в следующий спринт и переводит туда вид */
  const before = await p.evaluate(() => ({ cyc: S.cycle, st: (S.cycles.find((c) => c.id === S.cycle) || {}).st,
    tail: S.items.filter((i) => i.c === S.cycle && (S.tasks.find((t) => t.id === i.t) || {}).st !== 'done').length }));
  await go('accept-sprint', before.cyc);
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.modal .hint')) === 1, 'приёмка спринта сперва спрашивает');
  want((await text('.modal')).includes(String(before.tail)), 'вопрос называет, сколько незакрытого переедет');
  await go('do-accept-sprint', before.cyc);
  await new Promise((r) => setTimeout(r, 150));
  const after = await p.evaluate((b) => ({ st: (S.cycles.find((c) => c.id === b.cyc) || {}).st, cyc: S.cycle,
    left: S.items.filter((i) => i.c === b.cyc && (S.tasks.find((t) => t.id === i.t) || {}).st !== 'done').length,
    moved: S.items.filter((i) => i.c === S.cycle && i.cf === b.cyc).length }), before);
  want(after.st === 'accepted', `спринт после приёмки принят (стало «${after.st}»)`);
  want(after.cyc !== before.cyc, 'вид переключился на следующий спринт, а не остался в принятом');
  want(before.tail > 0 && after.moved === before.tail,
    `незакрытое переехало в следующий спринт (было ${before.tail}, переехало ${after.moved})`);
  want(after.left === before.tail, 'принятый спринт остался слепком: его состав не опустел задним числом');
  await p.evaluate((b) => { S.cycles = CYCLES.slice(); S.cycle = b.cyc; S.items = SITEMS.slice(); S.tasks = TASKS.slice(); render(); }, before);
  await new Promise((r) => setTimeout(r, 90));
  await go('tab', 'analytics'); await shot('22-analytics');
  want((await count('.rowset .state.bad')) === 1, 'просрочка в аналитике выделена, а не спрятана среди прочих чисел');
  /* три вкладки одного экрана считают задачи цикла одинаково, и нагрузка не включает
     закрытые: иначе закрывший десять выглядит самым загруженным */
  const cyc = await p.evaluate(() => {
    const nums = {};
    document.querySelectorAll('.rowset > div').forEach((r) => {
      const k = (r.querySelector('.k') || r.firstElementChild || {}).textContent;
      const v = (r.querySelector('.v') || r.lastElementChild || {}).textContent || '';
      if (k) nums[k.trim()] = parseInt(v, 10);
    });
    const load = [...document.querySelectorAll('.bars .brow .v')].reduce((n, e) => n + +e.textContent, 0);
    const inCycle = cycleTasks();
    return { nums, load,
      open: inCycle.filter((t) => t.st !== 'done').length,
      lateDone: inCycle.filter((t) => t.st === 'done' && dueKind(t.due) === 'now').length,
      boardTotal: inCycle.length };
  });
  want(cyc.load + cyc.nums['Без исполнителя'] === cyc.open,
    `нагрузка по людям плюс «без исполнителя» = живые задачи цикла (${cyc.load} + ${cyc.nums['Без исполнителя']} против ${cyc.open})`);
  want(cyc.lateDone > 0 ? cyc.nums['Просрочено'] < cyc.open : true,
    `закрытые задачи не попали в «просрочено» (закрытых с прошедшим сроком ${cyc.lateDone})`);
  want((await text('.rowset')).includes('в прошлом цикле'), 'скорость цикла сравнивается с прошлым');
  await go('person-tasks', '501');
  await new Promise((r) => setTimeout(r, 120));
  want((await text('h1')) === 'Задачи', 'клик по полосе нагрузки уводит в задачи человека');
  await go('sec', 'sprints'); await go('tab', 'analytics');
  await go('tab', 'journal'); await shot('23-journal');
  const jm = await p.$$eval('.tl.log .e', (els) => els.map((e) => +e.dataset.m));
  want(jm.length > 3 && jm.every((v, i) => i === 0 || jm[i - 1] <= v),
    `журнал идёт от свежего к старому (${jm.join(' ')})`);
  /* идентификатор берём из действия, а не из текста: в строке теперь стоит НАЗВАНИЕ
     задачи, и выдирание цифр из текста молча давало нули */
  const jIds = await p.$$eval('.tl.log .lnk', (els) => els.map((e) => +e.dataset.id));
  want(jIds.length > 3 && jIds.every((v) => Number.isFinite(v) && v > 0), `журнал ссылается на живые задачи (${jIds.join(',')})`);
  /* «называет словами» проверяем сверкой с настоящим заголовком задачи: проверка на
     «есть кириллица» проходила и на «задача 131» — слово «задача» тоже кириллица */
  const jNamed = await p.evaluate(() => [...document.querySelectorAll('.tl.log .lnk')].filter((e) => {
    const t = S.tasks.find((x) => x.id === +e.dataset.id);
    const shown = e.textContent.replace(/…$/, '');
    return !t || !t.t.startsWith(shown);
  }).map((e) => e.textContent));
  want(jNamed.length === 0, `строка журнала называет задачу её заголовком (не сошлось: ${jNamed.join(' | ')})`);
  /* задача удалена — журнал не смеет предлагать ссылку на неё: либо строка уходит
     вместе с задачей, либо говорит, что задачи больше нет */
  const goneId = jIds[0];
  const kept = await p.evaluate((id) => { const all = S.tasks; S.tasks = S.tasks.filter((t) => t.id !== id); render(); window.__all = all; return all.length; }, goneId);
  await new Promise((r) => setTimeout(r, 90));
  const deadLink = await p.evaluate((id) => [...document.querySelectorAll('.tl.log .lnk')].some((e) => +e.dataset.id === id), goneId);
  want(kept > 0 && !deadLink, 'на удалённую задачу журнал ссылку не даёт');
  await p.evaluate(() => { S.tasks = window.__all; render(); });
  await new Promise((r) => setTimeout(r, 90));
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
  /* сообщение называет ОБА числа: одиночное падение «не сработало» без цифр нечем
     разбирать, а это место уже мигало один раз */
  const afterDrop = await count('tr.row');
  const st8 = await p.evaluate(() => ({ lens: S.lens, tab: S.tab, staff: S.staff, noProject: S.noProject,
    statuses: [...S.statuses], assignee: S.assignee, mk: S.mk, q: S.q }));
  want(afterDrop > ofPerson,
    `фильтр по человеку снимается крестиком (было ${ofPerson}, стало ${afterDrop}; состояние ${JSON.stringify(st8)})`);
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
  const prBefore = await count('.pcard');
  await go('switch-ws', 'latam');
  await new Promise((r) => setTimeout(r, 120));
  want(prBefore > 0 && (await count('.pcard')) === 0, 'переключение воркспейса меняет данные, а не только подпись');
  want((await text('.empty b')).length > 0, 'пустой воркспейс объясняет себя, а не показывает белый лист');
  await go('switch-ws', 'cee');
  await new Promise((r) => setTimeout(r, 120));
  want((await count('.pcard')) === prBefore, 'возврат в свой воркспейс возвращает данные');
  /* и возвращает ИМЕННО то, что было, включая созданное в этой сессии: раньше возврат
     пересобирал данные из констант и «Открытие BA» исчезало без единого слова */
  want((await p.evaluate(() => S.projects.some((x) => x.n === 'Открытие BA'))),
    'созданный проект пережил переключение воркспейса и возврат');
  await go('sec', 'team');
  await go('sec', 'settings'); await shot('26-settings');
  await go('tab', 'integr');
  await go('integr', 'granola');
  want((await text('.toast')).includes('переключена'), 'интеграция переключается');
  /* импорт заметок Granola: число неразобранных видно, и по кнопке они уезжают в базу */
  {
    /* шаг выше выключил Granola — включаем обратно, иначе импортировать нечем */
    if (!(await p.evaluate(() => (S.integrations.find((i) => i.id === 'granola') || {}).st === 'on'))) await go('integr', 'granola');
    const before = await p.evaluate(() => ({ n: S.granolaNew, entries: S.entries.length }));
    const said = await p.evaluate(() => (document.querySelector('.rowset') || {}).textContent || '');
    want(before.n > 0 && said.includes(String(before.n)), `число необработанных заметок названо (${before.n})`);
    await go('granola-import');
    await new Promise((r) => setTimeout(r, 140));
    const after = await p.evaluate(() => ({ n: S.granolaNew, entries: S.entries.length }));
    want(after.entries === before.entries + 1 && after.n === 0,
      `импорт заметок довёз запись до базы (записей ${before.entries} → ${after.entries}, осталось ${after.n})`);
  }
  /* Роли задач — справочник, а не константа в коде: в продукте набор зашит
     (marketing/bd/rnd) и поле скрыто флагом, поэтому ролью никто не пользуется.
     Заведённая роль обязана быть доступна в задаче сразу, а снятая — уйти с задач. */
  await go('tab', 'roles');
  want((await count('[data-act="add-role"]')) === 1, 'роли задач настраиваются с экрана настроек');
  await go('add-role');
  await p.type('[data-f="n"]', 'Операции');
  await go('save-role', '');
  await new Promise((r) => setTimeout(r, 140));
  const newRole = await p.evaluate(() => S.roles.find((r) => r.n === 'Операции') || null);
  want(newRole !== null, 'новая роль появилась в справочнике');
  await go('sec', 'tasks');
  const roleTask = await p.evaluate(() => visibleTasks()[0].id);
  await go('open-task', roleTask);
  await go('tgl', 'allProps');
  await new Promise((r) => setTimeout(r, 120));
  const roleChoices = await p.evaluate(() => [...document.querySelectorAll('.detail .props .mi')].map((e) => e.textContent.trim()));
  want(roleChoices.includes('Операции'), 'заведённая роль сразу доступна в задаче');
  await gov2('set-role', roleTask, newRole.id);
  await new Promise((r) => setTimeout(r, 120));
  want((await p.evaluate((id) => S.tasks.find((t) => t.id === id).role, roleTask)) === newRole.id,
    'роль ставится в задаче');
  await go('tgl', 'allProps');
  await go('close');
  await go('sec', 'settings'); await go('tab', 'roles');
  await go('del-role', newRole.id);
  const roleAsks = (await count('.modal [data-act="do-del-role"]')) === 1;
  const roleSaid = await text('.modal');
  want(roleAsks && /задач/.test(roleSaid), `удаление роли спрашивает и называет, с каких задач она уйдёт («${roleSaid.trim().slice(0, 60)}»)`);
  await go('do-del-role', newRole.id);
  await new Promise((r) => setTimeout(r, 140));
  const roleGone = await p.evaluate((id) => ({ inDict: S.roles.some((r) => r.id === id), onTasks: S.tasks.filter((t) => t.role === id).length }), newRole.id);
  want(!roleGone.inDict && roleGone.onTasks === 0,
    `снятая роль ушла и из справочника, и с задач (на задачах ${roleGone.onTasks})`);
  /* Список в продукте ЛИЧНЫЙ: задача, попавшая в список, становится личной. Иначе
     личный список одного человека уезжает в общий список чужими глазами. */
  await go('sec', 'tasks');
  const openTask = await p.evaluate(() => (visibleTasks().find((t) => !t.priv && !t.labels.length) || {}).id);
  const someLabel = await p.evaluate(() => S.labels[0].id);
  await gov2('tgl-label', openTask, someLabel);
  await new Promise((r) => setTimeout(r, 120));
  const gotPriv = await p.evaluate((id) => { const t = S.tasks.find((x) => x.id === id); return { priv: t.priv, has: t.labels.length }; }, openTask);
  want(gotPriv.has === 1 && gotPriv.priv === true, 'задача, попавшая в список, стала личной');
  await gov2('tgl-label', openTask, someLabel);
  await go('sec', 'settings');
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
  await go('tab', 'labels'); await shot('37-labels');
  const labelsBefore = await count('[data-act="rename-label"]');
  await go('add-label');
  await p.type('[data-f="n"]', 'приёмка');
  await go('save-label');
  await new Promise((r) => setTimeout(r, 90));
  want((await count('[data-act="rename-label"]')) === labelsBefore + 1, 'метка добавилась');
  /* объявление об обновлении: страница перезагрузится сама, и человек должен знать,
     почему у него дёрнется экран. Полоса обязана убираться, иначе она вечная. */
  await p.evaluate(() => { S.deploy = true; render(); });
  await new Promise((r) => setTimeout(r, 120));
  const dep = await p.evaluate(() => {
    const el = document.querySelector('.deploy');
    const r = el.getBoundingClientRect();
    const main = document.querySelector('.main').getBoundingClientRect();
    return { open: el.classList.contains('open'), text: el.textContent,
      covers: r.bottom > main.top + 60 };
  });
  want(dep.open && /перезагруз/i.test(dep.text), `объявление об обновлении названо словами («${dep.text.trim().slice(0, 40)}»)`);
  want(!dep.covers, 'объявление не накрывает рабочую область — из-под него читается экран');
  await go('tgl', 'deploy');
  await new Promise((r) => setTimeout(r, 120));
  want(!(await p.evaluate(() => document.querySelector('.deploy').classList.contains('open'))),
    'объявление убирается кнопкой, а не висит вечно');

  await go('sec', 'admin'); await shot('28-admin');
  const allUsers = await count('tbody tr');
  await go('tgl-nomail');
  await new Promise((r) => setTimeout(r, 90));
  const noMail = await count('tbody tr');
  want(noMail > 0 && noMail < allUsers, `фильтр «только без почты» сужает список (было ${allUsers}, стало ${noMail})`);
  want((await count('[data-act="bind-mail"]')) === noMail, 'кнопка «привязать почту» стоит ровно у тех, у кого почты нет');
  /* подпись обещает привязку — значит привязка и происходит, а не открывается карточка */
  await go('bind-mail', (await p.$eval('[data-act="bind-mail"]', (e) => e.dataset.id)));
  await p.type('[data-f="em"]', 'nikola@imf.example');
  await go('do-bind-mail', (await p.evaluate(() => S.users.find((u) => !u.em).id)));
  await new Promise((r) => setTimeout(r, 120));
  want((await p.evaluate(() => S.users.filter((u) => !u.em).length)) === noMail - 1,
    'кнопка «привязать почту» действительно привязывает почту');
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
  /* экрана «Карта системы» больше нет: в продукте такой поверхности не существует,
     её придумал стенд, и владелец снял её из рейки 20.09.2026 */

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
  /* база знаний обязана находить сказанное на встрече, а не только её название */
  const inTez = await p.evaluate(() => {
    const m = S.meetings.find((x) => (x.tez || []).length);
    const word = ((m.tez[0].li || [])[0] || '').split(' ').find((w) => w.length > 6) || '';
    return { word, byTitle: m.t.toLowerCase().includes(word.toLowerCase()), found: searchAll(word).meetings.some((x) => x.id === m.id) };
  });
  want(inTez.word && !inTez.byTitle && inTez.found,
    `слово из тезисов находит встречу («${inTez.word}», в названии его нет: ${!inTez.byTitle})`);
  /* счётчик не смеет считать обрезанный список: иначе «найдено 8» вместо тридцати */
  const capped = await p.evaluate(() => {
    const before = S.tasks;
    S.tasks = [...Array(30)].map((_, i) => ({ ...before[0], id: 9000 + i, t: 'смета проверка ' + i }));
    const r = searchAll('смета');
    S.tasks = before;
    return { total: r.total, shown: r.tasks.length };
  });
  want(capped.total >= 30 && capped.shown === 8 && capped.total > capped.shown,
    `счётчик называет всё найденное, а показывает первые (нашлось ${capped.total}, показано ${capped.shown})`);
  /* и то же самое ГЛАЗАМИ на экране, а не только в функции: печатать надо найденное,
     а не длину показанного куска */
  const printed = await p.evaluate(() => {
    const said = (document.querySelector('.bar .right span') || {}).textContent || '';
    return { said, total: searchAll(S.aq || '').total, rows: document.querySelectorAll('.srch .rowset > div').length };
  });
  want(printed.said.includes(String(printed.total)),
    `на экране напечатано всё найденное (в строке «${printed.said.trim()}», найдено ${printed.total}, строк ${printed.rows})`);
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
