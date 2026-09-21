/* Экран задач: ось времени (вкладки) × линза × статусы × поиск × группировки. */

const LENSES = [["mine", "Мои"], ["team", "Командные"], ["all", "Все"]];
const STATUSES = [["open", "Открыто"], ["in_progress", "В работе"], ["done", "Готово"]];
/* подпись переключателя живёт в одном месте: в меню и в снимаемом чипе он звался
   «группировать по рынкам» и «по рынкам» — два имени у одного тумблера */
const SHOW_TGL = { byMarket: "группировать по рынкам", staff: "все сотрудники",
  recurOnly: "только регулярные", archOn: "показать архив" };

/* Панель фильтров — ОДНА строка и три зоны: чья работа (переключатель), статус
   (чипы, их владелец просил вернуть), остальное (рынок и редкое — меню).
   Чипы вернулись, но не все подряд: семь стран чипами и были тем самым
   нагромождением, из-за которого фильтры уехали в две строки. */
function tasksToolbar() {
  const admin = me().role === "admin";
  const seg = LENSES.map(([id, nm]) =>
    `<button class="sg${S.lens === id ? " on" : ""}" ${act("lens", id)}>${esc(nm)}</button>`).join("");
  const sts = STATUSES.map(([id, nm]) =>
    `<button class="chip${S.statuses.has(id) ? " on" : ""}" ${act("status", id)}>${dot(id)}${esc(nm)}</button>`).join("");
  const mkItems = [["все рынки", "mk-filter", undefined, "", !S.mk],
    ...COUNTRIES.map((c) => [`<span class="cc">${c.c}</span>${esc(c.n)}`, "mk-filter", undefined, c.c, S.mk === c.c])];
  const more = [[SHOW_TGL.byMarket, "tgl", "byMarket", undefined, S.byMarket],
    [SHOW_TGL.recurOnly, "tgl", "recurOnly", undefined, S.recurOnly],
    [SHOW_TGL.archOn, "tgl", "archOn", undefined, S.archOn],
    ...(admin ? [[SHOW_TGL.staff, "tgl", "staff", undefined, S.staff]] : [])];
  const nMore = (S.byMarket ? 1 : 0) + (S.recurOnly ? 1 : 0) + (S.archOn ? 1 : 0) + (S.staff ? 1 : 0);
  /* редкое и пришедшее извне (клик по карте, по человеку) остаётся снимаемым чипом:
     фильтр, который сузил список молча, человек ищет глазами и не находит */
  const extra = [
    ...(S.noProject ? [["без проекта", "drop-no-project"]] : []),
  ];
  return `<div class="bar">
    <span class="seg">${seg}</span>
    <span class="sep-v"></span>
    ${sts}
    <span class="drop">${btn(S.mk ? `Рынок: ${S.mk}` : "Рынок", "noop", undefined, undefined, "sm" + (S.mk ? " on" : ""))}${fmenu(mkItems)}</span>
    <span class="drop">${btn(S.period === "any" ? "Период" : `Период: ${PERIOD[S.period]}`, "noop", undefined, undefined, "sm" + (S.period === "any" ? "" : " on"))}${
      fmenu(Object.keys(PERIOD).map((k) => [PERIOD[k], "set-period", undefined, k, S.period === k]))}</span>
    <span class="drop">${btn(nMore ? `Ещё · ${nMore}` : "Ещё", "noop", undefined, undefined, "sm" + (nMore ? " on" : ""))}${fmenu(more)}</span>
    ${fchips(extra)}
    ${S.assignee ? `<button class="chip on" ${act("drop-assignee")}>${av(S.assignee)}<span class="x">×</span></button>` : ""}
    <div class="right">
      <input class="qin" placeholder="Фильтр по названию" value="${esc(S.q)}" data-qin="tasks">
      <span>Показано <b>${visibleTasks().length}</b> из ${scopeCount()}</span>
      ${btn("＋ Задача", "new-task", undefined, undefined, "pri sm")}
    </div></div>`;
}

/* Быстрые действия прямо в строке — перенос TaskQuickActions из продукта:
   СРОК · ПИНГ · ПОВТОР (только у задачи со сроком) · ИСПОЛНИТЕЛЬ · РЫНОК · СПИСКИ.
   Без них смена даты стоила открытия карточки, а это самое частое движение в списке. */
