/* Каркас: навигация, шапка, маршрут, один обработчик действий на всё приложение. */

/* Рейка — плоский список папок: надпункты («Работа», «Знание») владелец снял 20.09.2026
   как лишний уровень. «Карта системы» убрана: такого экрана в продукте нет. */
const NAV = [
  { id: "home", n: "Главная", ic: "M2 7.4L8 2.4l6 5v6.2H9.8V9.6H6.2v4H2z" },
  { id: "tasks", n: "Задачи", ic: "M2 8l4 4 8-9" },
  { id: "projects", n: "Проекты", ic: "M1.5 3h13v10h-13zM1.5 6.5h13M6 6.5V13" },
  { id: "sprints", n: "Спринты", ic: "M2 13V7M6 13V3M10 13V9M14 13V5" },
  { id: "meetings", n: "Встречи", ic: "M2 4h12v10H2zM2 7h12M5 2v3M11 2v3" },
  { id: "base", n: "База", ic: "M3 2h10v12H3zM5.5 5h5M5.5 8h5M5.5 11h3" },
  { id: "team", n: "Команда", ic: "M5.5 7a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4zM1.8 13c0-2 1.7-3.4 3.7-3.4S9.2 11 9.2 13M11 5.2a1.9 1.9 0 100 3.8M11.6 9.8c1.6.2 2.6 1.4 2.6 3" },
];
const NAVFOOT = [
  { id: "settings", n: "Настройки", ic: "M8 10a2 2 0 100-4 2 2 0 000 4zM8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6L3.5 3.5" },
  { id: "admin", n: "Админ", ic: "M8 1.8l5.2 2v3.4c0 3-2.2 5.6-5.2 6.9-3-1.3-5.2-3.9-5.2-6.9V3.8z" },
];
const TABS = {
  tasks: [["today", "Сегодня"], ["upcoming", "Ближайшие"], ["all", "Все"], ["recurring", "Регулярные"], ["archive", "Архив"]],
  projects: [["list", "Список"], ["map", "Карта проектов"]],
  sprints: [["board", "Доска"], ["timeline", "Таймлайн"], ["pool", "Инициативы"], ["check", "Чек цикла"], ["analytics", "Аналитика"], ["journal", "Журнал"]],
  /* «Вычитка» перестала быть вкладкой: она шапка общего экрана встреч — то, что ждёт
     человека, не должно лежать на соседней вкладке */
  meetings: [["all", "Все встречи"], ["draft", "Черновики bumblebee"], ["queue", "Очередь агента"]],
  base: [["all", "Все записи"], ["meeting", "Встречи"], ["document", "Документы"], ["note", "Заметки"],
         ["transcript", "Транскрипты"], ["summary", "Сводки"], ["link", "Ссылки"], ["files", "Файлы"]],
  team: [["members", "Участники"], ["ws", "Воркспейсы"]],
  settings: [["profile", "Профиль"], ["integr", "Интеграции"], ["tokens", "Доступы"], ["notif", "Уведомления"], ["columns", "Колонки доски"], ["labels", "Метки"]],
  admin: [["users", "Пользователи"], ["ws", "Воркспейсы"], ["review", "Очередь вычитки"], ["broadcast", "Рассылка"], ["feedback", "Фидбек"]],
};
const TITLES = {
  home: ["", "Главная"],
  tasks: ["Работа", "Задачи"], projects: ["Работа", "Проекты"], sprints: ["Работа", "Спринты"],
  meetings: ["Знание", "Встречи"], base: ["Знание", "База"], team: ["Люди", "Команда"],
  settings: ["Система", "Настройки"], admin: ["Система", "Админ"], map: ["Система", "Карта системы"],
  answer: ["Поиск", "Ответ по базе"], search: ["Поиск", "Результаты поиска"],
};
const firstTab = (sec) => TABS[sec] ? TABS[sec][0][0] : null;

const TAB_COUNT = {
  tasks: (id) => countList(id),
  meetings: (id) => id === "queue" ? S.queue.length : visibleMeetings(id).length,
  base: (id) => id === "files" ? S.files.length : visibleEntries(id).length,
  admin: (id) => id === "feedback" ? S.feedback.filter((f) => f.st === "open").length
    : id === "review" ? S.meetings.filter((m) => m.st === "pending").length : null,
  sprints: (id) => id === "pool" ? S.initiatives.filter((i) => i.st === "proposed").length : null,
};

