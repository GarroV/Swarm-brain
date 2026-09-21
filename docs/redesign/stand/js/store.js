/* Состояние стенда и действия над ним. Ни одного изменения объекта на месте:
   каждое действие возвращает новые массивы, дальше идёт перерисовка. */

const S = {
  sec: "home", tab: "today", sel: null, selKind: null,
  /* задачи */
  lens: "mine", statuses: new Set(["open", "in_progress"]), byMarket: false, staff: false, noMailOnly: false,
  recurOnly: false, archOn: false, sprintView: "list",
  q: "", bulk: new Set(), dtab: "overview", mk: "", noProject: false,
  /* встречи */
  mf: { q: "", period: "all", cc: [], src: [], people: [], store: "any", st: "any" },
  /* база */
  bq: "", bcc: "", bmine: false,
  fbo: false,
  /* фильтр по человеку — ставится кликом по строке в «Команде» */
  assignee: null, activeOnly: false, showClosed: false,
  /* спринты */
  cycle: "c2", cycles: CYCLES.slice(), board: { drag: null },
  /* доска проектов: вкладки досок (в продукте — таблица sprints), какие проекты раскрыты */
  boards: BOARDS.slice(), boardTab: "b1", openProj: new Set(["p1"]), subOpen: new Set(),
  /* система */
  theme: "light", lang: "RU", tz: "Europe/Belgrade", toast: null,
  /* данные */
  tasks: TASKS.slice(), meetings: MEETINGS.slice(), entries: ENTRIES.slice(), files: FILES.slice(),
  projects: PROJECTS.slice(), comments: { ...COMMENTS }, history: { ...HISTORY },
  notif: NOTIF.slice(), feedback: FEEDBACK.slice(), queue: AGENT_QUEUE.slice(),
  notifPrefs: NOTIF_PREFS.slice(), tokens: TOKENS.slice(),
  initiatives: INITIATIVES.slice(), broadcasts: BROADCASTS.slice(),
  integrations: INTEGRATIONS.slice(), workspaces: WORKSPACES.slice(), labels: LABELS.slice(),
  users: USERS.slice(),
};

/* ── справочники ─────────────────────────────────────────────── */
const user = (id) => S.users.find((u) => u.id === id);
const me = () => user(ME);
const proj = (id) => S.projects.find((p) => p.id === id);
/* Проект у задачи, рождённой из встречи, НЕИЗВЕСТЕН: встреча не знает проекта. Раньше
   всюду стоял зашитый проект p1 — и всё созданное молча приписывалось «Открытию CEE». Тот же
   урок, что в продукте с зашитым group_id: зашитый идентификатор врёт тихо. */
const projPath = (id) => { const p = proj(id); if (!p) return "—"; return p.parent ? `${proj(p.parent).n} · ${p.n}` : p.n; };
const label = (id) => S.labels.find((l) => l.id === id);
const cname = (c) => (COUNTRIES.find((x) => x.c === c) || {}).n || c;
const ST_LABEL = { open: "Открыто", in_progress: "В работе", done: "Готово" };
const MEET_ST = { pending: "ждёт вычитки", draft: "черновик записи", confirmed: "подтверждена" };
const PRIO_LABEL = { high: "высокий", med: "средний", low: "низкий" };
/* в колонке метки длинная подпись повтора не помещается и режется: там короткая */
const RECUR_SHORT = { weekly: "↻ неделя", monthly: "↻ месяц" };
const RECUR_LABEL = { weekly: "каждую неделю", monthly: "каждый месяц", daily: "каждый день" };

/* ── даты ────────────────────────────────────────────────────── */
const MON = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
const fmtDate = (iso) => { if (!iso) return "—"; const [, m, dd] = iso.split("-"); return `${+dd} ${MON[+m - 1]}`; };
/* «когда» из минут назад: строка-дата в данных не сортируется, число — сортируется */
const ago = (m) => {
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  if (m < 1440) return `${Math.round(m / 60)} ч назад`;
  if (m < 2880) return "вчера";
  return fmtDate(new Date(Date.parse(TODAY) - m * 60000).toISOString().slice(0, 10));
};
const daysTo = (iso) => { if (!iso) return null; return Math.round((Date.parse(iso) - Date.parse(TODAY)) / 86400000); };
const fmtDT = (dt) => { const [d_, t_] = String(dt).split(" "); return `${fmtDate(d_)}, ${t_}`; };
const dueKind = (iso) => { const n = daysTo(iso); if (n === null) return ""; if (n < 0) return "now"; if (n === 0) return "today"; return ""; };

