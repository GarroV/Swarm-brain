/* Экран задач: ось времени (вкладки) × линза × статусы × поиск × группировки. */

const LENSES = [["mine", "Мои"], ["team", "Командные"], ["all", "Все"]];
const STATUSES = [["open", "Открыто"], ["in_progress", "В работе"], ["done", "Готово"]];

function tasksToolbar() {
  const admin = me().role === "admin";
  const stDefault = S.statuses.size === 2 && S.statuses.has("open") && S.statuses.has("in_progress");
  const n = (stDefault ? 0 : 1) + (S.mk ? 1 : 0) + (S.byMarket ? 1 : 0) + (S.staff ? 1 : 0) + (S.assignee ? 1 : 0);
  const groups = [
    ["Статус", STATUSES.map(([id, nm]) => [`${dot(id)}${nm}`, "status", id, undefined, S.statuses.has(id)])],
    ["Рынок", [["все рынки", "mk-filter", undefined, "", !S.mk],
      ...COUNTRIES.map((c) => [`<span class="cc">${c.c}</span>${esc(c.n)}`, "mk-filter", undefined, c.c, S.mk === c.c])]],
    ["Показ", [["группировать по рынкам", "tgl", "byMarket", undefined, S.byMarket],
      ...(admin ? [["все сотрудники", "tgl", "staff", undefined, S.staff]] : [])]],
  ];
  const active = [
    ...(stDefault ? [] : [[`статус: ${STATUSES.filter(([id]) => S.statuses.has(id)).map(([, nm]) => nm).join(", ") || "ни одного"}`, "reset-statuses"]]),
    ...(S.mk ? [[`рынок: ${S.mk}`, "mk-filter", undefined, ""]] : []),
    ...(S.byMarket ? [["по рынкам", "tgl", "byMarket"]] : []),
    ...(S.staff ? [["все сотрудники", "tgl", "staff"]] : []),
  ];
  return `<div class="bar">
    ${LENSES.map(([id, nm]) => chip(nm, S.lens === id, "lens", id)).join("")}
    <span class="sep-v"></span>
    ${fdrop(n, groups)}
    ${fchips(active)}
    ${S.assignee ? `<button class="chip on" ${act("drop-assignee")}>${av(S.assignee)}<span class="x">×</span></button>` : ""}
    <div class="right">
      <input class="qin" placeholder="Фильтр по названию" value="${esc(S.q)}" data-qin="tasks">
      <span>Показано <b>${visibleTasks().length}</b> из ${S.tasks.filter((t) => inList(t, S.tab)).length}</span>
      ${btn("＋ Задача", "new-task", undefined, undefined, "pri sm")}
    </div></div>`;
}

function bulkBar() {
  if (!S.bulk.size) return "";
  const users = S.users.slice(0, 6).map((u) => `<button class="mi" ${act("bulk-assign", u.id)}>${av(u.id)}</button>`).join("");
  return `<div class="bulk">Выбрано: ${S.bulk.size}
    <span class="ib">
      <span class="drop">${btn("Назначить", "noop", undefined, undefined, "sm")}<div class="dmenu">${users}</div></span>
      ${btn("Срок: сегодня", "bulk-due", undefined, TODAY, "sm")}
      ${btn("В работу", "bulk-status", undefined, "in_progress", "sm")}
      ${btn("Метка «процесс»", "bulk-label", undefined, "l2", "sm")}
      ${btn("В архив", "bulk-archive", undefined, undefined, "sm")}
    </span>
    <button class="x" ${act("bulk-clear")}>✕</button></div>`;
}

function taskRow(t) {
  const checked = S.bulk.has(t.id) ? " checked" : "";
  return `<tr class="row${S.sel === t.id && S.selKind === "task" ? " sel" : ""}" ${act("open-task", t.id)} tabindex="0">
    ${cell(`<input type="checkbox"${checked} ${act("check", t.id)}>`, "ck")}
    ${cell(`${dot(t.st)}${priMark(t.prio)}${esc(t.t)}${t.priv ? ' <span class="lock" title="личная">🔒</span>' : ""}`, "t")}
    ${cell(esc(projPath(t.pr)))}
    ${cell(t.who.length ? avShort(t.who[0]) : `<span class="muted" title="исполнитель не назначен">—</span>`)}
    ${cell(lbls(t.labels) + (t.recur ? tag(RECUR_LABEL[t.recur], "p") : ""), "opt")}
    ${cell(t.mk ? `<span class="cc">${t.mk}</span>` : `<span class="muted">—</span>`, "r opt")}
    ${cell(due(t.due, t.st === "done"), "r")}</tr>`;
}

