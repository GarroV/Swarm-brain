/* Проекты и спринты: дерево проектов, доска с перетаскиванием, инициативы, чек, аналитика, журнал. */

/* Экран «Проекты» — доска продукта (miniapp/src/components/tasks/SprintBoard.tsx):
   вкладки досок сверху, проекты секциями, внутри колонки Бэклог · Открыто · В работе ·
   Готово, подпроекты со своими колонками, перетаскивание и быстрое добавление задачи.
   До 21.09 здесь была сетка карточек — это МОБИЛЬНЫЙ экран продукта (RoyProjectsScreen),
   а не рабочий: владелец просил вернуть то, что есть в проде, вместе с вкладками. */
const BCOLS = [["backlog", "Бэклог"], ["open", "Открыто"], ["in_progress", "В работе"], ["done", "Готово"]];

function boardBar() {
  const all = S.boardTab === "all";
  const tab = (b) => `<button class="sg${S.boardTab === b.id ? " on" : ""}" ${act("set-board", b.id)}>${esc(b.n)}${b.act ? " ·" : ""}</button>`;
  const cur = S.boards.find((b) => b.id === S.boardTab);
  /* Вкладками управляют из меню на самой вкладке: «Удалить вкладку» отдельной кнопкой
     висела в полосе всегда и была единственным, что с вкладкой можно было сделать. */
  const tabMenu = all ? "" : `<span class="drop">${btn("⋯", "noop", undefined, undefined, "sm")}${fmenu([
    [`Переименовать «${esc(cur ? cur.n : "")}»`, "rename-board", S.boardTab],
    ["Удалить вкладку", "del-board", S.boardTab]])}</span>`;
  return `<div class="bar">${wsChip()}
    <span class="seg">${`<button class="sg${all ? " on" : ""}" ${act("set-board", "all")}>Все вкладки</button>`}${S.boards.map(tab).join("")}</span>
    ${btn("＋ Вкладка", "new-board", undefined, undefined, "sm")}
    ${tabMenu}
    ${chip("Показывать на паузе", S.showClosed, "tgl", "showClosed")}
    <div class="right">${btn("＋ Проект", "new-project", undefined, undefined, "pri sm")}</div></div>`;
}

function screenProjects() {
  if (S.tab === "map") return projectsMap();
  const onBoard = S.projects.filter((p) => !p.parent && (S.boardTab === "all" || p.b === S.boardTab));
  const roots = S.showClosed ? onBoard : onBoard.filter((p) => p.st !== "paused");
  if (!roots.length) return boardBar() + empty(onBoard.length ? "Все проекты этой вкладки на паузе" : "На этой вкладке проектов нет",
    onBoard.length ? "Включите «показывать на паузе»" : "Создайте проект — задачи разложатся по его колонкам");
  return boardBar() + `<div class="pgrid">${roots.map((p) => S.openProj.has(p.id) ? projectSection(p) : projectCard(p)).join("")}</div>`;
}

/* Свёрнутый проект — карточка: точка состояния, название, числа задач, подпроекты,
   владелец и срок. Раскрывается стрелкой, карточка целиком открывает панель проекта. */
function projectCard(p) {
  const subs = S.projects.filter((x) => x.parent === p.id);
  const tasks = projectTasks(p.id);
  const open = tasks.filter((t) => t.st !== "done").length;
  /* Раскрывается вся плитка, а не только стрелка: целиться в значок 14×14 ради того,
     что и так главное действие карточки, — работа, которой можно не быть (просьба
     владельца 21.09). Название по-прежнему открывает панель со списком задач. */
  return `<div class="pcard${S.sel === p.id && S.selKind === "project" ? " sel" : ""}" ${act("toggle-open", p.id)} tabindex="0">
    <span class="h">${dot(p.st === "paused" ? "open" : "in_progress")}<b class="nm" ${act("open-proj", p.id)} tabindex="0">${esc(p.n)}</b>
      ${p.priv ? state("только я", false) : ""}${p.st === "paused" ? state("пауза", false) : ""}
      <button class="ex" ${act("toggle-open", p.id)} title="Развернуть проект в колонки" aria-label="Развернуть проект в колонки">▾</button></span>
    <span class="m">задач: <b class="all">${tasks.length}</b> · открыто: <b class="open">${open}</b></span>
    <span class="s">${subs.length ? esc(subs.map((x) => x.n).join(" · ")) : `<span class="muted">без подпроектов</span>`}</span>
    <span class="f">${avShort(p.own)}${due(p.due)}</span></div>`;
}

