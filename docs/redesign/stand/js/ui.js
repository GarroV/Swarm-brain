/* Атомы разметки. Ни один экран не собирает HTML руками мимо этих функций. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]));
const act = (a, id, v) => `data-act="${a}"${id !== undefined ? ` data-id="${id}"` : ""}${v !== undefined ? ` data-v="${esc(v)}"` : ""}`;

const av = (id, withName) => { const u = user(id); if (!u) return `<span class="muted">— не назначен</span>`;
  return `<span class="av" style="background:${u.c}" title="${esc(u.n)}">${u.i}</span>${withName === false ? "" : `<span class="nm">${esc(u.n)}</span>`}`; };
const avs = (ids) => ids.length ? ids.map((i) => av(i, false)).join("") : `<span class="muted">—</span>`;
/* плотные таблицы: «Никола Й.» вместо обрезанного «Никола Йована…».
   Полное имя остаётся в подсказке, в панели детали и в «Команде». */
const sname = (id) => { const u = user(id); if (!u) return "— не назначен";
  const [f, l] = u.n.split(" "); return l ? `${f} ${l[0]}.` : f; };
const avShort = (id) => { const u = user(id); if (!u) return `<span class="muted">— не назначен</span>`;
  return `<span class="av" style="background:${u.c}" title="${esc(u.n)}">${u.i}</span><span class="nm">${esc(sname(id))}</span>`; };
/* Только кружок с инициалами: в плотном списке имя рядом с ним — тот же факт вторым
   начертанием, а в группировке по людям ещё и третьим (имя стоит в заголовке группы). */
const avOnly = (id) => { const u = user(id); if (!u) return `<span class="muted">не назначен</span>`;
  return `<span class="av" style="background:${u.c}" title="${esc(u.n)}">${u.i}</span>`; };
const dot = (st) => `<span class="dot d-${st}"></span>`;
/* срок: красный только у незавершённой задачи — у сделанной «просрочено» уже ничего не значит */
const due = (iso, done) => iso ? `<span class="due ${done ? "" : dueKind(iso)}">${fmtDate(iso)}</span>` : `<span class="muted">—</span>`;
/* дата факта (загружено, отправлено, добавлено) — она в прошлом всегда, красить её нечем */
const dt = (iso) => iso ? `<span class="due">${fmtDate(iso)}</span>` : `<span class="muted">—</span>`;
const tag = (text, kind) => `<span class="tag tag-${kind || "o"}">${esc(text)}</span>`;
/* пустая ячейка неотличима от «не поместилось»: нет значения — ставим прочерк */
const lbls = (ids) => ids.map((id) => { const l = label(id); return l ? tag(l.n, "l") : ""; }).join("")
  || `<span class="muted">—</span>`;
/* в списке рядом с точкой статуса вторая точка нечитаема: показываем только высокий приоритет */
const cc = (codes) => codes.length ? codes.map((c) => `<span class="cc" title="${esc(cname(c))}">${c}</span>`).join("") : "";
const wsChip = () => {
  const cur = S.workspaces.find((w) => w.active) || S.workspaces[0];
  return `<span class="drop">${btn(`Воркспейс: ${cur.name}`, "noop", undefined, undefined, "sm")}
    <div class="dmenu">${S.workspaces.map((w) => `<button class="mi${w.active ? " on" : ""}" ${act("switch-ws", w.id)}>${esc(w.name)} · ${nPeople(w.users)}</button>`).join("")}
    <button class="mi" ${act("new-ws")}>＋ Новый воркспейс</button></div></span>`;
};
/* русские числительные: «1 задача», «2 задачи», «5 задач».
   Интерфейс двуязычный, и в EN подставится простая форма из второго аргумента. */
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  const word = a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  return `${n} ${word}`;
};
const nTasks = (n) => plural(n, "задача", "задачи", "задач");
const nFrag = (n) => plural(n, "фрагмент", "фрагмента", "фрагментов");
const nPeople = (n) => plural(n, "человек", "человека", "человек");
const nMeet = (n) => plural(n, "встреча", "встречи", "встреч");
/* «Фильтры» одной кнопкой. Разложенный подряд ряд переключателей — тот же дефект,
   что и варианты в панели детали: место занимают все, включены один-два. Число на
   кнопке и снимаемые чипы рядом говорят, почему список короткий. */
const fgroups = (groups) => `<div class="dmenu wide">${groups.map(([title, items]) =>
  `<div class="mgrp">${esc(title)}</div>` + items.map(([t, a, id, v, on]) =>
    `<button class="mi${on ? " on" : ""}" ${act(a, id, v)}>${t}</button>`).join("")).join("")}</div>`;
const fdrop = (n, groups) => `<span class="drop">${btn(n ? `Фильтры · ${n}` : "Фильтры", "noop", undefined, undefined, "sm" + (n ? " on" : ""))}${fgroups(groups)}</span>`;
const fchips = (list) => list.map(([t, a, id, v]) =>
  `<button class="chip on" ${act(a, id, v)}>${esc(t)}<span class="x">×</span></button>`).join("");