function renderNav() {
  const badge = { tasks: countList("today"), meetings: visibleMeetings("review").length + S.queue.length };
  const item = (x) => `<div class="item${x.id === S.sec ? " on" : ""}" ${act("sec", x.id)} tabindex="0">
    <svg class="ic" viewBox="0 0 16 16"><path d="${x.ic}"/></svg>${x.n}${badge[x.id] ? `<span class="n">${badge[x.id]}</span>` : ""}</div>`;
  $(".nav-scroll").innerHTML = NAV.map(item).join("");
  $(".nav-foot").innerHTML = NAVFOOT.map(item).join("");
}
function renderTabs() {
  const t = TABS[S.sec] || [];
  $(".tabs").innerHTML = t.map(([id, n]) => {
    const c = TAB_COUNT[S.sec] ? TAB_COUNT[S.sec](id) : null;
    return `<button class="tab${id === S.tab ? " on" : ""}" ${act("tab", id)}>${esc(n)}${c ? `<span class="c">${c}</span>` : ""}</button>`;
  }).join("");
}

const SCREENS = {
  home: screenHome, tasks: screenTasks, projects: screenProjects, sprints: screenSprints, meetings: screenMeetings,
  base: screenBase, team: screenTeam, settings: screenSettings, admin: screenAdmin,
  map: screenMap, answer: screenAnswer, search: screenSearch,
};

function render() {
  renderNav();
  const [, title] = TITLES[S.sec] || ["", S.sec];
  $("h1").textContent = title;
  if (TABS[S.sec]) { $(".tabs").classList.remove("hidden"); renderTabs(); } else $(".tabs").classList.add("hidden");
  $(".body").innerHTML = SCREENS[S.sec]();
  renderDetail();
  const unread = S.notif.filter((n) => n.unread).length;
  $(".bell .b").textContent = unread || "";
  $(".bell .b").style.display = unread ? "" : "none";
  $(".toast").textContent = S.toast || "";
  $(".toast").classList.toggle("open", !!S.toast);
  titleClipped();
  /* счётчик отрисовок: проверяющий ждёт ФАКТА перерисовки, а не «девяносто миллисекунд
     наверное хватит». Фиксированная пауза давала мигающее падение примерно раз на девять
     прогонов — на загруженной машине замер успевал раньше отрисовки. */
  window.__renders = (window.__renders || 0) + 1;
}

/* Плотная таблица режет длинное значение многоточием средствами CSS, и человек видит
   «регулярно ⋯» без возможности узнать, что скрыто. Ширину колонки в разметке не
   предскажешь — её знает только браузер, поэтому после отрисовки проходим по ячейкам
   и тем, что реально не поместились, отдаём полный текст подсказкой. */
function titleClipped() {
  document.querySelectorAll(".body td, .detail td").forEach((td) => {
    const full = td.textContent.trim();
    if (td.scrollWidth > td.clientWidth + 1 && full) td.title = full;
    else if (td.title && td.title === full) td.removeAttribute("title");
  });
}

