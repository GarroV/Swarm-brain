/* Экран задач: ось времени (вкладки) × линза × статусы × поиск × группировки. */

const LENSES = [["mine", "Мои"], ["team", "Командные"], ["all", "Все"]];
/* в панели фильтров статусов больше нет, но меню смены статуса в карточке осталось */
const STATUSES = [["open", "Открыто"], ["in_progress", "В работе"], ["done", "Готово"]];
/* подпись переключателя живёт в одном месте: в меню и в снимаемом чипе он звался
   «группировать по рынкам» и «по рынкам» — два имени у одного тумблера */
const SHOW_TGL = { byMarket: "группировать по рынкам",
  recurOnly: "только регулярные", archOn: "показать архив" };

/* Панель фильтров — ОДНА строка и три зоны: чья работа (переключатель), готовые
   (один тумблер), остальное (рынок и редкое — меню).
   Три чипа статусов сняты (владелец, 21.09): выбирать «Открыто» отдельно от «В работе»
   никто не просил, а решение всегда одно — показать завершённое или убрать его. */
function tasksToolbar() {
  const admin = me().role === "admin";
  /* Выбран человек — смотрим ВСЮ его работу, и «Мои / Командные / Все» тут нечего делить:
     переключатель гаснет (решение владельца 22.09.2026) и оживает, как только сотрудника
     снимают. Гасим, а не прячем: исчезнувший орган управления человек ищет и не находит. */
  const lensOff = !!S.assignee;
  const seg = LENSES.map(([id, nm]) =>
    `<button class="sg${S.lens === id ? " on" : ""}"${lensOff ? " disabled" : ""} ${act("lens", id)}>${esc(nm)}</button>`).join("");
  const doneOn = S.statuses.has("done");
  const sts = `<button class="chip${doneOn ? " on" : ""}" ${act("tgl-done")}
    title="${doneOn ? "завершённые показаны" : "завершённые скрыты"}">${dot("done")}Готово</button>`;
  const mkItems = [["все рынки", "mk-filter", undefined, "", !S.mk],
    ...COUNTRIES.map((c) => [`<span class="cc">${c.c}</span>${esc(c.n)}`, "mk-filter", undefined, c.c, S.mk === c.c])];
  const more = [[SHOW_TGL.byMarket, "tgl", "byMarket", undefined, S.byMarket],
    [SHOW_TGL.recurOnly, "tgl", "recurOnly", undefined, S.recurOnly],
    [SHOW_TGL.archOn, "tgl", "archOn", undefined, S.archOn]];
  const nMore = (S.byMarket ? 1 : 0) + (S.recurOnly ? 1 : 0) + (S.archOn ? 1 : 0);
  /* Оверсайт руководителя — ОДНА кнопка «Сотрудники», и только у админа: в ней и «все
     сотрудники» (был тумблер в «Ещё» — два места у одного факта), и выбор одного человека.
     До 22.09.2026 выбрать человека можно было ТОЛЬКО придя со стороны — щелчком по нему на
     другом экране; на самой панели такой двери не было, и чип с аватаром появлялся уже по
     факту. Просьба владельца 22.09.2026: «нужен функционал выбора сотрудника… это отдельная
     кнопка на панели, которая доступна только администратору».
     Чужие задачи показывает ровно эта кнопка — у неадмина её нет, и путей к чужому нет. */
  const staffItems = admin ? [
    ["моё и командное", "pick-staff", undefined, "off", !S.staff && !S.assignee],
    ["все сотрудники", "pick-staff", undefined, "all", S.staff && !S.assignee],
    ...S.users.filter((u) => u.id !== ME).map((u) =>
      [esc(u.n), "pick-staff", undefined, String(u.id), S.assignee === u.id])] : [];
  const staffLabel = S.assignee ? `Сотрудник: ${sname(S.assignee)}`
    : S.staff ? "Сотрудники: все" : "Сотрудники";
  /* редкое и пришедшее извне (клик по карте, по человеку) остаётся снимаемым чипом:
     фильтр, который сузил список молча, человек ищет глазами и не находит */
  const extra = [
    ...(S.noProject ? [["без проекта", "drop-no-project"]] : []),
  ];
  return `<div class="bar">
    <span class="seg${lensOff ? " off" : ""}"${lensOff ? ` title="Выбран сотрудник — показана вся его работа"` : ""}>${seg}</span>
    <span class="sep-v"></span>
    ${sts}
    ${admin ? `<span class="drop">${btn(staffLabel, "noop", undefined, undefined,
      "sm" + (S.staff || S.assignee ? " on" : ""))}${fmenu(staffItems)}</span>` : ""}
    <span class="drop">${btn(S.mk ? `Рынок: ${S.mk}` : "Рынок", "noop", undefined, undefined, "sm" + (S.mk ? " on" : ""))}${fmenu(mkItems)}</span>
    <span class="drop">${btn(S.period === "any" ? "Период" : `Период: ${periodName()}`, "noop", undefined, undefined, "sm" + (S.period === "any" ? "" : " on"))}
      <div class="dmenu">${Object.keys(PERIOD).map((k) =>
        `<button class="mi${S.period === k ? " on" : ""}" ${act("set-period", undefined, k)}>${PERIOD[k]}</button>`).join("")}
        <button class="mi${S.period === "range" ? " on" : ""}" ${act("set-period", undefined, "range")}>свой период…</button>
        ${S.period === "range" ? `<div class="mrange">
          <label>с<input type="date" data-inp="from" value="${esc(S.from)}"></label>
          <label>по<input type="date" data-inp="to" value="${esc(S.to)}"></label>
          <div class="quick">${[["7", "неделя"], ["14", "2 недели"], ["21", "21 день"], ["30", "месяц"], ["90", "квартал"]]
            .map(([d, n]) => `<button class="chip" ${act("range-days", undefined, d)}>${n}</button>`).join("")}</div>
        </div>` : ""}</div></span>
    ${admin ? btn("Календарный вид", "tgl-cal", undefined, undefined, "sm" + (S.calView ? " on" : "")) : ""}
    <span class="drop">${btn(nMore ? `Ещё · ${nMore}` : "Ещё", "noop", undefined, undefined, "sm" + (nMore ? " on" : ""))}${fmenu(more)}</span>
    ${fchips(extra)}
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
    ${cell(due(t.due, t.st === "done"))}
    ${cell(taskQuick(t), "qc opt")}
    ${cell(t.mk ? `<span class="cc">${t.mk}</span>` : `<span class="muted">—</span>`, "opt")}
    ${cell(esc(projPath(t.pr)))}
    ${cell(t.who.length ? avShort(t.who[0]) : `<span class="muted" title="исполнитель не назначен">—</span>`)}
    ${cell(lbls(t.labels) + (t.recur ? tag(RECUR_SHORT[t.recur], "p") : "") + ping, "opt")}</tr>`;
}