/* Поле панели: на виду ЗНАЧЕНИЕ, варианты приходят по клику.
   Разложить все варианты рядом — значит показать орган управления вместо данных:
   у задачи так выходило 26 кнопок на 9 полей, и выбранное терялось среди невыбранного. */
const fmenu = (items) => `<div class="dmenu">${items.map(([t, a, id, v, on]) =>
  `<button class="mi${on ? " on" : ""}" ${act(a, id, v)}>${t}</button>`).join("")}</div>`;
const pickf = (value, items) => `<span class="drop"><button class="fv" ${act("noop")}>${value}<i class="cv"></i></button>${fmenu(items)}</span>`;
/* многозначное поле: на виду только ВЫБРАННОЕ, «＋» открывает остальное */
const pickm = (chosen, items) => `<span class="fmulti">${chosen}<span class="drop"><button class="fv add" ${act("noop")}>＋</button>${fmenu(items)}</span></span>`;
/* Свойство задачи — чип «подпись · значение» в выровненной сетке: значение видно всегда,
   варианты приходят по нажатию. Подписи стоят колонкой, поэтому значения не висят лесенкой. */
const pchip = (k, v, items, cls) => `<span class="drop pc${cls ? " " + cls : ""}"><button class="pchip" ${act("noop")}><span class="k">${esc(k)}</span><span class="v">${v}</span><i class="cv"></i></button>${fmenu(items)}</span>`;
const pflat = (k, v, cls) => `<span class="pchip static${cls ? " " + cls : ""}"><span class="k">${esc(k)}</span><span class="v">${v}</span></span>`;
const chip = (text, on, a, id, v) => `<button class="chip${on ? " on" : ""}" ${act(a, id, v)}>${esc(text)}</button>`;
/* off — кнопка, которой сейчас нечего делать: недоступной её видно, а молча не срабатывающей — нет */
const btn = (text, a, id, v, cls, off) => `<button class="btn${cls ? " " + cls : ""}"${off ? " disabled" : ""} ${act(a, id, v)}>${esc(text)}</button>`;
const empty = (title, sub) => `<div class="empty"><b>${esc(title)}</b>${sub ? esc(sub) : ""}</div>`;
/* обрезка без многоточия читается как конец фразы: «...держит цену до конца не».
   Режем по границе слова и всегда ставим знак обрезки. */
const clip = (t, n) => { const s = String(t || ""); if (s.length <= n) return s;
  const cut = s.slice(0, n); const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:—-]+$/, "") + "…"; };
/* размер везде из одного числа: строки в данных расходились с итогом, а разделитель
   был то запятой, то точкой («1,2 МБ» в таблице против «5.0 МБ» в шапке) */
const fsz = (kb) => kb >= 1024 ? `${(kb / 1024).toFixed(1).replace(".", ",")} МБ` : `${kb} КБ`;
const lab = (t) => `<div class="lab">${esc(t)}</div>`;
const rows = (list) => `<div class="rowset">${list.map(([k, v, a]) =>
  `<div><span class="k">${k}</span><span class="v">${v}</span>${a ? `<span class="a">${a}</span>` : ""}</div>`).join("")}</div>`;
const state = (text, ok) => `<span class="state ${ok ? "on" : "off"}">${esc(text)}</span>`;
/* просрочка — не нейтральное состояние: серый значок её прячет */
const alert_ = (text) => `<span class="state bad">${esc(text)}</span>`;

/* c.opt — колонка второго ряда важности: в узком окне она уходит,
   вместо того чтобы сжимать всё до обрезанных заголовков и имён. */
/* ниже этой ширины деталь ложится поверх списка и места у него не отнимает.
   Тот же порог в app.css: @media (max-width:1140px) — менять их только вместе. */
/* места мало: деталь занимает половину окна или само окно узкое — тогда часть колонок прячется */
const cssPx = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
/* Теснота считается по ширине РАБОЧЕЙ ОБЛАСТИ. Деталь её больше не отнимает:
   панель выезжает ПОВЕРХ и колонки под ней не пересчитываются — иначе каждое
   открытие задачи перекладывало бы весь список.
   Те же числа стоят в container-запросах в app.css — правим парой. */
/* Рабочая ширина области: окно минус навигация. Выехавшую панель не вычитаем —
   каркас под ней не перестраивается (так задумано), и таблица остаётся прежней ширины. */
const workW = () => Math.max(320, window.innerWidth - cssPx("--nav-w"));
const tight = () => workW() <= 1080;