/* ── один обработчик на все действия ─────────────────────────── */
const ACTS = {
  noop: () => {},
  sec: (id) => A.go(id),
  tab: (id) => A.tab(id),
  close: () => A.close(),
  mclose: () => closeModal(),
  dtab: (id) => A.set({ dtab: id }),
  lens: (id) => A.set({ lens: id }),
  "reset-statuses": () => A.set({ statuses: new Set(["open", "in_progress"]) }),
  status: (id) => { const s = new Set(S.statuses); s.has(id) ? s.delete(id) : s.add(id); A.set({ statuses: s }); },
  tgl: (k) => A.set({ [k]: !S[k] }),
  "open-task": (id) => A.select("task", +id),
  "open-meet": (id) => { S.sec = "meetings"; A.select("meeting", id); },
  "open-entry": (id) => A.select("entry", id),
  "open-file": (id) => A.select("file", id),
  "open-proj": (id) => A.select("project", id),
  "proj-tasks": (id) => { S.sec = "tasks"; S.tab = "all"; S.q = proj(id).n; A.set({}); },
  "new-task": () => newTaskModal(),
  "create-task": () => { const f = formData(); if (!f.title) return A.toast("Нужно название");
    closeModal(); A.createTask({ title: f.title, pr: f.pr, who: f.who ? +f.who : null, due: f.due, prio: f.prio,
      labels: f.labels, mk: (f.mk || [])[0] || null, recur: f.recur || null, priv: f.priv, note: f.note }); },
  check: (id, v, e) => { const s = new Set(S.bulk); const n = +id; s.has(n) ? s.delete(n) : s.add(n); A.set({ bulk: s }); },
  "reset-filters": () => A.set({ lens: "all", statuses: new Set(Object.keys(ST_LABEL)),
    mk: null, assignee: null, q: "", noProject: false }),
  "drop-no-project": () => A.set({ noProject: false }),
  "bulk-clear": () => A.set({ bulk: new Set() }),
  "bulk-assign": (id) => A.bulk("assign", +id),
  "bulk-due": (_, v) => A.bulk("due", v),
  "bulk-status": (_, v) => A.bulk("status", v),
  "bulk-label": (_, v) => A.bulk("label", v),
  "bulk-archive": () => A.bulk("archive"),
  "bulk-restore": () => A.bulk("restore"),
  take: (id) => A.takeTask(+id),
  move: (id, v) => A.moveTask(+id, v),
  archive: (id) => A.archiveTask(+id),
  restore: (id) => A.restoreTask(+id),
  /* patchTask ждёт пару [событие, значение]; строка разбиралась по буквам и писала в
     журнал «п: р» — поэтому здесь и ниже пара, а не собранная фраза */
  "set-prio": (id, v) => A.patchTask(+id, { prio: v }, ["Приоритет", PRIO_LABEL[v]]),
  "set-who": (id, v) => A.patchTask(+id, { who: v ? [+v] : [] }, ["Исполнитель", v ? user(+v).n : "снят"]),
  "set-priv": (id, v) => A.patchTask(+id, { priv: !!v }, ["Приватность", v ? "личная" : "общая"]),
  "set-mk": (id, v) => { const t = S.tasks.find((x) => x.id === +id); A.patchTask(+id, { mk: t.mk === v ? null : v }); },
  "set-recur": (id, v) => A.patchTask(+id, { recur: v || null }),
  "tgl-label": (id, v) => { const t = S.tasks.find((x) => x.id === +id);
    A.patchTask(+id, { labels: t.labels.includes(v) ? t.labels.filter((l) => l !== v) : [...t.labels, v] }); },
  "tgl-priv": (id) => { const t = S.tasks.find((x) => x.id === +id); A.patchTask(+id, { priv: !t.priv }); },
  "tgl-sub": (id, v) => A.toggleSub(+id, +v),
  comment: (id) => { const ta = $(`[data-cin="${id}"]`); A.comment(+id, ta.value); },
  "confirm-meet": (id) => A.confirmMeeting(id),
  "publish-draft": (id) => publishModal(id),
  "do-publish": (id) => { const f = formData(); closeModal(); A.publishDraft(id, f.title); },
  compare: (id) => compareModal(id),
  extract: (id) => A.extractTasks(id),
  "edit-tez": (id) => tezisyModal(id),
  "save-tez": (id) => { const f = formData(); closeModal(); A.editTezisy(id, f.tez); },
  "set-store": (id, v) => { S.meetings = S.meetings.map((m) => m.id === id ? { ...m, store: v } : m); render(); },
  "tgl-mcc": (id, v) => { S.meetings = S.meetings.map((m) => m.id === id
    ? { ...m, cc: m.cc.includes(v) ? m.cc.filter((c) => c !== v) : [...m.cc, v] } : m); render(); },
  "merge-dup": (id) => { const m = S.meetings.find((x) => x.id === id) || {};
    const to = S.meetings.find((x) => x.id === m.dupOf) || {};
    modal("Объединить с встречей?", `<div class="hint">Черновик <b>${esc(clip(m.t || "", 48))}</b> исчезнет, его текст уйдёт в <b>${esc(clip(to.t || "встречу", 48))}</b>. Разъединить будет нечем.</div>`,
      `${btn("Оставить как есть", "mclose")}${btn("Объединить", "do-merge-dup", id, undefined, "pri")}`); },
  "do-merge-dup": (id) => { closeModal(); A.mergeDup(id); },
  "keep-dup": (id) => A.keepDup(id),
  "q-accept": (id, v) => A.queueAccept(id, v || "shared"),
  "q-reject": (id) => { const q = S.queue.find((x) => x.id === id) || {};
    modal("Отклонить предложение?", `<div class="hint">Встреча <b>${esc(clip(q.t || "", 48))}</b> и предложенные к ней задачи в базу не попадут. Агент их не переспросит.</div>`,
      `${btn("Вернуться", "mclose")}${btn("Отклонить", "do-q-reject", id, undefined, "pri")}`); },
  "do-q-reject": (id) => { closeModal(); A.queueReject(id); },
  "new-entry": () => newEntryModal(),
  "create-entry": () => { const f = formData(); if (!f.title) return A.toast("Нужно название");
    closeModal(); A.createEntry({ ty: f.ty, title: f.title, text: f.text, cc: f.cc, priv: f.priv, file: f.file }); },
  "reindex-entry": (id) => A.reindex("entry", id),
  "reindex-file": (id) => A.reindex("file", id),
  /* удаление без спроса: запись держит целую расшифровку, метка снимается сразу с N задач,
     инициатива исчезает вместе с предложенными задачами. Спрашиваем, как у задачи. */
  "del-entry": (id) => { const e = S.entries.find((x) => x.id === id) || {};
    modal("Удалить запись?", `<div class="hint">Запись <b>${esc(e.h || "")}</b> исчезнет вместе с текстом и файлами. Отменить будет нечем.</div>`,
      `${btn("Оставить", "mclose")}${btn("Удалить навсегда", "do-del-entry", id, undefined, "pri")}`); },
  "do-del-entry": (id) => { closeModal(); A.deleteEntry(id); },
  "del-task": (id) => modal("Удалить навсегда?", `<div class="hint">Задача <b>${esc((S.tasks.find((t) => t.id === +id) || {}).t || "")}</b> исчезнет вместе с комментариями и историей. Отменить будет нечем.</div>`,
    `${btn("Оставить", "mclose")}${btn("Удалить навсегда", "do-del-task", id, undefined, "pri")}`),
  "do-del-task": (id) => { closeModal(); A.deleteTask(id); },
  "edit-entry": (id) => { const e = S.entries.find((x) => x.id === id);
    modal("Править запись", `${fld("Заголовок", input("h", e.h))}${fld("Фрагмент", area("p", e.p))}`,
      `${btn("Отмена", "mclose")}${btn("Сохранить", "do-edit-entry", id, undefined, "pri")}`); },
  "do-edit-entry": (id) => { const f = formData(); closeModal(); A.editEntry(id, { h: f.h, p: f.p }); },
  "replace-file": (id) => modal("Заменить файл", `${fld("Имя нового файла", input("n", "", "смета-v3.pdf"))}
    <div class="hint">Ссылка на файл не изменится, индекс пересоберётся.</div>`,
    `${btn("Отмена", "mclose")}${btn("Заменить", "do-replace-file", id, undefined, "pri")}`),
  "do-replace-file": (id) => { const f = formData(); closeModal(); A.replaceFile(id, f.n); },
  /* с карты — в список задач без проекта: узел обязан куда-то вести, иначе он декорация */
  /* с карты — в список задач без проекта. Статусы тоже раскрываем: узел на карте считает
     ВСЕ живые задачи ветки, и приход по нему обязан показать столько же, а не «ноль»
     из-за того, что список по умолчанию прячет закрытые. */
  "tasks-no-project": () => { A.go("tasks");
    /* карта считает ВСЮ работу воркспейса, а список по умолчанию показывает только мою и
       общую (канон линз). Чтобы узел не обещал больше, чем покажет, приход по нему
       включает админский оверсайт и раскрывает статусы — тогда число сходится. */
    A.set({ tab: "all", lens: "all", mk: null, q: "", assignee: null, noProject: true,
      staff: me().role === "admin", statuses: new Set(Object.keys(ST_LABEL)) }); },
  "new-project": () => modal("Новый проект", fld("Название", input("n", "", "Например: Открытие BA")),
    `${btn("Отмена", "mclose")}${btn("Создать", "do-project", undefined, undefined, "pri")}`),
  "do-project": () => { const f = formData(); closeModal(); A.addProject(f.n); },
  "new-subproject": (id) => modal("Новый подпроект", fld("Название", input("n", "", "Например: Оборудование")),
    `${btn("Отмена", "mclose")}${btn("Создать", "do-subproject", id, undefined, "pri")}`),
  "do-subproject": (id) => { const f = formData(); closeModal(); A.addSubproject(id, f.n); },
  "toggle-proj": (id) => A.toggleProject(id),
  "person-tasks": (id) => { A.go("tasks"); S.assignee = +id; S.lens = "all"; S.tab = "all";
    if (me().role === "admin") S.staff = true;   /* чужие задачи видны только админу */
    render(); },
  "drop-assignee": () => { S.assignee = null; render(); },
  "switch-ws": (id) => A.switchWorkspace(id),
  "not-dup": (id) => A.notDup(id),
  "q-task-off": (id, v) => A.queueTaskOff(id, v),
  "carry-over": () => A.carryOver(),
  "regen-tez": (id) => { const ta = $(".modal [data-f=\"tez\"]");
    if (ta) ta.value = ta.value.replace(/\s+$/, "") + "\n\nПереписано моделью: формулировки сведены к решениям и договорённостям, повторы убраны.";
    A.toast("Модель переписала тезисы — проверьте и сохраните"); },
  "tgl-epriv": (id) => { S.entries = S.entries.map((e) => e.id === id ? { ...e, priv: !e.priv } : e); render(); },
  "tgl-ecc": (id, v) => { S.entries = S.entries.map((e) => e.id === id
    ? { ...e, cc: e.cc.includes(v) ? e.cc.filter((c) => c !== v) : [...e.cc, v] } : e); render(); },
  "b-cc": (_, v) => A.set({ bcc: v }),
  "b-mine": () => A.set({ bmine: !S.bmine }),
  "mf-period": (_, v) => { S.mf = { ...S.mf, period: v }; render(); },
  "mf-src": (_, v) => { const s = S.mf.src; S.mf = { ...S.mf, src: s.includes(v) ? s.filter((x) => x !== v) : [...s, v] }; render(); },
  "mf-cc": (_, v) => { const s = S.mf.cc; S.mf = { ...S.mf, cc: s.includes(v) ? s.filter((x) => x !== v) : [...s, v] }; render(); },
  "mf-people": (_, v) => { const s = S.mf.people, n = +v; S.mf = { ...S.mf, people: s.includes(n) ? s.filter((x) => x !== n) : [...s, n] }; render(); },
  "mf-store": (_, v) => { S.mf = { ...S.mf, store: v }; render(); },
  "mf-st": (_, v) => { S.mf = { ...S.mf, st: v }; render(); },
  "mf-clear": () => { S.mf = { q: "", period: "all", cc: [], src: [], people: [], store: "any", st: "any" }; render(); },
  "drop-init": (id) => { const i = S.initiatives.find((x) => x.id === id) || {};
    modal("Снять инициативу?", `<div class="hint">Предложение <b>${esc(i.t || "")}</b> уйдёт из списка вместе с предложенными задачами.</div>`,
      `${btn("Оставить", "mclose")}${btn("Снять", "do-drop-init", id, undefined, "pri")}`); },
  "do-drop-init": (id) => { closeModal(); A.dropInitiative(id); },
  "close-cycle": () => { const c = cycle();
    const tail = S.tasks.filter((t) => t.sprint === c.id && t.st !== "done" && !t.arch).length;
    modal("Закрыть цикл?", `<div class="hint">Цикл <b>${esc(c.n)}</b> станет закрытым${tail ? `, а незакрытых задач переедет в следующий: ${tail}` : ", незакрытых задач в нём нет"}. Открыть обратно будет нечем.</div>`,
      `${btn("Не закрывать", "mclose")}${btn("Закрыть цикл", "do-close-cycle", undefined, undefined, "pri")}`); },
  "do-close-cycle": () => { closeModal(); A.closeCycle(); },
  "col-move": (_, v) => { const [i, d] = v.split(":").map(Number), j = i + d;
    if (j < 0 || j >= S.cols.length) return; const n = [...S.cols]; [n[i], n[j]] = [n[j], n[i]]; A.set({ cols: n }); },
  "col-tgl": (_, v) => A.set({ cols: S.cols.map((c, k) => k === +v ? { ...c, on: !c.on } : c) }),
  integr: (id) => A.toggleIntegration(id),
  broadcast: () => broadcastModal(),
  "do-broadcast": () => { const f = formData(); closeModal(); A.broadcast(f.text, f.to); },
  "fb-open": () => A.set({ fbo: !S.fbo }),
  "resolve-fb": (id) => A.resolveFeedback(id),
  fab: () => feedbackModal(),
  "send-fb": () => { const f = formData(); closeModal(); A.addFeedback((f.cat || [])[0] || "other", f.text); },
  "new-ws": () => wsModal(),
  "do-ws": () => { const f = formData(); closeModal(); A.addWorkspace(f.id, f.name); },
  "mk-filter": (_, v) => A.set({ mk: v }),
  "add-link": (id) => linkModal(id),
  "do-link": (id) => { const f = formData(); closeModal(); A.addLink(+id, f.other, f.kind); },
  "drop-link": (id, v) => A.dropLink(+id, v),
  "accept-init": (id) => acceptModal(id),
  "do-accept": (id) => { const f = formData(); closeModal(); A.acceptInitiative(id, { own: +f.own, pts: +f.pts }); },
  remind: (id) => A.toast(`Напоминание отправлено: ${user(+id).n}`),
  "show-all": (_, v) => { closePal(); S.aq = v; S.sec = "search"; A.set({}); },
  harvest: (id) => harvestModal(id),
  "do-harvest": (id, n) => { const f = formData();
    const items = []; for (let i = 0; i < +n; i++) if (f["on" + i]) items.push({ t: f["t" + i], who: +f["w" + i], due: f["d" + i] });
    /* окно закрываем ПОСЛЕ проверки: иначе снятые галочки и правки исчезали вместе с ним */
    if (!items.length) return A.toast("Ничего не выбрано — отметьте хотя бы одну задачу");
    closeModal(); A.harvest(id, items); },
  "review-next": (id) => reviewNext(id),
  reader: (id) => readerModal(id),
  "add-label": () => labelModal(null),
  "rename-label": (id) => labelModal(id),
  "del-label": (id) => { const l = label(id) || {};
    const n = S.tasks.filter((t) => t.labels.includes(id)).length;
    modal("Удалить метку?", `<div class="hint">Метка <b>${esc(l.n || "")}</b> будет снята с задач: ${n}. Вернуть её придётся руками.</div>`,
      `${btn("Оставить", "mclose")}${btn("Удалить метку", "do-del-label", id, undefined, "pri")}`); },
  "do-del-label": (id) => { closeModal(); A.delLabel(id); },
  "save-label": (id) => { const f = formData(); closeModal(); A.saveLabel(id || null, f.n); },
  "user-profile": (id) => userModal(id),
  /* подпись обещает привязку почты — значит и делает её, а не открывает карточку целиком */
  "bind-mail": (id) => { const u = user(+id);
    modal("Привязать почту", `${fld("Рабочая почта", input("em", "", "ime@imf.example"))}
      <div class="hint">Почта нужна, чтобы <b>${esc(u.n)}</b> попадал в очередь вычитки по своим встречам.</div>`,
      `${btn("Отмена", "mclose")}${btn("Привязать", "do-bind-mail", id, undefined, "pri")}`); },
  "do-bind-mail": (id) => { const f = formData(); closeModal();
    if (!f.em || !f.em.includes("@")) { A.toast("Почта не похожа на почту — не привязана"); return; }
    A.saveUser(+id, { em: f.em }); },
  "new-user": () => userModal(null),
  "set-cycle": (id) => { S.cycle = id; render(); },
  "notif-pref": (id) => A.toggleNotifPref(id),
  reissue: (id) => A.reissueToken(id),
  tz: (_, v) => { S.tz = v; A.toast(`Часовой пояс: ${v}`); },
  "reset-cols": () => { const own = S.cols.filter((c) => !["open", "in_progress", "done"].includes(c.id)).length;
    modal("Вернуть колонки по умолчанию?", `<div class="hint">Останутся три исходные колонки. Добавленных вами колонок пропадёт: ${own}.</div>`,
      `${btn("Оставить", "mclose")}${btn("Вернуть", "do-reset-cols", undefined, undefined, "pri")}`); },
  "do-reset-cols": () => { closeModal(); A.resetCols(); },
  "add-col": () => modal("Новая колонка доски", fld("Название", input("n", "", "Например: На проверке")),
    `${btn("Отмена", "mclose")}${btn("Добавить", "do-add-col", undefined, undefined, "pri")}`),
  "do-add-col": () => { const f = formData(); closeModal(); A.addCol(f.n); },
  "mcp-guide": () => modal("Подключение Claude Desktop", `
    <div class="hint">Добавьте блок в <code>claude_desktop_config.json</code> и перезапустите Claude Desktop.</div>
    <pre class="cmd">"swarm-brain": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "https://swarm-brain.pages.dev/mcp"],
  "env": { "SWARM_TOKEN": "${esc(S.tokens[0].v)}" }
}</pre>`, `${btn("Закрыть", "mclose")}${btn("Скопировать токен", "copy", undefined, S.tokens[0].v, "pri")}`),
  "tgl-nomail": () => { S.noMailOnly = !S.noMailOnly; render(); },
  "save-user": (id) => { const f = formData(); closeModal();
    A.saveUser(id, { n: f.n, role: f.role, em: f.em, tg: f.tg, mk: (f.mk || [])[0] || "RS", note: f.note }); },
  "rec-install": () => recorderModal("install"),
  "rec-update": () => recorderModal("update"),
  copy: (_, v) => { navigator.clipboard && navigator.clipboard.writeText(v).catch(() => {}); closeModal(); A.toast("Скопировано в буфер"); },
  "read-one": (i) => A.readOne(i),
  theme: () => A.theme(),
  lang: () => A.lang(),
  readall: () => A.readAll(),
  bell: () => { $(".pop").classList.toggle("open"); $(".dig").classList.remove("open"); $(".menu").classList.remove("open"); },
  dig: () => { $(".dig").classList.toggle("open"); $(".pop").classList.remove("open"); $(".menu").classList.remove("open"); },
  memenu: () => { $(".menu").classList.toggle("open"); $(".pop").classList.remove("open"); $(".dig").classList.remove("open"); },
  search: () => openPal(),
  ask: (_, v) => { closePal(); S.q = ""; S.sec = "answer"; S.aq = v; A.set({}); },
  logout: () => A.toast("Выход из аккаунта (в стенде — заглушка)"),
};

