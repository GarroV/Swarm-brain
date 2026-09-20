/* Проекты и спринты: дерево проектов, доска с перетаскиванием, инициативы, чек, аналитика, журнал. */

function screenProjects() {
  if (S.tab === "map") return projectsMap();
  const all = S.projects.filter((p) => !p.parent);
  const roots = S.showClosed ? all : all.filter((p) => p.st !== "paused");
  return `<div class="bar">${wsChip()}${chip("Показывать на паузе", S.showClosed, "tgl", "showClosed")}
    <div class="right"><span>Показано <b>${roots.length}</b> из ${all.length}</span><span>Подпроектов <b>${S.projects.length - all.length}</b></span>
      ${btn("＋ Проект", "new-project", undefined, undefined, "pri sm")}</div></div>`
    + (roots.length ? table([{ t: "Проект", w: "28%" }, { t: "Владелец", w: "18%" }, { t: "Подпроекты", w: "26%" }, { t: "Срок", w: "12%" }, { t: "Открыто", short: "Откр.", r: true, w: "84px" }, { t: "Всего", r: true, w: "74px" }],
      roots.map((p) => {
        const subs = S.projects.filter((x) => x.parent === p.id);
        /* архивные не в счёт — иначе «Всего» здесь и число ветки на карте расходятся
           на один и тот же проект, и человек идёт искать задачи, которых нет */
        const tasks = S.tasks.filter((t) => (t.pr === p.id || subs.some((s) => s.id === t.pr)) && !t.arch);
        const open = tasks.filter((t) => t.st !== "done" && !t.arch).length;
        return `<tr class="row${S.sel === p.id && S.selKind === "project" ? " sel" : ""}" ${act("open-proj", p.id)} tabindex="0">
          ${cell(dot(p.st === "paused" ? "open" : "in_progress") + esc(p.n), "t")}
          ${cell(avShort(p.own))}${cell(subs.length ? subs.map((s) => esc(s.n)).join(" · ") : `<span class="muted">—</span>`)}
          ${cell(due(p.due))}${cell(`<span class="due">${open}</span>`, "r")}${cell(`<span class="due">${tasks.length}</span>`, "r")}</tr>`;
      }).join(""))
      : empty(all.length ? "Все проекты на паузе" : "В этом воркспейсе ещё нет проектов",
              all.length ? "Включите «показывать на паузе»" : "Проект появится вместе с первой задачей"));
}

function projectsMap() {
  const roots = S.projects.filter((p) => !p.parent);
  if (!roots.length) return `<div class="bar">${wsChip()}</div>` + empty("Карта пуста", "Здесь будет дерево проектов и подпроектов воркспейса");
  const cnt = (id) => S.tasks.filter((t) => t.pr === id && !t.arch).length;
  /* у узла с детьми число — ВСЯ ветка: иначе корень «41» не сходится с суммой узлов,
     и человек считает, что часть задач потерялась. Своё число — в подсказке. */
  const branch = (id) => cnt(id) + S.projects.filter((x) => x.parent === id).reduce((n, x) => n + cnt(x.id), 0);
  const ws = S.workspaces.find((w) => w.active) || S.workspaces[0];
  return `<div class="bar">${wsChip()}
    <div class="right"><span>Щёлкните узел — откроется карточка проекта</span></div></div>
    <div class="tree"><div class="tnode root">${esc(ws.name)}<span class="n">${S.tasks.filter((t) => !t.arch).length}</span></div>
    <div class="tkids">${roots.map((p) => {
      const subs = S.projects.filter((x) => x.parent === p.id);
      return `<div class="tbr">
        <div class="tnode${S.sel === p.id ? " on" : ""}" ${act("open-proj", p.id)} tabindex="0"${
          subs.length ? ` title="своих задач: ${cnt(p.id)}, во всей ветке: ${branch(p.id)}"` : ""}>${
          dot(p.st === "paused" ? "open" : "in_progress")}${esc(p.n)}
          <span class="n">${branch(p.id)}</span></div>
        ${subs.length ? `<div class="tsub">${subs.map((s) =>
          `<div class="tnode sub" ${act("open-proj", s.id)} tabindex="0">${esc(s.n)}<span class="n">${cnt(s.id)}</span></div>`).join("")}</div>` : ""}
      </div>`;
    }).join("")}</div></div>`;
}

