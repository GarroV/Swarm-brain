/* Экран задач: ось времени (вкладки) × линза × статусы × поиск × группировки. */

const LENSES = [["mine", "Мои"], ["team", "Командные"], ["all", "Все"]];
const STATUSES = [["open", "Открыто"], ["in_progress", "В работе"], ["done", "Готово"]];

function tasksToolbar() {
  const admin = me().role === "admin";
  return `<div class="bar">
    ${LENSES.map(([id, n]) => chip(n, S.lens === id, "lens", id)).join("")}
    <span class="sep-v"></span>
    ${STATUSES.map(([id, n]) => `<button class="chip${S.statuses.has(id) ? " on" : ""}" ${act("status", id)}>${dot(id)}${n}</button>`).join("")}
    <span class="sep-v"></span>
    <span class="drop">${btn(`Рынок: ${S.mk ? S.mk : "все"}`, "noop", undefined, undefined, "sm")}
      <div class="dmenu"><button class="mi" ${act("mk-filter", undefined, "")}>все</button>
      ${COUNTRIES.map((c) => `<button class="mi${S.mk === c.c ? " on" : ""}" ${act("mk-filter", undefined, c.c)}>${c.c} · ${c.n}</button>`).join("")}</div></span>
    ${chip("По рынкам", S.byMarket, "tgl", "byMarket")}
    ${admin ? chip("Все сотрудники", S.staff, "tgl", "staff") : ""}
    ${S.assignee ? `<button class="chip on" ${act("drop-assignee")}>${av(S.assignee)}<span class="x">×</span></button>` : ""}
    <div class="right">
      <input class="qin" placeholder="Фильтр по названию" value="${esc(S.q)}" data-qin="tasks">
      <span>Показано <b>${visibleTasks().length}</b></span>
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
    ${cell(`${dot(t.st)}${pri(t.prio)}${esc(t.t)}${t.priv ? ' <span class="lock" title="личная">🔒</span>' : ""}`, "t")}
    ${cell(esc(projPath(t.pr)))}
    ${cell(t.who.length ? avShort(t.who[0]) : `<span class="muted">— не назначен</span>`)}
    ${cell(lbls(t.labels) + (t.recur ? tag(RECUR_LABEL[t.recur], "p") : ""))}
    ${cell(t.mk ? `<span class="cc">${t.mk}</span>` : "", "r")}
    ${cell(due(t.due), "r")}</tr>`;
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
    const over = list.filter((t) => dueKind(t.due) === "now");
    const today = list.filter((t) => dueKind(t.due) === "today");
    const rest = list.filter((t) => !over.includes(t) && !today.includes(t));
    return (over.length ? sect("Просрочено", over.length) + over.map(taskRow).join("") : "")
      + (today.length ? sect("Сегодня", today.length) + today.map(taskRow).join("") : "")
      + (rest.length ? sect("Дальше", rest.length) + rest.map(taskRow).join("") : "");
  }
  return list.map(taskRow).join("");
}

function screenTasks() {
  const list = visibleTasks();
  const head = tasksToolbar() + bulkBar() + (S.tab === "today" ? calendarStrip() : "");
  if (!list.length) return head + empty("Задач в этом срезе нет", "Смените линзу, статусы или вкладку");
  return head + table([
    { t: "", w: "30px" }, { t: "Задача", w: "34%" }, { t: "Проект", w: "16%" }, { t: "Исполнитель", w: "15%" },
    { t: "Метки", w: "15%" }, { t: "Рынок", r: true, w: "62px" }, { t: "Срок", r: true, w: "84px" },
  ], groupRows(list));
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
      ${fld("Срок", input("due", "", "2026-09-30"))}
      ${fld("Приоритет", select("prio", [["high", "высокий"], ["med", "средний"], ["low", "низкий"]], "med"))}
    </div>
    ${fld("Метки", pick("labels", S.labels.map((l) => [l.id, l.n]), []))}
    ${fld("Рынок", pick("mk", COUNTRIES.map((c) => [c.c, c.n]), []))}
    <div class="two">
      ${fld("Повтор", select("recur", [["", "без повтора"], ["weekly", "каждую неделю"], ["monthly", "каждый месяц"]], ""))}
      ${fld("Напоминание", input("remind", "", "за день до срока"))}
    </div>
    ${fld("Приватность", sw("priv", false, "Личная задача — видна только мне"))}`,
    `${btn("Отмена", "mclose")}${btn("Создать задачу", "create-task", undefined, undefined, "pri")}`);
}