/* Колонка доски: карточки задач секции, перетаскивание и строка быстрого добавления.
   data-sec несёт проект — бросок в чужую секцию меняет задаче и статус, и проект,
   как в продукте (applyDrop). */
function boardCol(sec, id, n, tasks) {
  const items = tasks.filter((t) => id === "backlog" ? !ST_LABEL[t.st] : t.st === id);
  return `<div class="col"><h3>${dot(id === "backlog" ? "open" : id)}${n}<span class="n">${items.length}</span></h3>
    <div class="cards" data-drop="${id}" data-sec="${sec}">${items.map((t) => `<div class="card" draggable="true" data-card="${t.id}" ${act("open-task", t.id)} tabindex="0">
      ${priMark(t.prio)}${esc(t.t)}<div class="m">${t.who.length ? av(t.who[0]) : `<span class="muted">не назначен</span>`}
      <span style="margin-left:auto">${due(t.due, t.st === "done")}</span></div></div>`).join("")
      || `<div class="drop-empty">перетащите сюда</div>`}
      <input class="qadd" placeholder="+ задача в «${esc(n)}»" data-qadd="${id}" data-qsec="${sec}"></div></div>`;
}

function projectSection(p) {
  const subs = S.projects.filter((x) => x.parent === p.id);
  const own = S.tasks.filter((t) => !t.arch && t.pr === p.id);
  const all = projectTasks(p.id);
  /* Правило продукта: колонки показываем у СВОИХ задач проекта. Если своих нет и вся
     работа лежит в подпроектах, четыре пустые колонки с «перетащите сюда» занимают
     экран и врут, будто в проекте ничего нет, — тогда слева остаётся один «Бэклог»
     ветки, а место отдаётся подпроектам. */
  const branchBacklog = all.filter((t) => !ST_LABEL[t.st]);
  /* У проекта бэклог общий — это склад идей и ещё не разобранных задач; у подпроекта
     он про его работу и зовётся просто «Бэклог» (просьба владельца 21.09). */
  const rootCols = BCOLS.map(([id, n]) => [id, id === "backlog" ? "Бэклог идей" : n]);
  const head = `<div class="ph"><button class="ex on" ${act("toggle-open", p.id)} title="Свернуть проект">▾</button>
      ${dot(p.st === "paused" ? "open" : "in_progress")}<b class="nm" ${act("open-proj", p.id)} tabindex="0">${esc(p.n)}</b>
      <span class="n">${all.length}</span>
      <span class="pacts">${btn(p.priv ? "Доступен только мне" : "Доступен всей команде", "proj-priv", p.id, undefined, "sm")}
        ${btn(p.st === "paused" ? "Снять с паузы" : "Поставить на паузу", "pause-proj", p.id, undefined, "sm")}
        ${btn("Переименовать", "rename-proj", p.id, undefined, "sm")}
        ${btn("＋ Подпроект", "new-subproject", p.id, undefined, "sm")}
        ${btn("Удалить", "del-proj", p.id, undefined, "sm")}</span></div>`;
  const subBlock = (k) => {
    const kt = S.tasks.filter((t) => !t.arch && t.pr === k.id);
    /* подпроекты раскрыты по умолчанию: свёрнутые, они превращают доску в список имён */
    const open = !S.subClosed.has(k.id);
    return `<div class="psub"><div class="sh"><button class="ex${open ? " on" : ""}" ${act("toggle-sub-proj", k.id)}>▾</button>
      <b class="nm" ${act("open-proj", k.id)} tabindex="0">${esc(k.n)}</b><span class="n">${kt.length}</span>
      <span class="pacts">${btn("Переименовать", "rename-proj", k.id, undefined, "sm")}${btn("Удалить", "del-proj", k.id, undefined, "sm")}</span></div>
      ${open ? `<div class="cols">${BCOLS.map(([id, n]) => boardCol(k.id, id, n, kt)).join("")}</div>` : ""}</div>`;
  };
  const body = own.length
    ? `<div class="cols">${rootCols.map(([id, n]) => boardCol(p.id, id, n, own)).join("")}</div>`
      + subs.map(subBlock).join("")
    : (branchBacklog.length ? `<div class="cols one">${boardCol(p.id, "backlog", "Бэклог идей", branchBacklog)}</div>` : "")
      + (subs.length ? subs.map(subBlock).join("")
        : `<div class="cols">${rootCols.map(([id, n]) => boardCol(p.id, id, n, own)).join("")}</div>`);
  return `<div class="psec${S.sel === p.id && S.selKind === "project" ? " sel" : ""}" data-id="${p.id}">${head}${body}</div>`;
}