function table(cols, body, w) {
  /* table-layout:fixed не раздаёт остаток колонке без ширины — считаем ширины сами,
     иначе после скрытия колонок справа остаётся пустая полоса */
  /* calc с процентами в table-layout:fixed Chrome считает неверно (проверено: calc(65% - 114px) → 105px),
     поэтому пиксели переводим в проценты по ширине области и раздаём остаток — сумма всегда 100% */
  /* ширину области считаем из сетки, а не из DOM: на момент генерации разметки класс with-detail ещё прежний */
  const W = w || workW();
  const shown = cols.filter((c) => !(c.opt && tight()));
  const asPct = (w) => w.endsWith("%") ? parseFloat(w) : (parseFloat(w) / W) * 100;
  let fixed = 0, flex = 0;
  shown.forEach((c) => { if (c.w) fixed += asPct(c.w); else flex++; });
  const rest = flex ? Math.max(12, (100 - fixed) / flex) : 0;
  /* если заданное вместе с остатком переросло 100%, ужимаем всё пропорционально, иначе колонки обрежутся вразнобой */
  const total = fixed + rest * flex;
  const k = total > 100 ? 100 / total : 1;
  const pc = (v) => `${Math.round(v * k * 100) / 100}%`;
  const width = (c) => (c.opt && tight()) ? "" : ` style="width:${pc(c.w ? asPct(c.w) : rest)}"`;
  /* Содержимое раздела лежит в КАРТОЧКЕ, отбитой от рейки, — один вид на все экраны,
     эталоном взяты «Проекты» (владелец 22.09.2026: «давай приведём всё к единому
     варианту, визуал того, как сейчас выглядят проекты, мне нравится»). До этого таблицы
     шли от края до края и серая полоса шапки упиралась в рейку — разделы выглядели из
     разных приложений. */
  return `<div class="list"><div class="sheet"><table><thead><tr>${cols.map((c) =>
    `<th class="${c.r ? "r " : ""}${c.opt ? "opt" : ""}"${width(c)}>${
      c.short && tight() ? esc(c.short) : esc(c.t)
    }</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody></table></div></div>`;
}
const cell = (v, cls) => `<td${cls ? ` class="${cls}"` : ""}>${v}</td>`;

/* ── модалка ─────────────────────────────────────────────────── */
function modal(title, body, foot, wide) {
  $(".mscrim").classList.add("open");
  const m = $(".modal");
  m.classList.add("open"); m.classList.toggle("wide", !!wide);
  m.innerHTML = `<header><h3>${esc(title)}</h3><button class="btn" ${act("mclose")}>✕</button></header>
    <div class="mbody">${body}</div><footer>${foot}</footer>`;
}
function closeModal() { $(".mscrim").classList.remove("open"); const m = $(".modal"); m.classList.remove("open", "wide"); }
const fld = (label_, inner) => `<div class="fld"><label>${esc(label_)}</label>${inner}</div>`;
const input = (name, value, ph, type) => `<input data-f="${name}"${type ? ` type="${type}"` : ""} value="${esc(value || "")}" placeholder="${esc(ph || "")}">`;
const dateInput = (name, value) => input(name, value, "", "date");
const area = (name, value, ph) => `<textarea data-f="${name}" placeholder="${esc(ph || "")}">${esc(value || "")}</textarea>`;
const select = (name, opts, sel) => `<select data-f="${name}">${opts.map(([v, t]) =>
  `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
/* one — поле, где модель хранит ОДНО значение: без этого форма разрешает отметить три рынка,
   а сохраняется первый, молча и без предупреждения */
const pick = (name, opts, selected, one) => `<div class="pick" data-pick="${name}"${one ? " data-one" : ""}>${opts.map(([v, t]) =>
  `<span class="chip${selected.includes(v) ? " on" : ""}" data-v="${esc(v)}">${esc(t)}</span>`).join("")}</div>`;
const sw = (name, on, text) => `<div class="sw${on ? " on" : ""}" data-sw="${name}"><i></i>${esc(text)}</div>`;
const formData = () => {
  const o = {};
  $$(".modal [data-f]").forEach((e) => { o[e.dataset.f] = e.type === "checkbox" ? e.checked : e.value; });
  $$(".modal [data-pick]").forEach((p) => { o[p.dataset.pick] = [...p.querySelectorAll(".chip.on")].map((c) => c.dataset.v); });
  $$(".modal [data-sw]").forEach((s) => { o[s.dataset.sw] = s.classList.contains("on"); });
  return o;
};

/* Ссылки в форме вводятся строками: пустые строки и мусор без схемы отбрасываем —
   ссылка, по которой нельзя перейти, хуже её отсутствия. */
const urlList = (text) => String(text || "").split("\n").map((x) => x.trim())
  .filter((x) => /^https?:\/\/\S+$/.test(x));

/* Кнопка-значок для редкого действия. Подпись обязательна: значок без наводки —
   загадка, её жмут наугад, а «удалить» наугад жать нельзя. */
const ibtn = (glyph, title, a, id, v) =>
  `<button class="ibtn" title="${esc(title)}" aria-label="${esc(title)}" ${act(a, id, v)}>${glyph}</button>`;