/* ── спринты ─────────────────────────────────────────────────── */
const cycle = () => S.cycles.find((c) => c.id === S.cycle);
function cycleBar(extra) {
  return `<div class="bar"><span class="drop">${btn(`Цикл: ${cycle().n}`, "noop", undefined, undefined, "sm")}
    <div class="dmenu">${S.cycles.map((c) => `<button class="mi${c.id === S.cycle ? " on" : ""}" ${act("set-cycle", c.id)}>${c.n} · ${CYCLE_ST[c.st]}</button>`).join("")}</div></span>
    <span class="due">${fmtDate(cycle().from)} — ${fmtDate(cycle().to)}</span>
    ${cycle().st !== "active" ? state(CYCLE_ST[cycle().st], false) : ""}
    <div class="right">${extra || ""}</div></div>`;
}
function screenSprints() {
  if (S.tab === "timeline") return screenTimeline();
  if (S.tab === "pool") return screenPool();
  if (S.tab === "check") return screenCheck();
  if (S.tab === "analytics") return screenAnalytics();
  if (S.tab === "journal") return screenJournal();
  const cols = S.cols.filter((c) => c.on);
  const inCycle = S.tasks.filter((t) => t.sprint === S.cycle && !t.arch);
  if (!S.tasks.length) return cycleBar() + empty("В этом воркспейсе нет задач", "Доска наполнится, когда задачи попадут в цикл");
  return cycleBar(`<span>Задач в цикле <b>${inCycle.length}</b></span><span>Перетащите карточку, чтобы сменить статус</span>`)
    + `<div class="board">${cols.map((c) => {
      const items = inCycle.filter((t) => t.st === c.id);
      return `<div class="col"><h3>${dot(c.id)}${c.n}<span class="n">${items.length}</span></h3>
        <div class="cards" data-drop="${c.id}">${items.map((t) => `<div class="card" draggable="true" data-card="${t.id}" ${act("open-task", t.id)} tabindex="0">
          ${priMark(t.prio)}${esc(t.t)}<div class="m">${t.who.length ? av(t.who[0]) : `<span class="muted">не назначен</span>`}
          <span style="margin-left:auto">${due(t.due, t.st === "done")}</span></div></div>`).join("")
          || `<div class="drop-empty">перетащите сюда</div>`}
          <input class="qadd" placeholder="+ задача в «${esc(c.n)}»" data-qadd="${c.id}"></div></div>`;
    }).join("")}</div>`;
}

const IST = { proposed: "предложена", accepted: "принята", in_progress: "в работе", done: "закрыта" };
function screenPool() {
  if (!S.initiatives.length) return cycleBar() + empty("Инициатив пока нет", "Сюда попадают предложения, которые ещё не взяли в цикл");
  return cycleBar(`<span>Предложено <b>${S.initiatives.filter((i) => i.st === "proposed").length}</b></span>`)
    + table([{ t: "Инициатива", w: "28%" }, { t: "Проект", w: "18%" }, { t: "Владелец", w: "17%" }, { t: "Задачи", w: "12%" }, { t: "Баллы", r: true, w: "80px" }, { t: "Статус" }, { t: "Решение", r: true, w: "220px" }],
      /* статус инициативы уже написан словом в колонке «Решение», второй раз точкой не повторяем */
      S.initiatives.map((i) => `<tr class="row">
        ${cell(esc(i.t), "t")}
        ${cell(esc(projPath(i.pr)))}${cell(av(i.own))}
        ${cell(i.tasks.map((id) => `<span class="lnk" ${act("open-task", id)}>${id}</span>`).join(" · "))}
        ${cell(`<span class="due">${i.pts}</span>`, "r")}
        ${/* зелёный — про «дошло до конца», а не про любое непустое состояние */ ""}
        ${cell(state(IST[i.st], i.st === "accepted" || i.st === "done"))}
        ${cell(i.st === "proposed"
          ? `<span class="ib">${btn("Принять в цикл", "accept-init", i.id, undefined, "sm pri")}${btn("Снять", "drop-init", i.id, undefined, "sm")}</span>`
          : `<span class="muted">—</span>`, "r acts")}</tr>`).join(""));
}

function screenCheck() {
  const inCycle = S.tasks.filter((t) => t.sprint === S.cycle);
  if (!inCycle.length) return cycleBar() + empty("В этом цикле нечего сверять", "Возьмите задачи в цикл — здесь появится прогресс по проектам");
  const done = inCycle.filter((t) => t.st === "done").length;
  const byProj = {};
  inCycle.forEach((t) => { const k = proj(t.pr) ? (proj(t.pr).parent || t.pr) : "—"; (byProj[k] = byProj[k] || []).push(t); });
  return cycleBar() + `<div class="panes"><div class="pane"><h3>Чек цикла «${esc(cycle().n)}»</h3>
    <div class="sub">Что обещали и где стоим · ${done} из ${inCycle.length} закрыто</div>
    <div class="prog"><i style="width:${Math.round(done / Math.max(inCycle.length, 1) * 100)}%"></i></div>
    ${rows(Object.keys(byProj).map((k) => {
      const list = byProj[k], d = list.filter((t) => t.st === "done").length;
      /* закрытая задача не «просрочена»: иначе строка «1 из 1 закрыто · 1 просрочено» противоречит сама себе */
      const late = list.filter((t) => t.st !== "done" && dueKind(t.due) === "now").length;
      return [esc(proj(k) ? proj(k).n : k), `${d} из ${list.length} закрыто`, late ? alert_(`${late} просрочено`) : state("в графике", true)];
    }))}
    <div class="mt">${btn("Закрыть цикл", "close-cycle", undefined, undefined, "pri")}${btn("Перенести хвосты в следующий", "carry-over")}</div></div></div>`;
}