function groupRows(list) {
  const cols = 7;
  const sect = (n, k) => `<tr class="sect"><td colspan="${cols}">${esc(n)} · ${k}</td></tr>`;
  /* «Все сотрудники» — это не просто широкий срез, а СПИСОК ПО ЛЮДЯМ: руководитель
     смотрит не «все задачи компании», а «кто чем занят» (просьба владельца 22.09.2026:
     «если он выберет всех сотрудников, значит тогда включается разбивка по всем
     сотрудникам с возможностью их сворачивать»). Группы сворачиваются — иначе на
     четырнадцати людях экран превращается в простыню.
     Порядок — по числу задач, сверху заваленные: список читают ради перекоса нагрузки,
     а не ради алфавита. В заголовке рядом с числом стоит просроченное — оно и есть
     повод для разговора. Задача с двумя исполнителями попадает в обе группы: она и
     правда работа обоих, а «показать один раз» прячет её у второго. */
  if (S.staff && !S.assignee) {
    const by = new Map();
    list.forEach((t) => (t.who.length ? t.who : [0]).forEach((u) => {
      if (!by.has(u)) by.set(u, []);
      by.get(u).push(t); }));
    const order = [...by.keys()].sort((a, b) => {
      if (!a !== !b) return a ? -1 : 1;                 /* «не назначен» всегда последним */
      const d = by.get(b).length - by.get(a).length;
      return d || String(user(a) && user(a).n).localeCompare(String(user(b) && user(b).n)); });
    return order.map((u) => {
      const rows = by.get(u);
      const late = rows.filter((t) => t.st !== "done" && dueKind(t.due) === "now").length;
      const shut = S.collapsed.has(u);
      const head = `<tr class="sect grp${shut ? " shut" : ""}" ${act("tgl-staff-group", u)}>
        <td colspan="${cols}"><i class="cv"></i>${u ? avShort(u) : `<span class="muted">не назначен</span>`}
        <span class="n">${rows.length}</span>${late ? `<span class="late">просрочено ${late}</span>` : ""}</td></tr>`;
      return head + (shut ? "" : rows.map(taskRow).join("")); }).join("");
  }
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

/* ── календарный вид ─────────────────────────────────────────────
   «Дать возможность руководству быстро посмотреть, где кто как занят» (владелец,
   22.09.2026). День — колонка, внутри карточки с инициалами исполнителя: так видно и
   перекос по дням, и кто за что отвечает, и держится любое число людей — хоть два,
   хоть десять (решение владельца: колонки-дни, люди внутри).
   Задача попадает в день ПО СРОКУ — другой даты у неё нет. Значит вид показывает
   ПЛАН («к какому дню что должно быть сделано»), а не факт «чем занимался»; называем
   это подписью, иначе вид обещает не то. Владелец 22.09: «по сроку дедлайна, в системе
   все задачи должны быть с этим параметром» — поэтому задача без срока не исчезает, а
   стоит отдельной колонкой слева: это не мусор, это непоставленный срок, и он виден.
   Фильтры действуют как обычно — сетка берёт тот же visibleTasks(), что и список. */
function calendarView(list) {
  const days = calDays();
  const [from, to] = calRange();
  const cut = days.length && days[days.length - 1] < to;
  const nodue = list.filter((t) => !t.due);
  const card = (t) => `<div class="cc-t${t.st === "done" ? " done" : ""}" ${act("open-task", t.id)} tabindex="0"
    title="${esc(t.t)}${t.who.length ? ` · ${user(t.who[0]).n}` : ""}">
    ${t.who.length ? avOnly(t.who[0]) : `<span class="av none" title="не назначен">—</span>`}
    ${priMark(t.prio)}<span class="tt">${esc(clip(t.t, 38))}</span></div>`;
  /* карточки одного человека идут подряд: глаз ищет по кружку, а не по алфавиту задач */
  const byPerson = (a, b) => (a.who[0] || 0) - (b.who[0] || 0);
  const col = (d) => {
    const items = list.filter((t) => t.due === d).sort(byPerson);
    return `<div class="cc-d${d === TODAY ? " now" : ""}${isWeekend(d) ? " off" : ""}">
      <div class="cc-h"><b>${dow(d)} ${+d.slice(8)}</b>${items.length ? `<span class="n">${items.length}</span>` : ""}</div>
      <div class="cc-b">${items.map(card).join("")}</div></div>`;
  };
  /* Задача со сроком вне показанных дней в сетку не попадает — и это обязано быть
     сказано числом: иначе руководитель видит полупустую неделю и читает её как «людям
     нечего делать», а на деле работа просто стоит за краем окна. */
  const last = days[days.length - 1] || to;
  const out = list.filter((t) => t.due && (t.due < days[0] || t.due > last)).length;
  const note = [
    S.period === "any" ? "период не выбран — показана текущая неделя" : "",
    cut ? `показаны первые ${CAL_MAX_DAYS} дней периода` : "",
    out ? `вне показанных дней ещё ${out}` : "",
  ].filter(Boolean).join(" · ");
  return `<div class="calhead">Загрузка по срокам · ${fmtDate(from)} — ${fmtDate(days[days.length - 1] || to)}
    <span class="muted">${days.length} ${plural(days.length, "день", "дня", "дней")}</span>
    ${note ? `<span class="note">${esc(note)}</span>` : ""}</div>
    <div class="calgrid">
      ${nodue.length ? `<div class="cc-d nodue"><div class="cc-h"><b>без срока</b><span class="n">${nodue.length}</span></div>
        <div class="cc-b">${nodue.sort(byPerson).map(card).join("")}</div></div>` : ""}
      ${days.map(col).join("")}</div>`;
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
  if (S.calView) return head + calendarView(list);
  /* Порядок колонок — по тому, чем в строке ПОЛЬЗУЮТСЯ (просьба владельца 22.09.2026):
     «пиктограммы надо перенести вместе со сроком левее, ближе к названию, потом уже
     рынок, а потом уже проект, исполнитель, списки». Быстрые действия и срок — то, что
     меняют каждый день, и тянуться за ними через весь экран незачем; проект, исполнитель
     и списки читают глазами, им место справа. */
  return head + table([
    { t: "Задача" }, { t: "Срок", w: "84px" }, { t: "", w: "180px", opt: true },
    { t: "Рынок", w: "72px", opt: true }, { t: "Проект", w: "20%" },
    { t: "Исполнитель", short: "Кто", w: "15%" }, { t: "Списки", w: "17%", opt: true },
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

/* ── форма задачи ────────────────────────────────────────────────
   Одна и та же форма открывается на создание и на оформление задачи, предложенной по
   встрече: два разных окна с одними полями расходились бы по мелочам. */
function taskFormBody(preset) {
  const v = preset || {};
  return `
    ${fld("Что сделать", input("title", v.title, "Коротко и по делу"))}
    ${fld("Описание", area("note", "", "Контекст, ссылки, детали"))}
    <div class="two">
      ${fld("Проект", select("pr", S.projects.map((p) => [p.id, (p.parent ? "— " : "") + p.n]), "p1"))}
      ${fld("Исполнитель", select("who", [["", "— не назначен"], ...S.users.map((u) => [String(u.id), u.n])], String(v.who || ME)))}
    </div>
    <div class="two">
      ${fld("Срок", dateInput("due", v.due || ""))}
      ${fld("Приоритет", select("prio", [["", "не задан"], ["high", "высокий"], ["med", "средний"], ["low", "низкий"]], ""))}
    </div>
    ${fld("Списки (личные)", pick("labels", S.labels.map((l) => [l.id, l.n]), []))}
    ${fld("Ссылки", area("urls", (v.urls || []).join("\n"), "по одной в строке: https://…"))}
    ${fld("Рынок", pick("mk", COUNTRIES.map((c) => [c.c, c.n]), [], true))}
    <div class="two">
      ${fld("Повтор", select("recur", [["", "без повтора"], ["weekly", "каждую неделю"], ["monthly", "каждый месяц"]], ""))}
      ${fld("Напомнить (пинг)", dateInput("ping", ""))}
    </div>
    ${fld("Приватность", sw("priv", false, "Личная задача — видна только мне"))}`;
}

function newTaskModal(preset) {
  modal("Новая задача", taskFormBody(preset),
    `${btn("Отмена", "mclose")}${btn("Создать задачу", "create-task", undefined, undefined, "pri")}`);
}

/* Предложенная по встрече задача оформляется в той же форме — «ещё один экран» поверх
   списка: правится текст, добавляются ссылки, и только потом она становится задачей. */
function genTaskModal(i) {
  const g = S.gen.find((x) => x.i === i);
  if (!g) return;
  if (g.made) return A.toast(`Эта задача уже создана — ${g.made}`);
  modal("Задача из встречи", taskFormBody({ title: g.t, who: g.who, due: g.due }),
    `${btn("Отмена", "mclose")}${btn("Создать задачу", "gen-save", String(i), undefined, "pri")}`);
}