/* ── выборка задач: ось времени × линза × статусы × поиск ────── */
/* Ось времени была вкладками: «Сегодня · Ближайшие · Все · Регулярные · Архив».
   Владелец: «немножко как-то путают». Срок и так виден группами прямо в списке
   (просрочено / сегодня / дальше / без срока), а два редких среза стали тумблерами. */
function inScope(t) {
  if (S.archOn) return t.arch;
  if (t.arch) return false;
  if (S.recurOnly) return !!t.recur;
  return true;
}
function inLens(t, lens) {
  if (S.staff) return true;                       /* админский тумблер «все сотрудники» */
  const mine = t.who.includes(ME) || t.by === ME && !t.who.length;
  const team = !t.priv && t.who.length === 0;
  if (lens === "mine") return t.who.includes(ME);
  if (lens === "team") return team;
  /* «Все» = мои + командные, а НЕ буквально все: чужая личная задача — дело коллеги
     (решение владельца 2026-08-20, канон — miniapp/src/lib/smartLists.ts matchesLens).
     Оверсайт руководителя живёт в отдельном тумблере «Все сотрудники» выше. */
  return mine || team;
}
/* Задачи проекта = свои + задачи подпроектов, архивные НЕ в счёт. Одно место на весь
   стенд: список проектов, карта и панель детали расходились на одном проекте (16 в
   строке против 19 в панели), потому что каждый считал по-своему. */
function projectTasks(id) {
  const subs = S.projects.filter((x) => x.parent === id).map((x) => x.id);
  return S.tasks.filter((t) => !t.arch && (t.pr === id || subs.includes(t.pr)));
}

/* Задачи цикла — одно определение на все его вкладки: доска брала без архивных, а чек
   цикла и аналитика — с архивными, и три вкладки одного экрана расходились в числах. */
const cycleTasks = (id = S.cycle) => S.tasks.filter((t) => t.sprint === id && !t.arch);

function visibleTasks() {
  const q = S.q.trim().toLowerCase();
  return S.tasks.filter((t) =>
    inScope(t) && inLens(t, S.lens) &&
    (S.archOn || S.statuses.has(t.st)) &&
    (!S.mk || t.mk === S.mk) &&
    (!S.noProject || !proj(t.pr)) &&
    (!S.assignee || t.who.includes(S.assignee)) &&
    (!q || t.t.toLowerCase().includes(q) || projPath(t.pr).toLowerCase().includes(q)));
}
/* Созданную задачу видно там, где её создали. Из «Архива» и «Регулярных» новая задача
   не попадает в текущий список, и вместо своей записи человек видит прежний список —
   создание выглядит как молчаливый отказ. Поэтому снимаем ровно то, что её прячет. */
function revealTask(t) {
  if (S.sec !== "tasks") return;
  if (t.arch !== !!S.archOn) S.archOn = !!t.arch;
  if (S.recurOnly && !t.recur) S.recurOnly = false;
  if (!inLens(t, S.lens)) S.lens = "all";
  if (!S.statuses.has(t.st)) S.statuses = new Set([...S.statuses, t.st]);
  if (S.mk && t.mk !== S.mk) S.mk = null;
  if (S.assignee && !t.who.includes(S.assignee)) S.assignee = null;
  if (S.noProject && proj(t.pr)) S.noProject = false;
  if (S.q && !t.t.toLowerCase().includes(S.q.trim().toLowerCase())) S.q = "";
}
/* сколько задач в срезе без учёта снимаемых фильтров — для «показано N из M» */
const scopeCount = () => S.tasks.filter(inScope).length;
/* значок в рейке: свои незакрытые, у которых срок сегодня или уже прошёл */
const countToday = () => S.tasks.filter((t) => !t.arch && t.st !== "done" && t.who.includes(ME)
  && daysTo(t.due) !== null && daysTo(t.due) <= 0).length;