function groupRows(list) {
  const cols = 7;
  const sect = (n, k) => `<tr class="sect"><td colspan="${cols}">${esc(n)} · ${k}</td></tr>`;
  if (S.byMarket) {
    const by = {};
    list.forEach((t) => { const k = t.mk || "Без рынка"; (by[k] = by[k] || []).push(t); });
    return Object.keys(by).sort().map((k) => sect(k === "Без рынка" ? k : cname(k), by[k].length) + by[k].map(taskRow).join("")).join("");
  }
  if (S.tab === "today" || S.tab === "upcoming") {
    /* завершённая задача не «просрочена» и не «на сегодня»: срок у неё уже ничего не требует */
    const done = list.filter((t) => t.st === "done");
    const live = list.filter((t) => t.st !== "done");
    const over = live.filter((t) => dueKind(t.due) === "now");
    const today = live.filter((t) => dueKind(t.due) === "today");
    const rest = live.filter((t) => !over.includes(t) && !today.includes(t));
    return (over.length ? sect("Просрочено", over.length) + over.map(taskRow).join("") : "")
      + (today.length ? sect("Сегодня", today.length) + today.map(taskRow).join("") : "")
      + (rest.length ? sect("Дальше", rest.length) + rest.map(taskRow).join("") : "")
      + (done.length ? sect("Сделано", done.length) + done.map(taskRow).join("") : "");
  }
  return list.map(taskRow).join("");
}

function screenTasks() {
  const list = visibleTasks();
  const head = tasksToolbar() + bulkBar() + (S.tab === "today" ? calendarStrip() : "");
  if (!list.length) {
    /* пустой экран без объяснения читается как «данных нет»: называем, сколько скрыто фильтрами */
    const hidden = S.tasks.filter((t) => inList(t, S.tab)).length;
    return head + empty("Задач в этом срезе нет", hidden
      ? `Линза и фильтры скрывают ещё ${hidden}`
      : "На этой вкладке пока ничего нет")
      + (hidden ? `<div class="emptyact">${btn("Показать все", "reset-filters", undefined, undefined, "pri")}</div>` : "");
  }
  return head + table([
    { t: "", w: "30px" }, { t: "Задача" }, { t: "Проект", w: "20%" }, { t: "Исполнитель", short: "Кто", w: "15%" },
    { t: "Метки", w: "15%", opt: true }, { t: "Рынок", r: true, w: "78px", opt: true }, { t: "Срок", r: true, w: "84px" },
  ], groupRows(list)) + whatsNext(list);
}

/* Короткий список оставлял пол-экрана белым: человек видит три строки и не знает,
   это всё или он сам себе сузил фильтр. Экран отвечает тем, что будет дальше. */
function whatsNext(list) {
  if (S.tab === "archive" || list.length > 6) return "";
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
      ${fld("Приоритет", select("prio", [["high", "высокий"], ["med", "средний"], ["low", "низкий"]], "med"))}
    </div>
    ${fld("Метки", pick("labels", S.labels.map((l) => [l.id, l.n]), []))}
    ${fld("Рынок", pick("mk", COUNTRIES.map((c) => [c.c, c.n]), [], true))}
    <div class="two">
      ${fld("Повтор", select("recur", [["", "без повтора"], ["weekly", "каждую неделю"], ["monthly", "каждый месяц"]], ""))}
      ${fld("Напоминание", input("remind", "", "за день до срока"))}
    </div>
    ${fld("Приватность", sw("priv", false, "Личная задача — видна только мне"))}`,
    `${btn("Отмена", "mclose")}${btn("Создать задачу", "create-task", undefined, undefined, "pri")}`);
}