function projectsMap() {
  const roots = S.projects.filter((p) => !p.parent);
  if (!roots.length) return `<div class="bar">${wsChip()}</div>` + empty("Карта пуста", "Здесь будет дерево проектов и подпроектов воркспейса");
  const cnt = (id) => S.tasks.filter((t) => t.pr === id && !t.arch).length;
  /* у узла с детьми число — ВСЯ ветка: иначе корень «41» не сходится с суммой узлов,
     и человек считает, что часть задач потерялась. Своё число — в подсказке. */
  const branch = (id) => projectTasks(id).length;
  /* задача без проекта существует — значит и на карте видна: иначе корень считает её,
     а под ним её нет, и число корня перестаёт сходиться с суммой ветвей */
  const admin = me().role === "admin";
  const known = new Set(S.projects.map((x) => x.id));
  const loose = S.tasks.filter((t) => !t.arch && !known.has(t.pr)).length;
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
    }).join("")}${loose ? `<div class="tbr"><div class="tnode${admin ? "" : " flat"}"${
      admin ? ` ${act("tasks-no-project")} tabindex="0"` : ""} title="${
      admin ? "задачи без проекта — например, созданные из встречи; щёлкните, чтобы открыть их списком"
            : "задачи без проекта; часть из них — задачи коллег, их список виден админу"}">${
      dot("open")}Без проекта<span class="n">${loose}</span></div></div>` : ""}</div></div>`;
}

/* ── спринты ─────────────────────────────────────────────────── */
/* Модель продукта, не выдумка стенда: пространство → спринт (planned → active →
   accepted) → состав (sprint_items: в плане / сверх плана, отметка сверки, пометка
   «к переносу» с причиной). Инициатива — это ПОДПРОЕКТ, направление — проект верхнего
   уровня (miniapp/src/lib/initiatives.ts), отдельной сущности «инициатива» нет. */
const cycle = () => S.cycles.find((c) => c.id === S.cycle) || S.cycles[0];
const spaceCycles = () => S.cycles.filter((c) => c.sp === S.space);
const items = (cid = S.cycle) => S.items.filter((i) => i.c === cid);
const itemTask = (i) => S.tasks.find((t) => t.id === i.t);
/* живое в счёте: удалённые задачи и отменённые вне процента — правило продукта */
const liveItems = (cid = S.cycle) => items(cid).filter((i) => itemTask(i) && !itemTask(i).arch);
const CHK = { ok: "по плану", risk: "риск", problem: "проблема" };

/* Срезы, по которым спринт разбирают: каждый — ответ на «что сейчас делать», а не
   украшение. Ими же сужают состав, поэтому они кликабельны. */
const SFOCUS = {
  problem:  ["проблема",        (i) => i.chk === "problem", "bad"],
  risk:     ["риск",            (i) => i.chk === "risk", "warn"],
  unchk:    ["не отмечено",     (i) => !i.chk && itemTask(i).st !== "done", ""],
  nobody:   ["без исполнителя", (i) => !itemTask(i).who.length && itemTask(i).st !== "done", ""],
  carry:    ["к переносу",      (i) => !!i.carry, ""],
  over:     ["сверх плана",     (i) => !i.plan, ""],
};
const focusList = (list) => S.sFocus && SFOCUS[S.sFocus] ? list.filter(SFOCUS[S.sFocus][1]) : list;

/* Восемь одинаковых плиток были картиной состояния, а не рабочим инструментом: место
   занимали все, подсказывали действие два-три. Взамен — одна полоса «сколько сделано»
   и одна строка «что требует внимания», где каждое число сужает состав до этих задач
   (пересобрано по просьбе владельца 21.09: «неудобно, надо лаконично и воздушно»). */
function sprintPulse(list) {
  const st = (v) => list.filter((i) => itemTask(i).st === v).length;
  const done = st("done"), work = st("in_progress"), n = list.length;
  const pct = n ? Math.round(done / n * 100) : 0;
  const seg = (v, cls) => v ? `<i class="${cls}" style="width:${v / n * 100}%" title="${v}"></i>` : "";
  const marks = Object.entries(SFOCUS).map(([k, [name, test, cls]]) => {
    const v = list.filter(test).length;
    if (!v) return "";
    const on = S.sFocus === k;
    return `<button class="mk${cls ? " " + cls : ""}${on ? " on" : ""}" ${act("sfocus", undefined, on ? "" : k)}
      title="${on ? "Показать весь состав" : "Показать только эти задачи"}"><b>${v}</b>${esc(name)}</button>`;
  }).join("");
  return `<div class="pulse">
    <div class="pl-top"><b>${done} из ${n}</b><span class="muted">сделано · ${pct}%</span>
      <div class="pbar">${seg(done, "d")}${seg(work, "w")}</div>
      <span class="muted">${work} в работе · ${n - done - work} не начато</span></div>
    ${marks ? `<div class="pl-marks"><span class="muted">требуют внимания:</span>${marks}${
      S.sFocus ? `<button class="mk clr" ${act("sfocus", undefined, "")}>показать весь состав</button>` : ""}</div>` : ""}</div>`;
}

/* строка состава: задача, отметка сверки и пометка переноса. Три отметки кнопками
   рядом с каждой строкой — это стена кнопок: состояние свёрнуто в один чип с меню,
   редкие действия («к переносу», «убрать») живут под многоточием. */
const CHK_MARK = { ok: "ok", risk: "risk", problem: "problem" };
function sprintTaskRow(i) {
  const t = itemTask(i);
  const cur = i.chk ? CHK[i.chk] : "не отмечено";
  const menu = `<span class="drop ck-d"><button class="ck${i.chk ? " on " + CHK_MARK[i.chk] : ""}" ${act("noop")}>${cur}</button>
    <div class="dmenu">${Object.keys(CHK).map((k) => `<button class="mi${i.chk === k ? " on" : ""}" ${act("set-chk", t.id, k)}>${CHK[k]}</button>`).join("")}
      <button class="mi${i.chk ? "" : " on"}" ${act("set-chk", t.id, "")}>не отмечено</button></div></span>`;
  const more = `<span class="drop rare"><button class="btn sm" ${act("noop")}>⋯</button>
    <div class="dmenu">${i.carry
      ? `<button class="mi" ${act("tgl-carry", t.id)}>Снять пометку переноса</button>`
      : `<button class="mi" ${act("tgl-carry", t.id)}>Перенести в следующий спринт</button>`}
      <button class="mi" ${act("drop-item", t.id)}>Убрать из спринта</button></div></span>`;
  return `<div class="strow${S.sel === t.id && S.selKind === "task" ? " sel" : ""}">
    <span class="t" ${act("open-task", t.id)} tabindex="0">${dot(t.st)}${priMark(t.prio)}${esc(t.t)}</span>
    ${i.plan ? "" : `<span class="over" title="добавлено после старта спринта">сверх плана</span>`}
    ${i.carry ? `<span class="carry" title="${esc(i.reason || "причина не указана")}">к переносу${i.cnt ? ` · ${i.cnt}-й раз` : ""}</span>` : ""}
    ${menu}
    ${/* аватар БЕЗ имени рядом: кружок с инициалами и «Ана К.» — один и тот же факт
         дважды, а имя занимало треть правой части строки. Имя — в подсказке. */ ""}
    <span class="r">${avOnly(t.who[0])}${due(t.due, t.st === "done")}${more}</span></div>`;
}

function initiativeBlock(name, own, list) {
  const d = list.filter((i) => itemTask(i).st === "done").length;
  const pct = list.length ? Math.round(d / list.length * 100) : 0;
  const bad = list.filter((i) => i.chk === "problem").length;
  /* Рамка вокруг каждой группы внутри рамки секции делала экран тесным, а полоска
     прогресса повторяла «0 из 2» соседним значком. Осталась одна строка-заголовок. */
  return `<div class="ini"><div class="ih">
    <div class="iname">${esc(name)}${own ? `<span class="iown">${esc(own)}</span>` : ""}</div>
    <span class="idone${d === list.length && list.length ? " all" : ""}">${d} из ${list.length}</span>
    ${bad ? `<span class="ibad">проблема: ${bad}</span>` : ""}
    </div><div class="stasks">${list.map(sprintTaskRow).join("")}</div></div>`;
}

/* направление → инициатива → задачи. Направление — проект верхнего уровня,
   инициатива — подпроект; у задачи без проекта своя группа, иначе часть состава
   не видна и счётчики наверху не сходятся с экраном. */
function sprintByInitiative(list) {
  const dirs = new Map();
  list.forEach((i) => {
    const t = itemTask(i);
    const p = proj(t.pr);
    const dir = p ? (p.parent || p.id) : "—";
    const ini = p && p.parent ? p.id : "—";
    if (!dirs.has(dir)) dirs.set(dir, new Map());
    const m = dirs.get(dir);
    if (!m.has(ini)) m.set(ini, []);
    m.get(ini).push(i);
  });
  return [...dirs.entries()].map(([dir, inis]) => {
    const dp = proj(dir);
    return `<div class="dir">${esc(dp ? dp.n : "Без направления")}</div>`
      + [...inis.entries()].map(([ini, l]) => {
        const ip = proj(ini);
        return initiativeBlock(ip ? ip.n : "Общее", ip ? user(ip.own).n : "", l);
      }).join("");
  }).join("");
}

function sprintByPeople(list) {
  const by = new Map();
  list.forEach((i) => {
    const t = itemTask(i);
    const k = t.who.length ? t.who[0] : 0;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(i);
  });
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([uid, l]) => initiativeBlock(uid ? user(uid).n : "Без исполнителя", uid ? user(uid).role : "", l)).join("");
}

const SPRINT_ST = { planned: "запланирован", active: "идёт", accepted: "принят" };
function sprintBar(extra) {
  const c = cycle();
  const sp = S.spaces.find((x) => x.id === S.space) || S.spaces[0];
  /* «Принять спринт» — действие раз в две недели и необратимое: пока спринт идёт,
     оно стоит тихой кнопкой и разгорается, когда срок вышел. Яркой она перетягивала
     внимание с того, ради чего на экран заходят каждый день. */
  const over = c.to && TODAY >= c.to;
  const act_ = c.st === "planned" ? btn("Начать спринт", "start-sprint", c.id, undefined, "sm pri")
    : c.st === "active" ? btn(over ? "Спринт закончился — принять" : "Принять спринт",
      "accept-sprint", c.id, undefined, "sm" + (over ? " pri" : "")) : "";
  return `<div class="bar"><span class="drop">${btn(`Пространство: ${sp.n}`, "noop", undefined, undefined, "sm")}
    <div class="dmenu">${S.spaces.map((x) => `<button class="mi${x.id === S.space ? " on" : ""}" ${act("set-space", x.id)}>${esc(x.n)}</button>`).join("")}
      <button class="mi" ${act("new-space")}>＋ Новое пространство</button></div></span>
    <span class="drop">${btn(`${c.n} · ${SPRINT_ST[c.st]}`, "noop", undefined, undefined, "sm")}
    <div class="dmenu">${spaceCycles().map((x) => `<button class="mi${x.id === S.cycle ? " on" : ""}" ${act("set-cycle", x.id)}>${esc(x.n)} · ${SPRINT_ST[x.st]}</button>`).join("")}
      <button class="mi" ${act("new-sprint")}>＋ Новый спринт</button>
      <button class="mi" ${act("tgl", "report")}>${S.report ? "Скрыть отчёт" : "Открыть отчёт"}</button>
      <button class="mi" ${act("rename-sprint", c.id)}>Переименовать</button>
      <button class="mi" ${act("del-sprint", c.id)}>Удалить спринт</button></div></span>
    <span class="due">${fmtDate(c.from)} — ${fmtDate(c.to)}${c.chk ? ` · сверка ${fmtDate(c.chk)}` : ""}</span>
    <div class="right">${extra || ""}${act_}</div></div>`;
}

/* Пул свободных задач — как в продукте: набирают состав спринта с фильтрами по
   проекту, исполнителю и названию. Панель складывается: при готовом составе она мешает. */
function sprintPool() {
  const taken = new Set(items().map((i) => i.t));
  const free = S.tasks.filter((t) => !t.arch && t.st !== "done" && !taken.has(t.id)
    && (!S.poolPr || t.pr === S.poolPr) && (!S.poolWho || t.who.includes(S.poolWho))
    && (!S.poolQ || t.t.toLowerCase().includes(S.poolQ.toLowerCase())));
  return `<div class="pool"><div class="ph">Свободные задачи<span class="n">${free.length}</span>
    <button class="ex on" ${act("tgl", "poolOpen")} title="Свернуть влево">◀</button></div>
    <div class="pf">
      <span class="drop">${btn(S.poolPr ? projPath(S.poolPr) : "Все проекты", "noop", undefined, undefined, "sm")}
        <div class="dmenu"><button class="mi${S.poolPr ? "" : " on"}" ${act("pool-pr", "")}>Все проекты</button>
        ${S.projects.map((p) => `<button class="mi${S.poolPr === p.id ? " on" : ""}" ${act("pool-pr", p.id)}>${esc(projPath(p.id))}</button>`).join("")}</div></span>
      <span class="drop">${btn(S.poolWho ? user(S.poolWho).n : "Все исполнители", "noop", undefined, undefined, "sm")}
        <div class="dmenu"><button class="mi${S.poolWho ? "" : " on"}" ${act("pool-who", "")}>Все исполнители</button>
        ${S.users.map((u) => `<button class="mi${S.poolWho === u.id ? " on" : ""}" ${act("pool-who", u.id)}>${esc(u.n)}</button>`).join("")}</div></span>
      <input class="pq" placeholder="Поиск по названию" value="${esc(S.poolQ)}" data-inp="poolQ"></div>
    <div class="plist">${free.length ? free.map((t) => `<div class="pit">
      <span class="t" ${act("open-task", t.id)} tabindex="0" title="${esc(t.t)}">${dot(t.st)}${esc(t.t)}</span>
      ${/* «Взять» синей заливкой ×24 превращало пул в стену цвета: кнопка тихая и
          проявляется на строке, к которой человек уже потянулся */ ""}
      ${btn("Взять", "take-item", t.id, undefined, "sm take")}
      <span class="m">${esc(projPath(t.pr))}${t.who.length ? " · " + user(t.who[0]).n : " · не назначена"}</span></div>`).join("")
      : `<div class="pempty">${S.poolPr || S.poolWho || S.poolQ ? "Под фильтры ничего не попало" : "Свободных задач нет — всё уже в спринтах"}</div>`}</div></div>`;
}

function sprintReport(cid) {
  const list = liveItems(cid);
  const c = S.cycles.find((x) => x.id === cid);
  const done = list.filter((i) => itemTask(i).st === "done");
  const byUser = new Map();
  done.forEach((i) => { const t = itemTask(i); const k = t.who.length ? t.who[0] : 0;
    byUser.set(k, (byUser.get(k) || 0) + 1); });
  const byProj = new Map();
  list.forEach((i) => { const t = itemTask(i); const k = proj(t.pr) ? (proj(t.pr).parent || t.pr) : "—";
    if (!byProj.has(k)) byProj.set(k, [0, 0]); const v = byProj.get(k);
    byProj.set(k, [v[0] + (itemTask(i).st === "done" ? 1 : 0), v[1] + 1]); });
  return `<div class="pane"><h3>Итоги спринта «${esc(c.n)}»</h3>
    <div class="sub">${fmtDate(c.from)} — ${fmtDate(c.to)} · ${SPRINT_ST[c.st]}</div>
    ${rows([
      ["План", nTasks(list.filter((i) => i.plan).length)],
      ["Сделано", nTasks(done.length)],
      ["Сверх плана", nTasks(list.filter((i) => !i.plan).length)],
      ["Перенесено", nTasks(list.filter((i) => i.carry).length)],
      ["Просрочка", nTasks(list.filter((i) => itemTask(i).st !== "done" && dueKind(itemTask(i).due) === "now").length)],
    ])}
    ${lab("Кто сколько закрыл")}
    ${rows([...byUser.entries()].sort((a, b) => b[1] - a[1]).map(([uid, n]) => [uid ? user(uid).n : "Без исполнителя", nTasks(n)]))}
    ${lab("По проектам")}
    ${rows([...byProj.entries()].map(([k, [d, all]]) => [proj(k) ? proj(k).n : "Без проекта", `${d} из ${all}`]))}
    ${c.sum ? lab("Итог словами") + `<div class="note">${esc(c.sum)}</div>` : ""}
    <div class="mt">${btn("Скопировать итоги", "copy-report", cid)}</div></div>`;
}

function screenSprints() {
  if (S.tab === "timeline") return screenTimeline();
  if (S.tab === "analytics") return screenAnalytics();
  if (S.tab === "journal") return screenJournal();
  if (!spaceCycles().length) return sprintBar() + empty("В этом пространстве спринтов пока нет", "Заведите спринт — состав наберётся из свободных задач");
  const list = liveItems();
  /* В полосе остаются вид и набор состава. Группировка — свойство списка, поэтому
     переехала в его заголовок; отчёт — в меню спринта: открывают его раз в спринт. */
  const view = `<span class="seg">
    <button class="sg${S.sprintView === "board" ? "" : " on"}" ${act("set-view", undefined, "list")}>Список</button>
    <button class="sg${S.sprintView === "board" ? " on" : ""}" ${act("set-view", undefined, "board")}>Канбан</button></span>
    ${S.poolOpen ? "" : btn("Набрать состав", "tgl", "poolOpen", undefined, "sm")}`;
  const shown = focusList(list);
  const head = `<div class="shead"><span class="scount">Состав${S.sFocus
    ? ` · ${esc(SFOCUS[S.sFocus][0])}: ${shown.length}` : ` · ${shown.length}`}</span>
    <span class="sgrp"><span class="muted">группировать</span>
      <button class="lk${S.group === "people" ? "" : " on"}" ${act("set-group", undefined, "ini")}>по инициативам</button>
      <button class="lk${S.group === "people" ? " on" : ""}" ${act("set-group", undefined, "people")}>по людям</button></span></div>`;
  const body = S.report ? `<div class="panes">${sprintReport(S.cycle)}</div>`
    : S.sprintView === "board" ? sprintBoard(shown)
    : shown.length ? head + `<div class="sprint">${S.group === "people" ? sprintByPeople(shown) : sprintByInitiative(shown)}</div>`
      : head + empty(S.sFocus ? "Таких задач в спринте нет" : "Состав спринта пуст",
        S.sFocus ? "Снимите срез, чтобы увидеть весь состав" : "Наберите задачи из пула слева — план считается по ним");
  return sprintBar(view) + sprintPulse(list)
    + `<div class="swrap">${S.poolOpen ? sprintPool() : ""}<div class="scol">${body}</div></div>`;
}

function sprintBoard(list) {
  const cols = BCOLS.filter(([id]) => id !== "backlog");   /* у спринта «Бэклога» нет — канон продукта */
  return `<div class="board">${cols.map(([cid, cn]) => {
    const inCol = list.filter((i) => itemTask(i).st === cid);
    return `<div class="col"><h3>${dot(cid)}${cn}<span class="n">${inCol.length}</span></h3>
      <div class="cards" data-drop="${cid}">${inCol.map((i) => { const t = itemTask(i);
        return `<div class="card" draggable="true" data-card="${t.id}" ${act("open-task", t.id)} tabindex="0">
        ${priMark(t.prio)}${esc(t.t)}<div class="m">${t.who.length ? av(t.who[0]) : `<span class="muted">не назначен</span>`}
        <span style="margin-left:auto">${due(t.due, t.st === "done")}</span></div></div>`; }).join("")
        || `<div class="drop-empty">перетащите сюда</div>`}
        <input class="qadd" placeholder="+ задача в «${esc(cn)}»" data-qadd="${cid}"></div></div>`;
  }).join("")}</div>`;
}

function screenAnalytics() {
  const inCycle = liveItems().map(itemTask);
  if (!inCycle.length) return sprintBar() + empty("Считать пока нечего", "Аналитика собирается по задачам цикла");
  /* нагрузка — это то, что ЕЩЁ висит: закрытые задачи в неё не входят, иначе человек,
     закрывший десять, выглядит самым загруженным */
  const open_ = inCycle.filter((t) => t.st !== "done");
  const load = S.users.map((u) => [u, open_.filter((t) => t.who.includes(u.id)).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...load.map(([, n]) => n), 1);
  const done = inCycle.filter((t) => t.st === "done").length;
  /* просрочка закрытой задачи ничего не значит: считаем только живые */
  const late = open_.filter((t) => dueKind(t.due) === "now").length;
  /* скорость без предыдущего цикла — просто число: сравнивать не с чем */
  const prevId = (spaceCycles()[spaceCycles().findIndex((c) => c.id === S.cycle) + 1] || {}).id;
  const prevDone = prevId ? liveItems(prevId).map(itemTask).filter((t) => t.st === "done").length : null;
  return sprintBar() + `<div class="panes"><div class="pane"><h3>Аналитика цикла</h3><div class="sub">Скорость и распределение нагрузки</div>
    ${rows([
      ["Закрыто за цикл", nTasks(done) + (prevDone === null ? "" : ` <span class="muted">· в прошлом цикле ${prevDone}</span>`)],
      ["В работе", nTasks(inCycle.filter((t) => t.st === "in_progress").length)],
      ["Просрочено", late ? alert_(nTasks(late)) : nTasks(0)],
      ["Без исполнителя", nTasks(open_.filter((t) => !t.who.length).length)],
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
  if (!items.length) return sprintBar() + empty("В этом цикле задачи не двигали",
    "Записи появляются, когда задачу берут в работу, двигают по доске или меняют ей срок");
  return sprintBar() + `<div class="panes"><div class="pane"><h3>Журнал перемещений</h3>
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
  e.preventDefault(); const id = S.board.drag; S.board.drag = null;
  A.dropTask(id, z.dataset.drop, z.dataset.sec || null);
});
