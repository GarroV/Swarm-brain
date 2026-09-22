/* Состояние стенда и действия над ним. Ни одного изменения объекта на месте:
   каждое действие возвращает новые массивы, дальше идёт перерисовка. */

const S = {
  sec: "home", tab: "today", sel: null, selKind: null,
  /* задачи */
  lens: "mine", statuses: new Set(["open", "in_progress"]), byMarket: false, staff: false, noMailOnly: false,
  recurOnly: false, archOn: false, sprintView: "list",
  q: "", dtab: "overview", mk: "", noProject: false, period: "any",
  /* встречи */
  mf: { q: "", period: "all", cc: [], src: [], people: [], store: "any", st: "any" },
  /* база */
  bq: "", bcc: "", bmine: false,
  fbo: false,
  /* фильтр по человеку — ставится кликом по строке в «Команде» */
  assignee: null, lensWas: null, collapsed: new Set(), calView: false, activeOnly: false, showClosed: false,
  /* спринты */
  cycle: "c2", cycles: CYCLES.slice(), board: { drag: null },
  /* спринты: пространство, состав (sprint_items), группировка, пул набора, отчёт */
  space: "sp1", spaces: SPACES.slice(), items: SITEMS.slice(), group: "ini",
  poolOpen: false, poolPr: "", poolWho: "", poolQ: "", report: false, sFocus: null,
  tezEdit: null, lastCopy: null, from: "", to: "",
  /* доска проектов: вкладки досок (в продукте — таблица sprints), какие проекты раскрыты */
  boards: BOARDS.slice(), boardTab: "b1", openProj: new Set(["p1"]), subClosed: new Set(),
  /* система */
  theme: "light", lang: "RU", tz: "Europe/Belgrade", toast: null,
  /* календарь: on — подключён, off — не подключён, expired — доступ истёк */
  cal: "on",
  /* объявление об обновлении: продукт показывает его, когда собрана новая версия */
  deploy: false,
  /* дайджест: период и рынки, по которым он собирается */
  digPeriod: "week", digMk: ["RS", "ME"],
  /* данные */
  tasks: TASKS.slice(), meetings: MEETINGS.slice(), entries: ENTRIES.slice(), files: FILES.slice(),
  projects: PROJECTS.slice(), comments: { ...COMMENTS }, history: { ...HISTORY },
  notif: NOTIF.slice(), feedback: FEEDBACK.slice(), queue: AGENT_QUEUE.slice(),
  notifPrefs: NOTIF_PREFS.slice(), tokens: TOKENS.slice(),
  broadcasts: BROADCASTS.slice(),
  integrations: INTEGRATIONS.slice(), granolaNew: 3, workspaces: WORKSPACES.slice(), labels: LABELS.slice(),
  roles: ROLES.slice(),
  /* предложенные по встрече задачи: «Сгенерировать задачи» переключает то же окно
     встречи на их список, а не создаёт всё молча одним нажатием */
  gen: [], genFor: null,
  /* панель задачи по умолчанию показывает ЗАПОЛНЕННОЕ: пустые поля — по кнопке */
  allProps: false,
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
/* Приоритет в продукте НЕ обязателен: в проде он проставлен у 6 задач из 481, а в
   десктопной форме его вообще нет. Пустое значение — норма, и у него есть имя. */
const PRIO_LABEL = { "": "не задан", high: "высокий", med: "средний", low: "низкий" };
/* роли задач продукта: rnd / bd / marketing (на 21.09.2026 — 76 задач из 482) */
const roleName = (id) => (S.roles.find((r) => r.id === id) || {}).n || "";
/* период — та же ось, что RangePicker продукта: сужает список по сроку */
const PERIOD = { any: "любой срок", today: "сегодня", week: "эта неделя", month: "этот месяц" };
/* Три готовых среза закрывают не всякий вопрос: «что у нас на ближайшие 21 день» не
   складывается ни из недели, ни из месяца (просьба владельца 21.09). Свой период
   задаётся двумя датами, и он ничем не хуже готовых — те просто его частные случаи. */
function periodName() {
  if (S.period === "range") return S.from && S.to
    ? `${fmtDate(S.from)} — ${fmtDate(S.to)}` : "свой период";
  return PERIOD[S.period];
}
function inPeriod(t) {
  if (S.period === "any") return true;
  if (!t.due) return false;
  if (S.period === "range") {
    if (!S.from || !S.to) return true;
    return t.due >= S.from && t.due <= S.to;
  }
  const n = daysTo(t.due);
  if (S.period === "today") return n <= 0;
  if (S.period === "week") return n <= 7;
  return n <= 31;
}
/* Календарный вид берёт дни из того же «Периода», что и список: два органа на одно
   дело расходятся, и человек перестаёт понимать, что именно он сейчас видит
   (решение владельца 22.09.2026 — «в зависимости от периода будет календарный вид
   показываться»). «Любой срок» — не повод рисовать бесконечность: показываем текущую
   неделю, понедельник–воскресенье, и говорим об этом подписью. */
const CAL_MAX_DAYS = 92;
function calRange() {
  if (S.period === "range" && S.from && S.to && S.from <= S.to) return [S.from, S.to];
  if (S.period === "today") return [TODAY, TODAY];
  if (S.period === "week") return [TODAY, addDays(TODAY, 7)];
  if (S.period === "month") return [TODAY, addDays(TODAY, 31)];
  const d = new Date(TODAY + "T00:00:00").getDay();
  const mon = addDays(TODAY, d === 0 ? -6 : 1 - d);
  return [mon, addDays(mon, 6)];
}
/* Длинный период рисуем прокруткой вбок, но не бесконечно: год колонками — это не
   обзор, а зависший экран. Обрез называем вслух в подписи, молча резать нельзя. */
function calDays() {
  const [from, to] = calRange();
  const out = [];
  for (let d = from; d <= to && out.length < CAL_MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}
const DOW = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const dow = (iso) => DOW[new Date(iso + "T00:00:00").getDay()];
const isWeekend = (iso) => [0, 6].includes(new Date(iso + "T00:00:00").getDay());

/* в колонке метки длинная подпись повтора не помещается и режется: там короткая */
const RECUR_SHORT = { weekly: "↻ неделя", monthly: "↻ месяц" };
const RECUR_LABEL = { weekly: "каждую неделю", monthly: "каждый месяц", daily: "каждый день" };

/* ── даты ────────────────────────────────────────────────────── */
/* Считаем и отдаём в UTC. Раньше дата строилась в ЛОКАЛЬНОМ времени, а возвращалась
   через toISOString() — то есть в UTC: в поясе восточнее Гринвича (Белград, UTC+2)
   addDays(d, 1) отдавал ТОТ ЖЕ день. Молча: ни ошибки, ни предупреждения. Поймано на
   календарном виде 22.09.2026 — сетка крутила один день 92 раза подряд. */
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
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

/* Задачи спринта — одно определение на все его вкладки: доска брала без архивных, а
   аналитика с архивными, и вкладки одного экрана расходились в числах. Источник — состав
   (S.items), как sprint_items в продукте: задача может быть взята в спринт и убрана из него,
   а поле у самой задачи этого не помнит. */
const cycleTasks = (id = S.cycle) => S.items.filter((i) => i.c === id)
  .map((i) => S.tasks.find((t) => t.id === i.t)).filter((t) => t && !t.arch);

function visibleTasks() {
  const q = S.q.trim().toLowerCase();
  return S.tasks.filter((t) =>
    inScope(t) && inLens(t, S.lens) &&
    (S.archOn || S.statuses.has(t.st)) &&
    (!S.mk || t.mk === S.mk) &&
    (!S.noProject || !proj(t.pr)) && inPeriod(t) &&
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

  go(sec) { S.sec = sec; S.sel = null; S.selKind = null; S.assignee = null; S.tab = firstTab(sec); render(); },
  tab(id) { S.tab = id; S.sel = null; S.selKind = null; render(); },
  /* встреча открывается на ТЕЗИСАХ: ради разобранного текста её и открывают,
     карточка со временем и участниками — это уже справка (просьба владельца 21.09) */
  select(kind, id) { S.selKind = kind; S.sel = id; S.dtab = kind === "meeting" ? "tez" : "overview"; render(); },
  close() { S.sel = null; S.selKind = null; render(); },

  /* задачи */
  createTask(f) {
    const t = mkTask({ id: nextTaskId++, t: f.title, pr: f.pr, st: "open", who: f.who ? [f.who] : [],
      due: f.due || null, prio: f.prio, labels: f.labels, mk: f.mk, recur: f.recur, priv: f.priv, note: f.note,
      ping: f.ping || null, role: f.role || null });
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
  /* пинг одноразовый: новый день взводит его заново, снятие — очищает. «Уже напомнили»
     показываем всегда, иначе человек ставит дату и не понимает, почему ничего не будет */
  setPing(id, day) {
    A.patchTask(id, { ping: day || null, pinged: false },
      ["Напоминание", day ? fmtDate(day) : "снято"]);
    A.toast(day ? `Напомним ${fmtDate(day)}` : "Напоминание снято");
  },
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

  /* встречи */
  /* Переобработка тезисов — как в продукте: не «пересобери», а ЧТО поменять. Четыре
     готовых пожелания плюс своё; без транскрипта пересобирать нечего, и об этом надо
     сказать, а не молча показать прежний текст. */
  regenTezisy(id, kind, own) {
    const m = S.meetings.find((x) => x.id === id);
    if (!m || !m.tr.length) { A.toast("Пересобирать не из чего: транскрипта нет"); return; }
    const said = { short: "короче", long: "подробнее", decisions: "с акцентом на решениях",
      plain: "тем же промптом", own: own || "по вашему пожеланию" }[kind] || "заново";
    const head = { short: "Коротко", long: "Подробно", decisions: "Решения", plain: "Итоги", own: "Итоги" }[kind] || "Итоги";
    S.meetings = S.meetings.map((x) => x.id === id ? { ...x, tez: [{ h: head,
      li: [`Тезисы переобработаны ${said}.`, ...x.tez.flatMap((sec) => sec.li).slice(0, kind === "short" ? 2 : 6)] }],
      notesEdited: false } : x);
    A.toast(`Тезисы переобработаны ${said}`);
  },
  renameMeeting(id, name) {
    if (!name) return;
    S.meetings = S.meetings.map((m) => m.id === id ? { ...m, t: name } : m);
    A.toast("Название встречи обновлено");
  },
  delMeeting(id) {
    S.meetings = S.meetings.filter((m) => m.id !== id);
    if (S.sel === id) { S.sel = null; S.selKind = null; }
    A.toast("Встреча и её расшифровка удалены");
  },
  /* «Добавить в базу» — одно действие вместо двух: подтвердить тезисы и сказать, куда
     встреча ляжет. Раньше подтверждение стояло кнопкой, а хранилище — полем в карточке,
     и человек добавлял встречу, не зная, что она уедет в общую базу. */
  addToBase(id, store) {
    const m = S.meetings.find((x) => x.id === id);
    if (!m) return;
    if (m.st === "draft") return A.toast("Черновик сперва разбирается на тезисы");
    S.meetings = S.meetings.map((x) => x.id === id ? { ...x, st: "confirmed", store } : x);
    A.toast(store === "shared" ? "Встреча добавлена в общую базу" : "Встреча добавлена в личное хранилище");
  },
  confirmMeeting(id) {
    S.meetings = S.meetings.map((m) => m.id === id ? { ...m, st: "confirmed" } : m);
    A.toast("Тезисы подтверждены, встреча в базе");
  },
  publishDraft(id, name) {
    S.meetings = S.meetings.map((m) => m.id === id ? { ...m, st: "pending", t: name || m.t, tez: TEZISY } : m);
    A.toast("Черновик опубликован, тезисы составлены");
  },
  extractTasks(id) {
    const m = S.meetings.find((x) => x.id === id);
    const made = ["Уточнить сроки по итогам встречи", "Свести договорённости в документ"].map((t, k) => mkTask({
      id: nextTaskId++, t, pr: null, who: [m.who[0]], due: null, prio: "med", src: m.id }));
    S.tasks = [...made, ...S.tasks];
    S.meetings = S.meetings.map((x) => x.id === id ? { ...x, tasks: [...x.tasks, ...made.map((t) => t.id)] } : x);
    A.toast(`Создано задач: ${made.length}`);
  },
  /* Правка в том же окне: сохраняем оформленный текст и пересобираем из него пункты,
     чтобы счётчики и поиск видели то же, что человек. */
  saveTezHtml(id, html) {
    const plain = String(html).replace(/<\/(li|h5|p|div)>/gi, "\n").replace(/<[^>]+>/g, "")
      .split("\n").map((x) => x.trim()).filter(Boolean);
    if (!plain.length) return A.toast("Тезисы не могут быть пустыми");
    S.meetings = S.meetings.map((m) => m.id === id
      ? { ...m, tezHtml: html, tez: [{ h: "Тезисы", li: plain }], edited: true } : m);
    S.tezEdit = null;
    A.toast("Тезисы сохранены");
  },
  copyTez(id) {
    const m = S.meetings.find((x) => x.id === id);
    if (!m) return;
    const html = m.tezHtml || m.tez.map((s) => `<h5>${s.h}</h5><ul>${s.li.map((x) => `<li>${x}</li>`).join("")}</ul>`).join("");
    const text = String(html).replace(/<\/(li|h5|p|div)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{2,}/g, "\n").trim();
    /* в буфер кладём ОБА вида: html — чтобы оформление пережило вставку в документ,
       plain — чтобы вставка в поле без оформления не принесла тегов */
    S.lastCopy = { html, text };
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }) })]).catch(() => {});
      } else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    } catch (e) { /* буфер недоступен — стенд остаётся рабочим, текст уже в S.lastCopy */ }
    A.toast("Тезисы скопированы с оформлением");
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
  /* «В задачу» — задача из записи прямо в базе: в продукте RecordDetail так и делает,
     иначе человек копирует текст руками и теряет ссылку на источник */
  taskFromEntry(id) {
    const e = S.entries.find((x) => x.id === id);
    if (!e) return;
    A.createTask({ title: clip(e.h, 60), pr: null, who: ME, due: null, prio: "med",
      labels: [], mk: (e.cc || [])[0] || null, recur: null, priv: e.priv, note: e.p });
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
  renameBoard(id, n) {
    if (!n.trim()) return A.toast("Нужно название");
    S.boards = S.boards.map((b) => b.id === id ? { ...b, n } : b);
    A.toast("Вкладка переименована");
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
  /* Пауза у проекта была только в фильтре «показывать на паузе» — поставить проект на
     паузу было нечем, и фильтр показывал то, чего никто не мог создать. */
  togglePause(id) {
    const p = S.projects.find((x) => x.id === id);
    if (!p) return;
    S.projects = S.projects.map((x) => x.id === id ? { ...x, st: x.st === "paused" ? "active" : "paused" } : x);
    A.toast(p.st === "paused" ? `Проект «${p.n}» снят с паузы` : `Проект «${p.n}» поставлен на паузу`);
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
  /* отметка сверки: по плану / риск / проблема. Повторное нажатие снимает — «не отмечено»
     в продукте значит «человек промолчал», и вернуться к этому состоянию надо уметь */
  setCheck(tid, v) {
    S.items = S.items.map((i) => i.c === S.cycle && i.t === tid ? { ...i, chk: i.chk === v ? null : v } : i);
    const now = S.items.find((i) => i.c === S.cycle && i.t === tid);
    A.toast(now && now.chk ? `Отмечено: ${CHK[now.chk]}` : "Отметка снята");
  },
  toggleCarry(tid, reason) {
    S.items = S.items.map((i) => i.c === S.cycle && i.t === tid
      ? { ...i, carry: !i.carry, reason: !i.carry ? (reason || "") : "" } : i);
    const now = S.items.find((i) => i.c === S.cycle && i.t === tid);
    A.toast(now.carry ? "Помечена к переносу" : "Пометка переноса снята");
  },
  takeItem(tid) {
    if (S.items.some((i) => i.c === S.cycle && i.t === tid)) { A.toast("Задача уже в спринте"); return; }
    /* задача, взятая после старта, — «сверх плана»: иначе процент выполнения растёт от
       добавления работы, и спринт выглядит лучше, чем он есть */
    S.items = [...S.items, { c: S.cycle, t: tid, plan: cycle().st === "planned", chk: null, carry: false, reason: "", cnt: 0 }];
    S.tasks = S.tasks.map((t) => t.id === tid ? { ...t, sprint: S.cycle } : t);
    A.toast(cycle().st === "planned" ? "Задача в плане спринта" : "Задача взята сверх плана");
  },
  dropItem(tid) {
    S.items = S.items.filter((i) => !(i.c === S.cycle && i.t === tid));
    S.tasks = S.tasks.map((t) => t.id === tid && t.sprint === S.cycle ? { ...t, sprint: null } : t);
    A.toast("Задача вышла из спринта — сама она никуда не делась");
  },
  startSprint(id) {
    S.cycles = S.cycles.map((c) => c.id === id ? { ...c, st: "active" } : c);
    A.toast("Спринт начат — состав замер планом");
  },
  /* Приёмка: итоги считаются один раз, незакрытое переезжает в следующий спринт с
     причиной и счётчиком переносов, следующий создаётся встык — как в продукте. */
  acceptSprint(id, summary) {
    const c = S.cycles.find((x) => x.id === id);
    const tail = S.items.filter((i) => i.c === id && (S.tasks.find((t) => t.id === i.t) || {}).st !== "done");
    let next = S.cycles.find((x) => x.sp === c.sp && x.from > c.to && x.st !== "accepted");
    if (!next) {
      const from = new Date(Date.parse(c.to) + 86400000).toISOString().slice(0, 10);
      const to = new Date(Date.parse(c.to) + 86400000 * 15).toISOString().slice(0, 10);
      next = { id: "c" + (S.cycles.length + 1) + "n", n: `Спринт ${S.cycles.filter((x) => x.sp === c.sp).length + 1}`,
        from, to, st: "planned", sp: c.sp, chk: null };
      S.cycles = [...S.cycles, next];
    }
    S.items = [...S.items, ...tail.map((i) => ({ ...i, c: next.id, plan: true, chk: null,
      carry: false, cnt: (i.cnt || 0) + 1, cf: id }))];
    S.tasks = S.tasks.map((t) => tail.some((i) => i.t === t.id) ? { ...t, sprint: next.id } : t);
    S.cycles = S.cycles.map((x) => x.id === id ? { ...x, st: "accepted", sum: summary || x.sum || "" } : x);
    S.cycle = next.id;
    A.toast(tail.length ? `Спринт принят, перенесено в «${next.n}»: ${tail.length}` : "Спринт принят, незакрытого не было");
  },
  addSprint(name) {
    const last = spaceCycles()[0] || { to: TODAY };
    const from = new Date(Date.parse(last.to) + 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.parse(from) + 86400000 * 13).toISOString().slice(0, 10);
    const id = "c" + (S.cycles.length + 1) + "n";
    S.cycles = [{ id, n: name || `Спринт ${spaceCycles().length + 1}`, from, to, st: "planned", sp: S.space, chk: null }, ...S.cycles];
    S.cycle = id;
    A.toast("Спринт создан — наберите состав");
  },
  renameSprint(id, name) {
    if (!name) return;
    S.cycles = S.cycles.map((c) => c.id === id ? { ...c, n: name } : c);
    A.toast("Спринт переименован");
  },
  delSprint(id) {
    const n = S.items.filter((i) => i.c === id).length;
    S.cycles = S.cycles.filter((c) => c.id !== id);
    S.items = S.items.filter((i) => i.c !== id);
    S.tasks = S.tasks.map((t) => t.sprint === id ? { ...t, sprint: null } : t);
    S.cycle = (spaceCycles()[0] || {}).id || null;
    A.toast(n ? `Спринт удалён, задачи вышли из него: ${n}` : "Спринт удалён");
  },
  addSpace(name) {
    const id = "sp" + (S.spaces.length + 1);
    S.spaces = [...S.spaces, { id, n: name || "Новое пространство" }];
    S.space = id;
    S.cycle = null;
    A.toast("Пространство создано");
  },

  /* система */
  importGranola() {
    const n = S.granolaNew;
    if (!n) { A.toast("Новых заметок нет"); return; }
    S.granolaNew = 0;
    S.entries = [mkEntryFromGranola(n), ...S.entries];
    A.toast(`Импортировано заметок: ${n}`);
  },
  readAll() { S.notif = S.notif.map((n) => ({ ...n, unread: false })); render(); },
  addFeedback(cat, text) {
    S.feedback = [{ id: uid("fb"), cat, t: text, who: ME, at: TODAY, st: "open" }, ...S.feedback];
    A.toast("Спасибо, отправлено");
  },
  resolveFeedback(id) { S.feedback = S.feedback.map((f) => f.id === id ? { ...f, st: "resolved" } : f); render(); },
  broadcast(text, to) { S.broadcasts = [{ at: TODAY, who: ME, to, t: text }, ...S.broadcasts]; A.toast("Рассылка отправлена"); },
  toggleIntegration(id) {
    const cur = S.integrations.find((i) => i.id === id);
    /* «в разработке» не должно ПРИТВОРЯТЬСЯ подключённым: человек поверит кнопке,
       перестанет ждать письма и будет считать, что интеграция работает */
    if (cur && cur.soon) return A.toast(`«${cur.n}» пока в разработке — подключить нечего`);
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
    S.sel = null; S.assignee = null;
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
  addUrl(id, u) {
    const url = String(u || "").trim();
    /* ссылка, по которой нельзя перейти, хуже её отсутствия: молча не принимаем — говорим */
    if (!/^https?:\/\/\S+$/.test(url)) return A.toast("Нужна ссылка вида https://…");
    const t = S.tasks.find((x) => x.id === id);
    A.patchTask(id, { urls: [...((t && t.urls) || []), url] }, ["Ссылка", url]);
    A.toast("Ссылка добавлена");
  },
  dropUrl(id, i) {
    const t = S.tasks.find((x) => x.id === id);
    A.patchTask(id, { urls: ((t && t.urls) || []).filter((_, k) => k !== i) }, ["Ссылка", "убрана"]);
    A.toast("Ссылка убрана");
  },
  dropLink(id, i) {
    S.tasks = S.tasks.map((t) => t.id === id ? { ...t, links: t.links.filter((_, k) => k !== +i) } : t);
    render();
  },
  genTasks(id) {
    const m = S.meetings.find((x) => x.id === id);
    const src = HARVEST[id] || [["Уточнить договорённости по итогам встречи", m.who[0], "2026-09-30"]];
    S.gen = src.map(([t, who, due], i) => ({ i, t, who, due, made: null }));
    S.genFor = id;
    S.sec = "meetings"; S.selKind = "meeting"; S.sel = id; S.dtab = "gen";
    render();
  },
  /* предложенная задача заводится ЧЕРЕЗ ОБЫЧНУЮ ФОРМУ: её правят, дают проект и
     прикладывают ссылки до создания, а не чинят потом в списке */
  genMake(i, f) {
    const g = S.gen.find((x) => x.i === i);
    if (!g || g.made) return;
    const t = mkTask({ id: nextTaskId++, t: f.title, pr: f.pr, st: "open", who: f.who ? [f.who] : [],
      due: f.due || null, prio: f.prio || null, labels: f.labels || [], mk: f.mk || null,
      recur: f.recur || null, priv: !!f.priv || !!(f.labels || []).length, note: f.note || "",
      ping: f.ping || null, urls: f.urls || [], src: S.genFor });
    S.tasks = [t, ...S.tasks];
    S.history = { ...S.history, [t.id]: [{ m: 0, who: ME, k: "Создана", v: "из встречи" }] };
    S.meetings = S.meetings.map((m) => m.id === S.genFor ? { ...m, tasks: [...m.tasks, t.id] } : m);
    S.gen = S.gen.map((x) => x.i === i ? { ...x, made: t.id } : x);
    A.toast(`Задача ${t.id} создана из встречи`);
  },
  genAll() {
    const left = S.gen.filter((g) => !g.made);
    if (!left.length) return A.toast("Все предложенные задачи уже созданы");
    left.forEach((g) => A.genMake(g.i, { title: g.t, who: g.who, due: g.due, pr: null }));
    A.toast(`Создано задач: ${left.length}`);
  },
  saveRole(id, n) {
    if (!n.trim()) return A.toast("Нужно название");
    S.roles = id ? S.roles.map((r) => r.id === id ? { ...r, n } : r) : [...S.roles, { id: uid("ro"), n }];
    A.toast("Роль сохранена");
  },
  delRole(id) {
    S.roles = S.roles.filter((r) => r.id !== id);
    S.tasks = S.tasks.map((t) => t.role === id ? { ...t, role: null } : t);
    A.toast("Роль удалена и снята с задач");
  },
  saveLabel(id, n) {
    if (!n.trim()) return A.toast("Нужно название");
    S.labels = id ? S.labels.map((l) => l.id === id ? { ...l, n } : l) : [...S.labels, { id: uid("l"), n, ic: "tag" }];
    A.toast("Список сохранён");
  },
  delLabel(id) {
    S.labels = S.labels.filter((l) => l.id !== id);
    S.tasks = S.tasks.map((t) => t.labels.includes(id) ? { ...t, labels: t.labels.filter((x) => x !== id) } : t);
    A.toast("Список удалён и снят с задач");
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