/* ── выборка встреч: шесть осей, как в продукте ──────────────── */
const PERIOD_DAYS = { week: 7, month: 30, quarter: 92 };
/* принадлежность вкладке — отдельно от фильтров: полоса обязана сказать «показано N из M»,
   а M — это всё, что лежит на вкладке, без учёта снимаемых фильтров */
const inMeetTab = (m, tab) => tab === "review" ? m.st === "pending"
  : tab === "draft" ? m.st === "draft"
  : tab === "all" ? m.st !== "draft" : true;
function visibleMeetings(tab) {
  const f = S.mf, q = f.q.trim().toLowerCase();
  return S.meetings.filter((m) => {
    if (!inMeetTab(m, tab)) return false;
    if (f.period !== "all" && PERIOD_DAYS[f.period]) {
      const n = -daysTo(m.dt.slice(0, 10)); if (n > PERIOD_DAYS[f.period]) return false;
    }
    if (f.cc.length && !m.cc.some((c) => f.cc.includes(c))) return false;
    if (f.src.length && !f.src.includes(m.src)) return false;
    if (f.people.length && !m.who.some((w) => f.people.includes(w))) return false;
    if (f.store !== "any" && m.store !== f.store) return false;
    if (f.st !== "any" && m.st !== f.st) return false;
    if (q && !m.t.toLowerCase().includes(q)) return false;
    return true;
  });
}
const mfActive = () => { const f = S.mf; return !!(f.q || f.period !== "all" || f.cc.length || f.src.length || f.people.length || f.store !== "any" || f.st !== "any"); };

/* ── выборка записей базы ────────────────────────────────────── */
function visibleEntries(tab) {
  const q = S.bq.trim().toLowerCase();
  return S.entries.filter((e) =>
    (tab === "all" || e.ty === tab) &&
    (!S.bcc || e.cc.includes(S.bcc)) &&
    (!S.bmine || e.who === ME) &&
    (!q || e.h.toLowerCase().includes(q) || e.p.toLowerCase().includes(q)));
}

/* Файл живёт при записи, поэтому страна и «только мои» достаются ему от родителя:
   иначе на вкладке «Файлы» эти два фильтра стояли бы включёнными и ничего не делали. */
function visibleFiles() {
  const q = S.bq.trim().toLowerCase();
  return S.files.filter((f) => {
    const e = S.entries.find((x) => x.id === f.rec);
    return (!S.bcc || (e && e.cc.includes(S.bcc))) &&
      (!S.bmine || (e && e.who === ME)) &&
      (!q || f.n.toLowerCase().includes(q) || (e && e.h.toLowerCase().includes(q)));
  });
}

/* ── общий поиск (⌘K и ответ по базе) ────────────────────────── */
/* Поиск по основе слова: «смета» обязана находить «смету» и «сметы».
   Настоящая морфология живёт на сервере; здесь — отсечение окончания,
   этого достаточно, чтобы поведение экрана было правдивым. */
const stem = (w) => w.length >= 6 ? w.slice(0, w.length - 2) : w.length >= 4 ? w.slice(0, w.length - 1) : w;
/* сколько результатов каждого вида показываем на экране поиска */
const SEARCH_CAP = { tasks: 8, meetings: 6, entries: 6, files: 4 };
function searchAll(q) {
  const s = q.trim().toLowerCase();
  if (!s) return { tasks: [], meetings: [], entries: [], files: [], total: 0, capped: [] };
  const words = s.split(/\s+/).filter(Boolean).map(stem);
  const hit = (...vals) => { const text = vals.map((v) => String(v ?? "")).join(" ").toLowerCase();
    return words.every((w) => text.includes(w)); };
  /* Встречу ищем и по тезисам с расшифровкой, а не только по названию: искать «смету»
     в базе знаний и не находить встречу, где о ней час говорили, — обещание без покрытия. */
  const found = {
    tasks: S.tasks.filter((t) => hit(t.t, t.note, projPath(t.pr))),
    meetings: S.meetings.filter((m) => hit(m.t, (m.tez || []).map((b) => `${b.h} ${(b.li || []).join(" ")}`).join(" "), m.tr)),
    entries: S.entries.filter((e) => hit(e.h, e.p)),
    files: S.files.filter((f) => hit(f.n)),
  };
  /* сколько нашлось ВСЕГО — отдельно от того, сколько показываем: счётчик, считающий
     обрезанный список, молча прячет остальное и говорит «найдено 8» вместо тридцати */
  const total = Object.values(found).reduce((n, list) => n + list.length, 0);
  return { ...Object.fromEntries(Object.entries(found).map(([k, list]) => [k, list.slice(0, SEARCH_CAP[k])])),
    total, capped: Object.entries(found).filter(([k, list]) => list.length > SEARCH_CAP[k])
      .map(([k, list]) => ({ k, shown: SEARCH_CAP[k], all: list.length })) };
}

