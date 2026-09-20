/* Состояние стенда и действия над ним. Ни одного изменения объекта на месте:
   каждое действие возвращает новые массивы, дальше идёт перерисовка. */

const S = {
  sec: "tasks", tab: "today", sel: null, selKind: null,
  /* задачи */
  lens: "mine", statuses: new Set(["open", "in_progress"]), byMarket: false, staff: false, noMailOnly: false,
  q: "", bulk: new Set(), dtab: "overview", mk: "",
  /* встречи */
  mf: { q: "", period: "all", cc: [], src: [], people: [], store: "any", st: "any" },
  /* база */
  bq: "", bcc: "", bmine: false,
  /* фильтр по человеку — ставится кликом по строке в «Команде» */
  assignee: null, activeOnly: false, showClosed: false,
  /* спринты */
  cycle: "c2", board: { drag: null },
  cols: [ { id:"open", n:"Открыто", on:true }, { id:"in_progress", n:"В работе", on:true }, { id:"done", n:"Готово", on:true } ],
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
const projPath = (id) => { const p = proj(id); if (!p) return "—"; return p.parent ? `${proj(p.parent).n} · ${p.n}` : p.n; };
const label = (id) => S.labels.find((l) => l.id === id);
const cname = (c) => (COUNTRIES.find((x) => x.c === c) || {}).n || c;
const ST_LABEL = { open: "Открыто", in_progress: "В работе", done: "Готово" };
const PRIO_LABEL = { high: "высокий", med: "средний", low: "низкий" };
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
function inList(t, list) {
  if (list === "archive") return t.arch;
  if (t.arch) return false;
  if (list === "recurring") return !!t.recur;
  if (list === "all") return true;
  const n = daysTo(t.due);
  if (list === "today") return n !== null && n <= 0;
  if (list === "upcoming") return n !== null && n > 0 && n <= 14;
  return true;
}
function inLens(t, lens) {
  if (S.staff) return true;                       /* админский тумблер «все сотрудники» */
  const mine = t.who.includes(ME) || t.by === ME && !t.who.length;
  const team = !t.priv && t.who.length === 0;
  if (lens === "mine") return t.who.includes(ME);
  if (lens === "team") return team;
  return mine || team || (!t.priv && t.who.length > 0 && t.who.includes(ME));
}
function visibleTasks(list = S.tab) {
  const q = S.q.trim().toLowerCase();
  return S.tasks.filter((t) =>
    inList(t, list) && inLens(t, S.lens) &&
    (list === "archive" || S.statuses.has(t.st)) &&
    (!S.mk || t.mk === S.mk) &&
    (!S.assignee || t.who.includes(S.assignee)) &&
    (!q || t.t.toLowerCase().includes(q) || projPath(t.pr).toLowerCase().includes(q)));
}
const countList = (list) => S.tasks.filter((t) => inList(t, list) && inLens(t, S.lens) && (list === "archive" || S.statuses.has(t.st))).length;

/* ── выборка встреч: шесть осей, как в продукте ──────────────── */
const PERIOD_DAYS = { week: 7, month: 30, quarter: 92 };
function visibleMeetings(tab) {
  const f = S.mf, q = f.q.trim().toLowerCase();
  return S.meetings.filter((m) => {
    if (tab === "review" && m.st !== "pending") return false;
    if (tab === "draft" && m.st !== "draft") return false;
    if (tab === "all" && m.st === "draft") return false;
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

/* ── общий поиск (⌘K и ответ по базе) ────────────────────────── */
/* Поиск по основе слова: «смета» обязана находить «смету» и «сметы».
   Настоящая морфология живёт на сервере; здесь — отсечение окончания,
   этого достаточно, чтобы поведение экрана было правдивым. */
const stem = (w) => w.length >= 6 ? w.slice(0, w.length - 2) : w.length >= 4 ? w.slice(0, w.length - 1) : w;
function searchAll(q) {
  const s = q.trim().toLowerCase();
  if (!s) return { tasks: [], meetings: [], entries: [], files: [] };
  const words = s.split(/\s+/).filter(Boolean).map(stem);
  const hit = (...vals) => { const text = vals.map((v) => String(v ?? "")).join(" ").toLowerCase();
    return words.every((w) => text.includes(w)); };
  return {
    tasks: S.tasks.filter((t) => hit(t.t, t.note, projPath(t.pr))).slice(0, 8),
    meetings: S.meetings.filter((m) => hit(m.t)).slice(0, 6),
    entries: S.entries.filter((e) => hit(e.h, e.p)).slice(0, 6),
    files: S.files.filter((f) => hit(f.n)).slice(0, 4),
  };
}

/* ── действия ────────────────────────────────────────────────── */
let nextTaskId = 200, nextId = 1;
const uid = (p) => `${p}${nextId++}`;

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
    S.bulk = new Set();
    A.toast(`Изменено задач: ${ids.length}`);
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
      id: nextTaskId++, t, pr: "p1", who: [m.who[0]], due: null, prio: "med", src: m.id }));
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
    const made = q.tasks.filter((x) => !x.off).map((x) => mkTask({ id: nextTaskId++, t: x.t, pr: "p1", who: [x.who], due: x.due, src: m.id }));
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
  addSubproject(parent, name) {
    const id = parent + String.fromCharCode(97 + S.projects.filter((p) => p.parent === parent).length);
    S.projects = [...S.projects, { id, n: name || "Новый подпроект", parent, own: ME, due: null, st: "active" }];
    A.toast("Подпроект создан");
  },
  carryOver() {
    const c = cycle();
    const next = CYCLES.find((x) => x.from > c.to);
    if (!next) { A.toast("Следующего цикла пока нет"); return; }
    const tail = S.tasks.filter((t) => t.sprint === S.cycle && t.st !== "done" && !t.arch);
    if (!tail.length) { A.toast("Хвостов нет — всё закрыто"); return; }
    S.tasks = S.tasks.map((t) => tail.includes(t) ? { ...t, sprint: next.id } : t);
    A.toast(`Перенесено в «${next.n}»: ${tail.length}`);
  },
  toggleProject(id) {
    S.projects = S.projects.map((p) => p.id === id ? { ...p, st: p.st === "paused" ? "active" : "paused" } : p);
    A.toast(S.projects.find((p) => p.id === id).st === "paused" ? "Проект на паузе" : "Проект возобновлён");
  },

  /* спринты */
  acceptInitiative(id) { S.initiatives = S.initiatives.map((i) => i.id === id ? { ...i, st: "accepted" } : i); A.toast("Инициатива принята в цикл"); },
  dropInitiative(id) { S.initiatives = S.initiatives.filter((i) => i.id !== id); A.toast("Инициатива снята"); },
  closeCycle() { A.toast("Цикл закрыт, хвосты перенесены"); },

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
    if ((S.workspaces.find((w) => w.active) || {}).id === id) return;
    S.workspaces = S.workspaces.map((w) => ({ ...w, active: w.id === id }));
    const w = S.workspaces.find((x) => x.id === id);
    /* стенд не тащит второй набор данных: честно показываем пустой воркспейс */
    const empty = id !== "cee";
    S.tasks = empty ? [] : TASKS.slice();
    S.meetings = empty ? [] : MEETINGS.slice();
    S.entries = empty ? [] : ENTRIES.slice();
    S.files = empty ? [] : FILES.slice();
    S.projects = empty ? [] : PROJECTS.slice();
    S.queue = empty ? [] : AGENT_QUEUE.slice();
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
    const made = items.map((x) => mkTask({ id: nextTaskId++, t: x.t, pr: "p1", who: [x.who], due: x.due, prio: "med", src: id }));
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
  resetCols() {
    S.cols = [ { id:"open", n:"Открыто", on:true }, { id:"in_progress", n:"В работе", on:true }, { id:"done", n:"Готово", on:true } ];
    A.toast("Колонки возвращены по умолчанию");
  },
  addCol(name) {
    const id = "c" + (S.cols.length + 1);
    S.cols = [...S.cols, { id, n: name || "Новая колонка", on: true }];
    A.toast("Колонка добавлена");
  },
  theme() {
    S.theme = S.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = S.theme;
    render();
  },
  lang() { S.lang = S.lang === "RU" ? "EN" : "RU"; A.toast(S.lang === "RU" ? "Интерфейс: русский" : "Interface: English"); },
};