function screenAnalytics() {
  const inCycle = S.tasks.filter((t) => t.sprint === S.cycle);
  if (!inCycle.length) return cycleBar() + empty("Считать пока нечего", "Аналитика собирается по задачам цикла");
  const load = S.users.map((u) => [u, inCycle.filter((t) => t.who.includes(u.id)).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...load.map(([, n]) => n), 1);
  const done = inCycle.filter((t) => t.st === "done").length;
  const late = inCycle.filter((t) => dueKind(t.due) === "now").length;
  /* скорость без предыдущего цикла — просто число: сравнивать не с чем */
  const prevId = (S.cycles[S.cycles.findIndex((c) => c.id === S.cycle) + 1] || {}).id;
  const prevDone = prevId ? S.tasks.filter((t) => t.sprint === prevId && t.st === "done").length : null;
  return cycleBar() + `<div class="panes"><div class="pane"><h3>Аналитика цикла</h3><div class="sub">Скорость и распределение нагрузки</div>
    ${rows([
      ["Закрыто за цикл", nTasks(done) + (prevDone === null ? "" : ` <span class="muted">· в прошлом цикле ${prevDone}</span>`)],
      ["В работе", nTasks(inCycle.filter((t) => t.st === "in_progress").length)],
      ["Просрочено", late ? alert_(nTasks(late)) : nTasks(0)],
      ["Без исполнителя", nTasks(inCycle.filter((t) => !t.who.length).length)],
    ])}
    ${lab("Нагрузка по людям")}
    <div class="bars">${load.map(([u, n]) => `<div class="brow" ${act("person-tasks", u.id)}><span class="k">${av(u.id)}</span>
      <span class="bar-l"><i style="width:${Math.round(n / max * 100)}%"></i></span><span class="v">${n}</span></div>`).join("")}</div></div></div>`;
}

function screenJournal() {
  /* журнал живёт на вкладке цикла — значит и показывает события задач этого цикла */
  const ids = new Set(S.tasks.filter((t) => t.sprint === S.cycle).map((t) => t.id));
  const items = [];
  Object.keys(S.history).forEach((id) => { if (!ids.has(+id)) return;
    (S.history[id] || []).forEach((h) => items.push({ ...h, id: +id })); });
  items.sort((a, b) => a.m - b.m);
  if (!items.length) return cycleBar() + empty("В этом цикле задачи не двигали",
    "Записи появляются, когда задачу берут в работу, двигают по доске или меняют ей срок");
  return cycleBar() + `<div class="panes"><div class="pane"><h3>Журнал перемещений</h3>
    <div class="sub">Кто и когда двигал задачи цикла — журнал ведётся с раскатки #286</div>
    <div class="tl log">${items.map((h) => `<div class="e" data-m="${h.m}"><div class="w">${esc(ago(h.m))}</div>
      <div class="p"></div><div><b>${esc(user(h.who).n)}</b>
      <span class="ev">${esc(h.k)}${h.v ? `: <b>${esc(h.v)}</b>` : ""}</span>
      · ${logLink(h.id)}</div></div>`).join("")}</div></div></div>`;
}

/* Строка журнала обязана называть задачу словами: «задача 131» не говорит, что двигали,
   а после удаления задачи ссылка вела в пустоту — открывался белый лист детали. */
function logLink(id) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return `<span class="muted" title="задача ${id} удалена">задача удалена</span>`;
  return `<span class="lnk" ${act("open-task", id)} title="${esc(t.t)}">${esc(clip(t.t, 46))}</span>`;
}

/* перетаскивание карточек */
document.addEventListener("dragstart", (e) => {
  const c = e.target.closest("[data-card]"); if (!c) return;
  S.board.drag = +c.dataset.card; c.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.dataset.card);
});
document.addEventListener("dragend", () => { S.board.drag = null; $$(".dragging,.over").forEach((el) => el.classList.remove("dragging", "over")); });
document.addEventListener("dragover", (e) => {
  const z = e.target.closest("[data-drop]"); if (!z || S.board.drag === null) return;
  e.preventDefault(); $$(".over").forEach((el) => el.classList.remove("over")); z.classList.add("over");
});
document.addEventListener("drop", (e) => {
  const z = e.target.closest("[data-drop]"); if (!z || S.board.drag === null) return;
  e.preventDefault(); const id = S.board.drag; S.board.drag = null; A.moveTask(id, z.dataset.drop);
});