const DAY = 864e5;
const shiftDate = (n) => new Date(Date.parse(TODAY + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const DATE_QUICK = [["сегодня", 0], ["завтра", 1], ["через неделю", 7]];
const dateItems = (a, id, cur) => [
  ...DATE_QUICK.map(([n, d]) => [`${n} · ${fmtDate(shiftDate(d))}`, a, id, String(d), cur === shiftDate(d)]),
  ["убрать", a, id, "", !cur]];

function taskQuick(t) {
  const q = (icon, title, on, items) =>
    `<span class="drop"><button class="qa${on ? " on" : ""}" title="${esc(title)}" ${act("noop")}>${icon}</button>${fmenu(items)}</span>`;
  return `<span class="qas">
    ${q("📅", t.due ? `срок: ${fmtDate(t.due)}` : "срок не задан", !!t.due, dateItems("set-due-q", t.id, t.due))}
    ${q("⏰", t.ping ? (t.pinged ? `напомнили ${fmtDate(t.ping)}` : `напомним ${fmtDate(t.ping)}`) : "пинг не задан",
      !!t.ping && !t.pinged, dateItems("set-ping-q", t.id, t.ping))}
    ${t.due ? q("↻", t.recur ? `повтор: ${RECUR_LABEL[t.recur]}` : "без повтора", !!t.recur,
      ["", "weekly", "monthly"].map((r) => [r ? RECUR_LABEL[r] : "без повтора", "set-recur", t.id, r, (t.recur || "") === r])) : ""}
    ${q("👤", t.who.length ? `исполнитель: ${user(t.who[0]).n}` : "исполнитель не назначен", !!t.who.length,
      /* в выпадающем списке строки — имена без аватаров: картинка в узкой колонке
         растягивает меню шире ячейки и режет то самое имя */
      [["— не назначен", "set-who", t.id, "", !t.who.length],
        ...S.users.map((u) => [esc(u.n), "set-who", t.id, String(u.id), t.who[0] === u.id])])}
    ${q(t.mk ? `<span class="cc">${t.mk}</span>` : "🏳", t.mk ? `рынок: ${cname(t.mk)}` : "рынок не указан", !!t.mk,
      [["— без рынка", "set-mk", t.id, "", !t.mk], ...COUNTRIES.map((c) => [`<span class="cc">${c.c}</span>${esc(c.n)}`, "set-mk", t.id, c.c, t.mk === c.c])])}
    ${q("☰", t.labels.length ? `списки: ${t.labels.map((id) => (label(id) || {}).n).join(", ")}` : "списки — личные: задача станет личной",
      !!t.labels.length, [["— личные списки: задача станет личной", "noop"],
        ...S.labels.map((l) => [esc(l.n), "tgl-label", t.id, l.id, t.labels.includes(l.id)])])}
  </span>`;
}

function taskRow(t) {
  /* пинг виден в строке, только пока ЖДЁТ: отзвонивший сгорел, и висящий значок
     обещал бы напоминание, которого не будет (правило продукта, TaskRow) */
  const ping = t.ping && !t.pinged ? `<span class="ping" title="напомним ${fmtDate(t.ping)}">⏰ ${fmtDate(t.ping)}</span>` : "";
  return `<tr class="row${S.sel === t.id && S.selKind === "task" ? " sel" : ""}" ${act("open-task", t.id)} tabindex="0">
    ${cell(`${dot(t.st)}${priMark(t.prio)}${esc(t.t)}${t.priv ? ' <span class="lock" title="личная">🔒</span>' : ""}`, "t")}
    ${cell(esc(projPath(t.pr)))}
    ${cell(t.who.length ? avShort(t.who[0]) : `<span class="muted" title="исполнитель не назначен">—</span>`)}
    ${cell(lbls(t.labels) + (t.recur ? tag(RECUR_SHORT[t.recur], "p") : "") + ping, "opt")}
    ${cell(t.mk ? `<span class="cc">${t.mk}</span>` : `<span class="muted">—</span>`, "r opt")}
    ${cell(due(t.due, t.st === "done"), "r")}
    ${cell(taskQuick(t), "qc opt")}</tr>`;
}

function groupRows(list) {
  const cols = 7;
  const sect = (n, k) => `<tr class="sect"><td colspan="${cols}">${esc(n)} · ${k}</td></tr>`;
  if (S.byMarket) {
    const by = {};
    list.forEach((t) => { const k = t.mk || "Без рынка"; (by[k] = by[k] || []).push(t); });
    return Object.keys(by).sort().map((k) => sect(k === "Без рынка" ? k : cname(k), by[k].length) + by[k].map(taskRow).join("")).join("");
  }
  if (!S.archOn) {
    /* завершённая задача не «просрочена» и не «на сегодня»: срок у неё уже ничего не требует */
    const done = list.filter((t) => t.st === "done");
    const live = list.filter((t) => t.st !== "done");
    const over = live.filter((t) => dueKind(t.due) === "now");
    const today = live.filter((t) => dueKind(t.due) === "today");
    const later = live.filter((t) => !over.includes(t) && !today.includes(t) && t.due);
    const nodue = live.filter((t) => !t.due);
    return (over.length ? sect("Просрочено", over.length) + over.map(taskRow).join("") : "")
      + (today.length ? sect("Сегодня", today.length) + today.map(taskRow).join("") : "")
      + (later.length ? sect("Дальше", later.length) + later.map(taskRow).join("") : "")
      + (nodue.length ? sect("Без срока", nodue.length) + nodue.map(taskRow).join("") : "")
      + (done.length ? sect("Сделано", done.length) + done.map(taskRow).join("") : "");
  }
  return list.map(taskRow).join("");
}

function screenTasks() {
  const list = visibleTasks();
  /* встречи дня живут на главной: в списке задач полоса занимала верх экрана и
     отжимала работу вниз, ничего при этом не решая */
  const head = tasksToolbar();
  if (!list.length) {
    /* пустой экран без объяснения читается как «данных нет»: называем, сколько скрыто фильтрами */
    const hidden = scopeCount();
    return head + empty("Задач в этом срезе нет", hidden
      ? `Фильтры скрывают ещё ${hidden}`
      : "Здесь пока ничего нет")
      + (hidden ? `<div class="emptyact">${btn("Показать все", "reset-filters", undefined, undefined, "pri")}</div>` : "");
  }
  return head + table([
    { t: "Задача" }, { t: "Проект", w: "20%" }, { t: "Исполнитель", short: "Кто", w: "15%" },
    { t: "Списки", w: "17%", opt: true }, { t: "Рынок", r: true, w: "72px", opt: true }, { t: "Срок", r: true, w: "84px" },
    { t: "", w: "180px", opt: true },
  ], groupRows(list)) + whatsNext(list);
}

/* Короткий список оставлял пол-экрана белым: человек видит три строки и не знает,
   это всё или он сам себе сузил фильтр. Экран отвечает тем, что будет дальше. */
function whatsNext(list) {
  if (S.archOn || list.length > 6) return "";
  const shown = new Set(list.map((t) => t.id));
  const soon = S.tasks.filter((t) => !t.arch && t.st !== "done" && t.due && !shown.has(t.id) && inLens(t, S.lens))
    .sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, 4);
  const done = S.tasks.filter((t) => !t.arch && t.st === "done" && inLens(t, S.lens)).slice(0, 3);
  if (!soon.length && !done.length) return "";
  const line = (t) => `<div class="nx" ${act("open-task", t.id)} tabindex="0">${priMark(t.prio)}${esc(clip(t.t, 54))}
    <span class="r">${t.st === "done" ? state("закрыта", true) : due(t.due, false)}</span></div>`;
  return `<div class="next">
    ${soon.length ? `<div><div class="lab">Дальше по сроку</div>${soon.map(line).join("")}</div>` : ""}
    ${done.length ? `<div><div class="lab">Недавно закрытые</div>${done.map(line).join("")}</div>` : ""}
  </div>`;
}

/* ── модалка создания задачи ─────────────────────────────────── */
function newTaskModal(preset) {
  modal("Новая задача", `
    ${fld("Что сделать", input("title", preset && preset.title, "Коротко и по делу"))}
    ${fld("Описание", area("note", "", "Контекст, ссылки, детали"))}
    <div class="two">
      ${fld("Проект", select("pr", S.projects.map((p) => [p.id, (p.parent ? "— " : "") + p.n]), "p1"))}
      ${fld("Исполнитель", select("who", [["", "— не назначен"], ...S.users.map((u) => [String(u.id), u.n])], String(ME)))}
    </div>
    <div class="two">
      ${fld("Срок", dateInput("due", ""))}
      ${fld("Приоритет", select("prio", [["", "не задан"], ["high", "высокий"], ["med", "средний"], ["low", "низкий"]], ""))}
    </div>
    ${fld("Списки (личные)", pick("labels", S.labels.map((l) => [l.id, l.n]), []))}
    ${fld("Рынок", pick("mk", COUNTRIES.map((c) => [c.c, c.n]), [], true))}
    <div class="two">
      ${fld("Повтор", select("recur", [["", "без повтора"], ["weekly", "каждую неделю"], ["monthly", "каждый месяц"]], ""))}
      ${fld("Напомнить (пинг)", dateInput("ping", ""))}
    </div>
    ${fld("Приватность", sw("priv", false, "Личная задача — видна только мне"))}`,
    `${btn("Отмена", "mclose")}${btn("Создать задачу", "create-task", undefined, undefined, "pri")}`);
}