/* ── действия ────────────────────────────────────────────────── */
/* с единицы счётчик выдавал id уже существующих записей (r2) — клик открывал не ту сущность */
let nextTaskId = 200, nextId = 900;
const uid = (p) => `${p}${nextId++}`;

/* что лежит в каждом воркспейсе; заполняется при уходе из него */
const WS_DATA = {};

const A = {
  set(patch) { Object.assign(S, patch); render(); },
  toast(text) { S.toast = text; render(); clearTimeout(A._t); A._t = setTimeout(() => { S.toast = null; render(); }, 2600); },

  go(sec) { S.sec = sec; S.sel = null; S.selKind = null; S.bulk = new Set(); S.assignee = null; S.tab = firstTab(sec); render(); },
  tab(id) { S.tab = id; S.sel = null; S.selKind = null; render(); },
  select(kind, id) { S.selKind = kind; S.sel = id; S.dtab = "overview"; render(); },
  close() { S.sel = null; S.selKind = null; render(); },

  /* задачи */
  createTask(f) {
    const t = mkTask({ id: nextTaskId++, t: f.title, pr: f.pr, st: "open", who: f.who ? [f.who] : [],
      due: f.due || null, prio: f.prio, labels: f.labels, mk: f.mk, recur: f.recur, priv: f.priv, note: f.note });
    S.tasks = [t, ...S.tasks];
    S.history = { ...S.history, [t.id]: [{ m: 0, who: ME, k: "Создана", v: "вручную" }] };
    A.toast(`Задача ${t.id} создана`);
    revealTask(t);
    A.select("task", t.id);
  },
  patchTask(id, patch, ev) {
    S.tasks = S.tasks.map((t) => t.id === id ? { ...t, ...patch } : t);
    if (ev) S.history = { ...S.history, [id]: [{ m: 0, who: ME, k: ev[0], v: ev[1] || "" }, ...(S.history[id] || [])] };
    render();
  },
  moveTask(id, st) { A.patchTask(id, { st }, ["Статус", ST_LABEL[st]]); },
  takeTask(id) { A.patchTask(id, { st: "in_progress", who: [ME] }, ["Взята в работу", ""]); A.toast("Задача взята в работу"); },
  archiveTask(id) { A.patchTask(id, { arch: true }, ["В архив", ""]); A.toast("Задача в архиве"); },
  restoreTask(id) { A.patchTask(id, { arch: false }, ["Из архива", ""]); A.toast("Задача возвращена"); },
  comment(id, text) {
    if (!text.trim()) return;
    S.comments = { ...S.comments, [id]: [...(S.comments[id] || []), { who: ME, w: "только что", t: text.trim() }] };
    render();
  },
  toggleSub(id, uid_) {
    const t = S.tasks.find((x) => x.id === id);
    const subs = t.subs.includes(uid_) ? t.subs.filter((s) => s !== uid_) : [...t.subs, uid_];
    A.patchTask(id, { subs });
  },
  bulk(action, value) {
    const ids = [...S.bulk];
    if (!ids.length) return;
    if (action === "assign") S.tasks = S.tasks.map((t) => ids.includes(t.id) ? { ...t, who: [value] } : t);
    if (action === "due") S.tasks = S.tasks.map((t) => ids.includes(t.id) ? { ...t, due: value } : t);
    if (action === "label") S.tasks = S.tasks.map((t) => ids.includes(t.id) ? { ...t, labels: [...new Set([...t.labels, value])] } : t);
    if (action === "status") S.tasks = S.tasks.map((t) => ids.includes(t.id) ? { ...t, st: value } : t);
    if (action === "archive") S.tasks = S.tasks.map((t) => ids.includes(t.id) ? { ...t, arch: true } : t);
    if (action === "restore") S.tasks = S.tasks.map((t) => ids.includes(t.id) ? { ...t, arch: false } : t);
    S.bulk = new Set();
    const said = { archive: "В архив отправлено задач", restore: "Возвращено из архива задач" }[action];
    A.toast(`${said || "Изменено задач"}: ${ids.length}`);
  },

  /* встречи */
  confirmMeeting(id) {
    S.meetings = S.meetings.map((m) => m.id === id ? { ...m, st: "confirmed" } : m);
    A.toast("Тезисы подтверждены, встреча в базе");
  },
  publishDraft(id, name) {
    S.meetings = S.meetings.map((m) => m.id === id ? { ...m, st: "pending", t: name || m.t, tez: TEZISY } : m);
    A.toast("Черновик опубликован, тезисы составлены");
  },
  mergeDup(id) { S.meetings = S.meetings.filter((m) => m.id !== id); A.toast("Черновик объединён с встречей"); },
  keepDup(id) { S.meetings = S.meetings.map((m) => m.id === id ? { ...m, dupOk: true } : m); A.toast("Отмечено: не дубль"); },
  extractTasks(id) {
    const m = S.meetings.find((x) => x.id === id);
    const made = ["Уточнить сроки по итогам встречи", "Свести договорённости в документ"].map((t, k) => mkTask({
      id: nextTaskId++, t, pr: null, who: [m.who[0]], due: null, prio: "med", src: m.id }));
    S.tasks = [...made, ...S.tasks];
    S.meetings = S.meetings.map((x) => x.id === id ? { ...x, tasks: [...x.tasks, ...made.map((t) => t.id)] } : x);
    A.toast(`Создано задач: ${made.length}`);
  },
  editTezisy(id, text) {
    S.meetings = S.meetings.map((m) => m.id === id ? { ...m, tez: [{ h: "Тезисы", li: text.split("\n").filter(Boolean) }], edited: true } : m);
    A.toast("Тезисы сохранены");
  },
  /* очередь вычитки агентских встреч */
  queueAccept(id, store) {
    const q = S.queue.find((x) => x.id === id);
    const m = mkMeet({ id: uid("m"), t: q.t, dt: q.dt, dur: 30, who: q.who, src: "agent", st: "confirmed", store, cc: q.cc, tez: q.tez, tasks: [] });
    const made = q.tasks.filter((x) => !x.off).map((x) => mkTask({ id: nextTaskId++, t: x.t, pr: null, who: [x.who], due: x.due, src: m.id }));
    S.meetings = [m, ...S.meetings];
    S.tasks = [...made, ...S.tasks];
    S.queue = S.queue.filter((x) => x.id !== id);
    A.toast(`Опубликовано, задач создано: ${made.length}`);
  },
  queueTaskOff(id, i) {
    S.queue = S.queue.map((q) => q.id !== id ? q
      : { ...q, tasks: q.tasks.map((t, k) => k === +i ? { ...t, off: !t.off } : t) });
    render();
  },
  queueReject(id) { S.queue = S.queue.filter((x) => x.id !== id); A.toast("Отклонено, в базу не попало"); },

  /* база */
  createEntry(f) {
    const e = { id: uid("r"), ty: f.ty, h: f.title, p: f.text, at: TODAY, who: ME, cc: f.cc, priv: f.priv, ix: { n: 0, at: "в очереди" } };
    S.entries = [e, ...S.entries];
    if (f.file) S.files = [{ id: uid("f"), n: f.file, ty: (f.file.split(".").pop() || "doc"), sz: "— КБ", rec: e.id, who: ME, at: TODAY, ix: "в очереди" }, ...S.files];
    A.toast("Запись добавлена в базу");
    A.select("entry", e.id);
  },
  reindex(kind, id) {
    if (kind === "entry") S.entries = S.entries.map((e) => e.id === id ? { ...e, ix: { n: e.ix.n, at: "только что" } } : e);
    if (kind === "file") S.files = S.files.map((f) => f.id === id ? { ...f, ix: "переиндексирован" } : f);
    A.toast("Переиндексировано");
  },
  deleteEntry(id) { S.entries = S.entries.filter((e) => e.id !== id); S.sel = null; A.toast("Запись удалена"); },
  deleteTask(id) { S.tasks = S.tasks.filter((t) => t.id !== +id); S.sel = null; A.toast("Задача удалена навсегда"); },
  editEntry(id, patch) { S.entries = S.entries.map((e) => e.id === id ? { ...e, ...patch } : e); A.toast("Запись сохранена"); },
  replaceFile(id, name) {
    S.files = S.files.map((f) => f.id === id ? { ...f, n: name || f.n, at: TODAY, who: ME, ix: "переиндексирован" } : f);
    A.toast("Файл заменён, индекс обновлён");
  },
  addProject(name) {
    const id = "p" + (S.projects.filter((x) => !x.parent).length + 1) + "n";
    /* проект заводится на той вкладке, где человек стоит: без этого он создавался «нигде»
       и с экрана исчезал — создание выглядело как молчаливый отказ */
    const b = S.boardTab === "all" ? (S.boards[0] || {}).id || null : S.boardTab;
    S.projects = [...S.projects, { id, n: name || "Новый проект", parent: null, own: ME, due: null, st: "active", b }];
    A.toast("Проект создан");
    A.select("project", id);
  },
  addSubproject(parent, name) {
    const id = parent + String.fromCharCode(97 + S.projects.filter((p) => p.parent === parent).length);
    S.projects = [...S.projects, { id, n: name || "Новый подпроект", parent, own: ME, due: null, st: "active" }];
    A.toast("Подпроект создан");
  },
  carryOver() {
    const c = cycle();
    const next = S.cycles.find((x) => x.from > c.to);
    if (!next) { A.toast("Следующего цикла пока нет"); return; }
    const tail = S.tasks.filter((t) => t.sprint === S.cycle && t.st !== "done" && !t.arch);
    if (!tail.length) { A.toast("Хвостов нет — всё закрыто"); return; }
    S.tasks = S.tasks.map((t) => tail.includes(t) ? { ...t, sprint: next.id } : t);
    A.toast(`Перенесено в «${next.n}»: ${tail.length}`);
  },
  /* «Закрыть цикл» до 20.09 только печатал «Цикл закрыт, хвосты перенесены» и не делал
     НИЧЕГО: ни цикл не закрывался, ни хвосты не двигались. Кнопка, которая врёт об успехе,
     хуже отсутствующей — теперь она действительно закрывает и переносит. */
  closeCycle() {
    const c = cycle();
    if (c.st === "closed") { A.toast("Цикл уже закрыт"); return; }
    const next = S.cycles.find((x) => x.from > c.to);
    const tail = S.tasks.filter((t) => t.sprint === c.id && t.st !== "done" && !t.arch);
    if (tail.length && !next) { A.toast(`Следующего цикла нет — переносить ${tail.length} некуда`); return; }
    if (tail.length) S.tasks = S.tasks.map((t) => tail.includes(t) ? { ...t, sprint: next.id } : t);
    S.cycles = S.cycles.map((x) => x.id === c.id ? { ...x, st: "closed" } : x);
    if (next) S.cycle = next.id;
    A.toast(tail.length ? `Цикл закрыт, перенесено в «${next.n}»: ${tail.length}` : "Цикл закрыт, хвостов не было");
  },
  addBoard(name) {
    const id = "b" + (S.boards.length + 1);
    S.boards = [...S.boards, { id, n: name || "Новая вкладка" }];
    S.boardTab = id;
    A.toast("Вкладка создана");
  },
  /* вкладку удаляем вместе с её принадлежностью, но НЕ с проектами: в продукте задачи и
     проекты живут дальше, просто уходят из вкладки. Молча уносить работу нельзя. */
  delBoard(id) {
    const n = S.projects.filter((p) => p.b === id).length;
    S.boards = S.boards.filter((b) => b.id !== id);
    S.projects = S.projects.map((p) => p.b === id ? { ...p, b: null } : p);
    S.boardTab = (S.boards[0] || {}).id || "all";
    A.toast(n ? `Вкладка удалена, проектов осталось без вкладки: ${n}` : "Вкладка удалена");
  },
  renameProject(id, name) {
    if (!name) return;
    S.projects = S.projects.map((p) => p.id === id ? { ...p, n: name } : p);
    A.toast("Проект переименован");
  },
  /* удаление проекта не уносит задачи — они остаются без проекта, как в продукте */
  delProject(id) {
    const kids = S.projects.filter((p) => p.parent === id).map((p) => p.id);
    const gone = new Set([id, ...kids]);
    const n = S.tasks.filter((t) => gone.has(t.pr)).length;
    S.projects = S.projects.filter((p) => !gone.has(p.id));
    S.tasks = S.tasks.map((t) => gone.has(t.pr) ? { ...t, pr: null } : t);
    if (S.sel === id) { S.sel = null; S.selKind = null; }
    A.toast(n ? `Проект удалён, задач осталось без проекта: ${n}` : "Проект удалён");
  },
  toggleProjPriv(id) {
    S.projects = S.projects.map((p) => p.id === id ? { ...p, priv: !p.priv } : p);
    A.toast(proj(id).priv ? "Проект виден только вам" : "Проект виден всей команде");
  },
  /* бросок карточки в колонку другой секции меняет и статус, и проект — как applyDrop
     в продукте: иначе перенос между проектами на доске невозможен */
  dropTask(id, st, pr) {
    const t = S.tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.st !== st) A.patchTask(id, { st }, ["Статус", st === "backlog" ? "Бэклог" : ST_LABEL[st]]);
    if (pr && t.pr !== pr) A.patchTask(id, { pr }, ["Проект", projPath(pr)]);
    if (t.st === st && (!pr || t.pr === pr)) render();
  },
  toggleProject(id) {
    S.projects = S.projects.map((p) => p.id === id ? { ...p, st: p.st === "paused" ? "active" : "paused" } : p);
    A.toast(S.projects.find((p) => p.id === id).st === "paused" ? "Проект на паузе" : "Проект возобновлён");
  },

  /* спринты */
  acceptInitiative(id, patch) { S.initiatives = S.initiatives.map((i) => i.id === id ? { ...i, st: "accepted", ...(patch || {}) } : i); A.toast("Инициатива принята в цикл"); },
  dropInitiative(id) { S.initiatives = S.initiatives.filter((i) => i.id !== id); A.toast("Инициатива снята"); },

  /* система */
  readAll() { S.notif = S.notif.map((n) => ({ ...n, unread: false })); render(); },
  addFeedback(cat, text) {
    S.feedback = [{ id: uid("fb"), cat, t: text, who: ME, at: TODAY, st: "open" }, ...S.feedback];
    A.toast("Спасибо, отправлено");
  },
  resolveFeedback(id) { S.feedback = S.feedback.map((f) => f.id === id ? { ...f, st: "resolved" } : f); render(); },
  broadcast(text, to) { S.broadcasts = [{ at: TODAY, who: ME, to, t: text }, ...S.broadcasts]; A.toast("Рассылка отправлена"); },
  toggleIntegration(id) {
    S.integrations = S.integrations.map((i) => i.id === id ? { ...i, st: i.st === "on" ? "off" : "on" } : i);
    A.toast("Интеграция переключена");
  },
  switchWorkspace(id) {
    const from = (S.workspaces.find((w) => w.active) || {}).id;
    if (from === id) return;
    /* уходя, воркспейс запоминает своё: раньше возврат пересобирал данные из констант,
       и всё созданное в сессии (задача, запись, проект) исчезало без предупреждения */
    WS_DATA[from] = { tasks: S.tasks, meetings: S.meetings, entries: S.entries, files: S.files, projects: S.projects, queue: S.queue };
    S.workspaces = S.workspaces.map((w) => ({ ...w, active: w.id === id }));
    const w = S.workspaces.find((x) => x.id === id);
    /* второго набора данных стенд не тащит: чужой воркспейс честно пуст, пока в нём
       ничего не завели */
    const d = WS_DATA[id] || { tasks: [], meetings: [], entries: [], files: [], projects: [], queue: [] };
    S.tasks = d.tasks; S.meetings = d.meetings; S.entries = d.entries;
    S.files = d.files; S.projects = d.projects; S.queue = d.queue;
    S.sel = null; S.bulk = new Set(); S.assignee = null;
    A.toast(`Воркспейс: ${w.name}`);
  },
  notDup(id) {
    S.queue = S.queue.map((q) => q.id === id ? { ...q, dup: null } : q);
    A.toast("Отмечено: не дубль");
  },
  addWorkspace(id, name) { S.workspaces = [...S.workspaces, { id, name, users: 0, tasks: 0, entries: 0, active: false }]; A.toast("Воркспейс создан"); },
  addLink(id, otherId, kind) {
    S.tasks = S.tasks.map((t) => t.id === id ? { ...t, links: [...t.links, [kind, +otherId]] } : t);
    A.toast("Связь добавлена");
  },
  dropLink(id, i) {
    S.tasks = S.tasks.map((t) => t.id === id ? { ...t, links: t.links.filter((_, k) => k !== +i) } : t);
    render();
  },
  harvest(id, items) {
    const made = items.map((x) => mkTask({ id: nextTaskId++, t: x.t, pr: null, who: [x.who], due: x.due, prio: "med", src: id }));
    S.tasks = [...made, ...S.tasks];
    S.meetings = S.meetings.map((m) => m.id === id ? { ...m, tasks: [...m.tasks, ...made.map((t) => t.id)] } : m);
    A.toast(`Создано задач: ${made.length}`);
  },
  saveLabel(id, n) {
    if (!n.trim()) return A.toast("Нужно название");
    S.labels = id ? S.labels.map((l) => l.id === id ? { ...l, n } : l) : [...S.labels, { id: uid("l"), n, ic: "tag" }];
    A.toast("Метка сохранена");
  },
  delLabel(id) {
    S.labels = S.labels.filter((l) => l.id !== id);
    S.tasks = S.tasks.map((t) => t.labels.includes(id) ? { ...t, labels: t.labels.filter((x) => x !== id) } : t);
    A.toast("Метка удалена и снята с задач");
  },
  saveUser(id, patch) {
    if (!id) {
      const nid = Math.max(...S.users.map((u) => u.id)) + 1;
      const ini = (patch.n || "Новый сотрудник").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      S.users = [...S.users, { id: nid, i: ini, c: "#5B3DEC", tg: "", em: "", note: "", mk: "RS", role: "ops", ...patch }];
      A.toast("Сотрудник добавлен");
      return;
    }
    S.users = S.users.map((u) => u.id === +id ? { ...u, ...patch } : u);
    A.toast("Профиль сохранён");
  },
  readOne(i) { S.notif = S.notif.map((n, k) => k === +i ? { ...n, unread: false } : n); render(); },
  toggleNotifPref(id) {
    S.notifPrefs = S.notifPrefs.map((n) => n.id === id ? { ...n, on: !n.on } : n);
    const n = S.notifPrefs.find((x) => x.id === id);
    A.toast(`${n.n}: ${n.on ? "включено" : "выключено"}`);
  },
  reissueToken(id) {
    const tail = Math.random().toString(36).slice(2, 6);
    S.tokens = S.tokens.map((t) => t.id === id
      ? { ...t, v: (t.id === "mcp" ? "smcp_••••" : "••••") + tail, at: fmtDate(TODAY) } : t);
    A.toast("Токен перевыпущен — старый больше не работает");
  },
  theme() {
    S.theme = S.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = S.theme;
    render();
  },
  lang() { S.lang = S.lang === "RU" ? "EN" : "RU"; A.toast(S.lang === "RU" ? "Интерфейс: русский" : "Interface: English"); },
};