document.addEventListener("click", (e) => {
  const pickChip = e.target.closest("[data-pick] .chip");
  if (pickChip) {
    const box = pickChip.closest("[data-pick]");
    if (box.hasAttribute("data-one")) {
      box.querySelectorAll(".chip.on").forEach((c) => c.classList.remove("on"));
      pickChip.classList.add("on");
    } else pickChip.classList.toggle("on");
    return;
  }
  const swEl = e.target.closest("[data-sw]");
  if (swEl) { swEl.classList.toggle("on"); return; }
  const t = e.target.closest("[data-act]");
  if (!t) { $$(".pop,.dig,.menu").forEach((p) => p.classList.remove("open")); return; }
  const a = t.dataset.act;
  /* у полей формы действие обрабатывают слушатели input/change — клик им не нужен;
     у всего остального неизвестное действие означает молча мёртвую кнопку */
  if (!ACTS[a]) { if (!/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) console.error("нет обработчика действия: " + a); return; }
  e.stopPropagation();
  const fromPal = !!t.closest(".pal");
  ACTS[a](t.dataset.id, t.dataset.v, e);
  if (fromPal) closePal();
});
document.addEventListener("input", (e) => {
  const q = e.target.dataset.qin;
  if (q === "tasks") { S.q = e.target.value; const p = e.target.selectionStart; render();
    const n = $('[data-qin="tasks"]'); if (n) { n.focus(); n.setSelectionRange(p, p); } }
  if (q === "base") { S.bq = e.target.value; const p = e.target.selectionStart; render();
    const n = $('[data-qin="base"]'); if (n) { n.focus(); n.setSelectionRange(p, p); } }
  if (q === "search") { S.aq = e.target.value; const p = e.target.selectionStart; render();
    const n = $('[data-qin="search"]'); if (n) { n.focus(); n.setSelectionRange(p, p); } }
  if (q === "meet") { S.mf = { ...S.mf, q: e.target.value }; const p = e.target.selectionStart; render();
    const n = $('[data-qin="meet"]'); if (n) { n.focus(); n.setSelectionRange(p, p); } }
});
document.addEventListener("change", (e) => {
  const t = e.target.closest("[data-act]");
  if (t && t.dataset.act === "set-assignee") A.patchTask(+t.dataset.id, { who: e.target.value ? [+e.target.value] : [] }, "сменил исполнителя");
  /* срок сохраняется по выбору даты, а не по нажатию Enter: про Enter никто не догадается,
     и правка молча пропадала при закрытии панели */
  if (t && t.dataset.act === "set-due") A.patchTask(+t.dataset.id, { due: e.target.value || null }, ["Срок", e.target.value ? fmtDate(e.target.value) : "снят"]);
});
document.addEventListener("keydown", (e) => {
  /* быстрый ввод задачи в колонке доски */
  const qa = e.target.dataset && e.target.dataset.qadd;
  if (qa && e.key === "Enter" && e.target.value.trim()) {
    const title = e.target.value.trim();
    A.createTask({ title, pr: null, who: ME, due: null, prio: "med", labels: [], mk: null, recur: null, priv: false, note: "" });
    A.patchTask(S.sel, { st: qa, sprint: S.cycle });
    A.close();
    return;
  }
  /* палитра: стрелками и Enter */
  if ($(".pal").classList.contains("open") && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
    const items = $$(".pal .r");
    if (items.length) {
      const cur = items.findIndex((x) => x.classList.contains("on"));
      if (e.key === "Enter") { e.preventDefault();
        if (cur >= 0) items[cur].click(); else { const v = $("#q").value; if (v) ACTS.ask(null, v); }
        return; }
      if (e.key !== "Enter") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? Math.min(cur + 1, items.length - 1) : Math.max(cur - 1, 0);
        items.forEach((x) => x.classList.remove("on"));
        items[next < 0 ? 0 : next].classList.add("on");
        items[next < 0 ? 0 : next].scrollIntoView({ block: "nearest" });
        return;
      }
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPal(); }
  if (e.key === "Escape") { closePal(); closeModal(); if (S.sel) A.close(); }

});

/* ── палитра ⌘K ──────────────────────────────────────────────── */
function openPal() { $(".scrim").classList.add("open"); $(".pal").classList.add("open"); $("#q").value = ""; palResults(""); $("#q").focus(); }
function closePal() { $(".scrim").classList.remove("open"); $(".pal").classList.remove("open"); }
function palResults(q) {
  const r = searchAll(q);
  const grp = (n, items) => items.length ? `<div class="grp">${n}</div>` + items.join("") : "";
  const html = q.trim()
    ? grp("Задачи", r.tasks.map((t) => `<div class="r" ${act("open-task", t.id)}><span class="t">${esc(t.t)}</span><span class="s">${esc(projPath(t.pr))} · ${ST_LABEL[t.st]}</span></div>`))
      + grp("Встречи", r.meetings.map((m) => `<div class="r" ${act("open-meet", m.id)}><span class="t">${esc(m.t)}</span><span class="s">${esc(fmtDT(m.dt))} · ${m.src}</span></div>`))
      + grp("База", r.entries.map((x) => `<div class="r" ${act("open-entry", x.id)}><span class="t">${esc(x.h)}</span><span class="s">${esc(clip(x.p, 60))}</span></div>`))
      + grp("Файлы", r.files.map((f) => `<div class="r" ${act("open-file", f.id)}><span class="t">${esc(f.n)}</span><span class="s">${fsz(f.kb)}</span></div>`))
      + `<div class="grp">Действия</div>`
      + `<div class="r" ${act("show-all", undefined, q)}><span class="t">Показать все результаты</span><span class="s">отдельным экраном, с разбивкой по типам</span></div>`
      + `<div class="r ask" ${act("ask", undefined, q)}><span class="t">Спросить базу: «${esc(q)}»</span><span class="s">ответ со ссылками на источники</span></div>`
    : `<div class="grp">Быстрые действия</div>
       <div class="r" ${act("new-task")}><span class="t">Новая задача</span></div>
       <div class="r" ${act("new-entry")}><span class="t">Новая запись в базу</span></div>
       <div class="r" ${act("sec", "meetings")}><span class="t">Очередь вычитки</span></div>`;
  $(".res").innerHTML = html;
}

window.addEventListener("DOMContentLoaded", () => {
  $("#q").addEventListener("input", (e) => palResults(e.target.value));
  $(".scrim").addEventListener("click", closePal);
  $(".mscrim").addEventListener("click", closeModal);
  renderHeaderPopovers();
  /* набор колонок зависит от ширины — без этого после ресайза таблица остаётся с прежними */
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 120); });
  render();
});
