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
  /* У задач вкладок времени больше нет: срок виден группами в самом списке, а
     «регулярные» и «архив» стали тумблерами в «Ещё» — вместо двух строк шапки одна */
  projects: [["list", "Список"], ["map", "Карта проектов"]],
  /* «Доска» перестала быть вкладкой: список и канбан — два вида одного спринта,
     переключатель стоит в полосе цикла (канон 18.09 и первоисточник владельца) */
  /* «Инициативы» отдельным видом сняты владельцем 19.09, «Сверка» переехала отметками
     в строку состава — в продукте виды спринта ровно эти */
  sprints: [["sprint", "Спринт"], ["timeline", "Таймлайн"], ["analytics", "Аналитика"], ["journal", "Журнал"]],
  /* «Вычитка» перестала быть вкладкой: она шапка общего экрана встреч — то, что ждёт
     человека, не должно лежать на соседней вкладке */
  base: [["all", "Все записи"], ["meeting", "Встречи"], ["document", "Документы"], ["note", "Заметки"],
         ["transcript", "Транскрипты"], ["summary", "Сводки"], ["link", "Ссылки"], ["files", "Файлы"]],
  team: [["members", "Участники"], ["ws", "Воркспейсы"]],
  settings: [["profile", "Профиль"], ["integr", "Интеграции"], ["tokens", "Доступы"], ["notif", "Уведомления"],
    ["labels", "Списки"], ["roles", "Роли задач"]],
  admin: [["users", "Пользователи"], ["ws", "Воркспейсы"], ["review", "Очередь вычитки"],
    ["queue", "Встречи от агента"], ["broadcast", "Рассылка"], ["feedback", "Фидбек"]],
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
  base: (id) => id === "files" ? S.files.length : visibleEntries(id).length,
  admin: (id) => id === "feedback" ? S.feedback.filter((f) => f.st === "open").length
    : id === "review" ? S.meetings.filter((m) => m.st === "pending").length : null,
};

function renderNav() {
  const badge = { tasks: countToday(), meetings: visibleMeetings("review").length + S.queue.length };
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
  /* объявление об обновлении — полоса продукта: страница перезагрузится сама, и человек
     должен знать, почему у него сейчас дёрнется экран */
  $(".deploy").innerHTML = S.deploy
    ? `Идёт обновление — страница перезагрузится сама<button class="x" ${act("tgl", "deploy")}>Скрыть</button>` : "";
  $(".deploy").classList.toggle("open", !!S.deploy);
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
  /* один тумблер вместо трёх чипов: он добавляет/убирает завершённые, живое остаётся всегда */
  "tgl-done": () => { const s = new Set(S.statuses); s.has("done") ? s.delete("done") : s.add("done");
    A.set({ statuses: s }); },
  tgl: (k) => A.set({ [k]: !S[k] }),
  "set-view": (_, v) => A.set({ sprintView: v }),
  sfocus: (_, v) => A.set({ sFocus: v || null }),
  "set-group": (_, v) => A.set({ group: v }),
  "set-space": (id) => { S.space = id; S.cycle = (S.cycles.find((c) => c.sp === id) || {}).id || null; A.set({}); },
  "new-space": () => modal("Новое пространство", fld("Название", input("n", "", "Например: Маркетинг")),
    `${btn("Отмена", "mclose")}${btn("Создать", "do-space", undefined, undefined, "pri")}`),
  "do-space": () => { const f = formData(); closeModal(); A.addSpace(f.n); },
  "new-sprint": () => modal("Новый спринт", fld("Название", input("n", "", "Например: Спринт 14")),
    `${btn("Отмена", "mclose")}${btn("Создать", "do-sprint", undefined, undefined, "pri")}`),
  "do-sprint": () => { const f = formData(); closeModal(); A.addSprint(f.n); },
  "rename-sprint": (id) => modal("Переименовать спринт", fld("Название", input("n", (S.cycles.find((c) => c.id === id) || {}).n || "")),
    `${btn("Отмена", "mclose")}${btn("Сохранить", "do-rename-sprint", id, undefined, "pri")}`),
  "do-rename-sprint": (id) => { const f = formData(); closeModal(); A.renameSprint(id, f.n); },
  "del-sprint": (id) => { const c = S.cycles.find((x) => x.id === id) || {};
    const n = S.items.filter((i) => i.c === id).length;
    modal("Удалить спринт?", `<div class="hint">Спринт <b>${esc(c.n || "")}</b> исчезнет. Задачи не удалятся — из спринта выйдет: ${n}.</div>`,
      `${btn("Оставить", "mclose")}${btn("Удалить спринт", "do-del-sprint", id, undefined, "pri")}`); },
  "do-del-sprint": (id) => { closeModal(); A.delSprint(id); },
  "start-sprint": (id) => A.startSprint(id),
  /* приёмка спрашивает: состав замрёт слепком, незакрытое переедет — отменить будет нечем */
  "accept-sprint": (id) => { const tail = S.items.filter((i) => i.c === id
      && (S.tasks.find((t) => t.id === i.t) || {}).st !== "done").length;
    modal("Принять спринт?", `<div class="hint">Итоги посчитаются один раз, состав замрёт слепком.${
      tail ? ` Незакрытых задач переедет в следующий спринт: ${tail}.` : " Незакрытых задач нет."}</div>
      ${fld("Что получилось, что нет (необязательно)", area("sum", ""))}`,
      `${btn("Отмена", "mclose")}${btn("Принять спринт", "do-accept-sprint", id, undefined, "pri")}`); },
  "do-accept-sprint": (id) => { const f = formData(); closeModal(); A.acceptSprint(id, f.sum); },
  "set-chk": (id, v) => A.setCheck(+id, v),
  "tgl-carry": (id) => { const i = S.items.find((x) => x.c === S.cycle && x.t === +id) || {};
    if (i.carry) { A.toggleCarry(+id); return; }
    modal("Перенести в следующий спринт?", fld("Почему переносится (необязательно)", input("r", "", "Например: не хватило времени")),
      `${btn("Отмена", "mclose")}${btn("Пометить", "do-carry", id, undefined, "pri")}`); },
  "do-carry": (id) => { const f = formData(); closeModal(); A.toggleCarry(+id, f.r); },
  "take-item": (id) => A.takeItem(+id),
  "drop-item": (id) => A.dropItem(+id),
  "pool-pr": (_, v) => A.set({ poolPr: v || "" }),
  "pool-who": (_, v) => A.set({ poolWho: v ? +v : "" }),
  "copy-report": (id) => A.toast("Итоги скопированы в буфер"),
  "open-task": (id) => A.select("task", +id),
  "open-meet": (id) => { S.sec = "meetings"; A.select("meeting", id); },
  "open-entry": (id) => A.select("entry", id),
  "open-file": (id) => A.select("file", id),
  "open-proj": (id) => A.select("project", id),
  "proj-tasks": (id) => { S.sec = "tasks"; S.archOn = false; S.recurOnly = false; S.q = proj(id).n; A.set({}); },
  "new-task": () => newTaskModal(),
  "create-task": () => { const f = formData(); if (!f.title) return A.toast("Нужно название");
    closeModal(); A.createTask({ title: f.title, pr: f.pr, who: f.who ? +f.who : null, due: f.due, prio: f.prio,
      labels: f.labels, mk: (f.mk || [])[0] || null, recur: f.recur || null, priv: f.priv || !!(f.labels || []).length, note: f.note,
      urls: urlList(f.urls),
      ping: f.ping || null }); },
  "reset-filters": () => A.set({ lens: "all", statuses: new Set(Object.keys(ST_LABEL)),
    mk: null, assignee: null, q: "", noProject: false, recurOnly: false, archOn: false, period: "any" }),
  "drop-no-project": () => A.set({ noProject: false }),
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
  "set-role": (id, v) => A.patchTask(+id, { role: v || null }, ["Роль", v ? roleName(v) : "снята"]),
  "add-role": () => roleModal(null),
  "rename-role": (id) => roleModal(id),
  "save-role": (id) => { const f = formData(); closeModal(); A.saveRole(id || null, f.n); },
  "del-role": (id) => { const r = S.roles.find((x) => x.id === id) || {};
    const n = S.tasks.filter((t) => t.role === id).length;
    modal("Удалить роль?", `<div class="hint">Роль <b>${esc(r.n || "")}</b> будет снята с задач: ${n}. Вернуть её придётся руками.</div>`,
      `${btn("Оставить", "mclose")}${btn("Удалить роль", "do-del-role", id, undefined, "pri")}`); },
  "do-del-role": (id) => { closeModal(); A.delRole(id); },
  /* быстрый срок и пинг прямо из строки: значение — сдвиг в днях от сегодня, пустое снимает */
  "set-due-q": (id, v) => A.patchTask(+id, { due: v === "" ? null : shiftDate(+v) },
    ["Срок", v === "" ? "снят" : fmtDate(shiftDate(+v))]),
  "set-ping-q": (id, v) => A.patchTask(+id, { ping: v === "" ? null : shiftDate(+v), pinged: false },
    ["Напоминание", v === "" ? "снято" : fmtDate(shiftDate(+v))]),
  "set-ping": (id) => {},           /* дата приходит событием change, как и срок */
  "drop-ping": (id) => A.setPing(+id, null),
  "set-period": (_, v) => A.set(v === "range"
    /* «свой период» без дат ничего не сужает: по умолчанию берём ближайшие две недели,
       чтобы фильтр сразу показывал результат, а не пустой экран */
    ? { period: v, from: S.from || TODAY, to: S.to || addDays(TODAY, 14) } : { period: v }),
  "range-days": (_, v) => A.set({ period: "range", from: TODAY, to: addDays(TODAY, +v) }),
  /* Списки в продукте ЛИЧНЫЕ: выбор списка делает задачу личной (TaskModal: «if (labelIds.length
     && !task.is_private) patch.is_private = true»). Иначе личный список одного человека
     уехал бы в общий список чужими глазами. */
  "add-url": (id) => { const el = document.querySelector(`[data-uin="${id}"]`);
    if (!el) return; A.addUrl(+id, el.value); },
  "drop-url": (id, v) => A.dropUrl(+id, +v),
  "tgl-label": (id, v) => { const t = S.tasks.find((x) => x.id === +id);
    const next = t.labels.includes(v) ? t.labels.filter((l) => l !== v) : [...t.labels, v];
    A.patchTask(+id, next.length && !t.priv ? { labels: next, priv: true } : { labels: next },
      next.length > t.labels.length ? ["Список", (label(v) || {}).n] : undefined); },
  "tgl-priv": (id) => { const t = S.tasks.find((x) => x.id === +id); A.patchTask(+id, { priv: !t.priv }); },
  "tgl-sub": (id, v) => A.toggleSub(+id, +v),
  comment: (id) => { const ta = $(`[data-cin="${id}"]`); A.comment(+id, ta.value); },
  "add-base": (id, v) => A.addToBase(id, v),
  "confirm-meet": (id) => A.confirmMeeting(id),
  "publish-draft": (id) => publishModal(id),
  "do-publish": (id) => { const f = formData(); closeModal(); A.publishDraft(id, f.title); },
  compare: (id) => compareModal(id),
  extract: (id) => A.extractTasks(id),
  "edit-tez": (id) => tezisyModal(id),
  "tez-edit": (id) => A.set({ tezEdit: id, dtab: "tez" }),
  "tez-cancel": () => A.set({ tezEdit: null }),
  "tez-save": (id) => { const box = $(`[data-tezbox="${id}"]`); if (box) A.saveTezHtml(id, box.innerHTML); },
  /* Оформление даём тем же механизмом, что и браузерное поле ввода: execCommand помечен
     устаревшим, но это единственный способ без редакторного движка, и для стенда он
     показывает ровно то поведение, которое нужно проверить. */
  fmt: (id, k) => { const box = $(`[data-tezbox="${id}"]`); if (!box) return;
    box.focus();
    const cmd = { b: "bold", i: "italic", u: "underline", s: "strikeThrough",
      ul: "insertUnorderedList", x: "removeFormat" }[k];
    if (cmd) return document.execCommand(cmd, false, null);
    if (k === "a") { const sel = String(document.getSelection());
      if (!sel) return A.toast("Выделите текст, который станет ссылкой");
      const url = prompt("Адрес ссылки", "https://");
      if (url) document.execCommand("createLink", false, url); } },
  "regen": (id, v) => A.regenTezisy(id, v),
  "regen-own": (id) => modal("Что поменять в тезисах", fld("Своё пожелание", input("w", "", "Например: выделить договорённости с поставщиком")),
    `${btn("Отмена", "mclose")}${btn("Переобработать", "do-regen-own", id, undefined, "pri")}`),
  "do-regen-own": (id) => { const f = formData(); closeModal(); A.regenTezisy(id, "own", f.w); },
  "copy-tez": (id) => A.copyTez(id),
  "rename-meet": (id) => modal("Изменить название", fld("Название встречи", input("n", (S.meetings.find((m) => m.id === id) || {}).t || "")),
    `${btn("Отмена", "mclose")}${btn("Сохранить название", "do-rename-meet", id, undefined, "pri")}`),
  "do-rename-meet": (id) => { const f = formData(); closeModal(); A.renameMeeting(id, f.n); },
  "del-meet": (id) => { const m = S.meetings.find((x) => x.id === id) || {};
    modal("Удалить встречу?", `<div class="hint">Встреча <b>${esc(m.t || "")}</b> и её расшифровка исчезнут без возможности восстановить.</div>`,
      `${btn("Оставить", "mclose")}${btn("Удалить встречу", "do-del-meet", id, undefined, "pri")}`); },
  "do-del-meet": (id) => { closeModal(); A.delMeeting(id); },
  "save-tez": (id) => { const f = formData(); closeModal(); A.editTezisy(id, f.tez); },
  "tgl-mcc": (id, v) => { S.meetings = S.meetings.map((m) => m.id === id
    ? { ...m, cc: m.cc.includes(v) ? m.cc.filter((c) => c !== v) : [...m.cc, v] } : m); render(); },
  "q-accept": (id, v) => A.queueAccept(id, v || "shared"),
  "q-reject": (id) => { const q = S.queue.find((x) => x.id === id) || {};
    modal("Отклонить предложение?", `<div class="hint">Встреча <b>${esc(clip(q.t || "", 48))}</b> и предложенные к ней задачи в базу не попадут. Агент их не переспросит.</div>`,
      `${btn("Вернуться", "mclose")}${btn("Отклонить", "do-q-reject", id, undefined, "pri")}`); },
  "do-q-reject": (id) => { closeModal(); A.queueReject(id); },
  "new-entry": () => newEntryModal(),
  "create-entry": () => { const f = formData(); if (!f.title) return A.toast("Нужно название");
    closeModal(); A.createEntry({ ty: f.ty, title: f.title, text: f.text, cc: f.cc, priv: f.priv, file: f.file }); },
  "reindex-entry": (id) => A.reindex("entry", id),
  "task-from-entry": (id) => A.taskFromEntry(id),
  "download-file": (id) => A.toast(`Файл скачивается: ${(S.files.find((f) => f.id === id) || {}).n || ""}`),
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
    A.set({ archOn: false, recurOnly: false, lens: "all", mk: null, q: "", assignee: null, noProject: true,
      staff: me().role === "admin", statuses: new Set(Object.keys(ST_LABEL)) }); },
  "new-project": () => modal("Новый проект", fld("Название", input("n", "", "Например: Открытие BA")),
    `${btn("Отмена", "mclose")}${btn("Создать", "do-project", undefined, undefined, "pri")}`),
  "do-project": () => { const f = formData(); closeModal(); A.addProject(f.n); },
  "new-subproject": (id) => modal("Новый подпроект", fld("Название", input("n", "", "Например: Оборудование")),
    `${btn("Отмена", "mclose")}${btn("Создать", "do-subproject", id, undefined, "pri")}`),
  "do-subproject": (id) => { const f = formData(); closeModal(); A.addSubproject(id, f.n); },
  "toggle-proj": (id) => A.toggleProject(id),
  "set-board": (id) => A.set({ boardTab: id }),
  "new-board": () => modal("Новая вкладка доски", fld("Название", input("n", "", "Например: Операции")),
    `${btn("Отмена", "mclose")}${btn("Создать", "do-board", undefined, undefined, "pri")}`),
  "do-board": () => { const f = formData(); closeModal(); A.addBoard(f.n); },
  "del-board": (id) => { const b = S.boards.find((x) => x.id === id) || {};
    const n = S.projects.filter((p) => p.b === id).length;
    modal("Удалить вкладку?", `<div class="hint">Вкладка <b>${esc(b.n || "")}</b> исчезнет. Проекты и задачи останутся${n ? `, но проектов уйдёт из вкладки: ${n}` : ""}.</div>`,
      `${btn("Оставить", "mclose")}${btn("Удалить вкладку", "do-del-board", id, undefined, "pri")}`); },
  "do-del-board": (id) => { closeModal(); A.delBoard(id); },
  "toggle-open": (id) => { const s = new Set(S.openProj); s.has(id) ? s.delete(id) : s.add(id); A.set({ openProj: s }); },
  "toggle-sub-proj": (id) => { const s = new Set(S.subClosed); s.has(id) ? s.delete(id) : s.add(id); A.set({ subClosed: s }); },
  "pause-proj": (id) => A.togglePause(id),
  "rename-board": (id) => { const b = S.boards.find((x) => x.id === id) || {};
    modal("Переименовать вкладку", fld("Название", input("n", b.n || "")),
      `${btn("Отмена", "mclose")}${btn("Сохранить", "do-rename-board", id, undefined, "pri")}`); },
  "do-rename-board": (id) => { const f = formData(); closeModal(); A.renameBoard(id, f.n); },
  "proj-priv": (id) => A.toggleProjPriv(id),
  "rename-proj": (id) => modal("Переименовать проект", fld("Название", input("n", (proj(id) || {}).n || "")),
    `${btn("Отмена", "mclose")}${btn("Сохранить", "do-rename-proj", id, undefined, "pri")}`),
  "do-rename-proj": (id) => { const f = formData(); closeModal(); A.renameProject(id, f.n); },
  "del-proj": (id) => { const p = proj(id) || {};
    const kids = S.projects.filter((x) => x.parent === id).length;
    const n = projectTasks(id).length;
    modal("Удалить проект?", `<div class="hint">Проект <b>${esc(p.n || "")}</b>${kids ? ` и подпроектов: ${kids}` : ""} исчезнет. Задачи не удалятся — без проекта останется: ${n}.</div>`,
      `${btn("Оставить", "mclose")}${btn("Удалить проект", "do-del-proj", id, undefined, "pri")}`); },
  "do-del-proj": (id) => { closeModal(); A.delProject(id); },
  "person-tasks": (id) => { A.go("tasks"); S.assignee = +id; S.lens = "all"; S.archOn = false; S.recurOnly = false;
    if (me().role === "admin") S.staff = true;   /* чужие задачи видны только админу */
    render(); },
  "drop-assignee": () => { S.assignee = null; render(); },
  "switch-ws": (id) => A.switchWorkspace(id),
  "not-dup": (id) => A.notDup(id),
  "q-task-off": (id, v) => A.queueTaskOff(id, v),
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
  "team-tasks": () => { A.go("tasks"); A.set({ lens: "team", archOn: false, recurOnly: false, q: "", assignee: null }); },
  "granola-import": () => A.importGranola(),
  "dig-period": (_, v) => A.set({ digPeriod: v }),
  "dig-mk": (_, v) => A.set({ digMk: S.digMk.includes(v) ? S.digMk.filter((x) => x !== v) : [...S.digMk, v] }),
  "cal-connect": () => { S.cal = "on"; A.set({}); A.toast("Календарь подключён — встречи дня подтянутся"); },
  "open-integr": (id) => A.select("integr", id),
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
  remind: (id) => A.toast(`Напоминание отправлено: ${user(+id).n}`),
  "show-all": (_, v) => { closePal(); S.aq = v; S.sec = "search"; A.set({}); },
  "gen-tasks": (id) => A.genTasks(id),
  "gen-open": (id) => genTaskModal(+id),
  "gen-save": (i) => { const f = formData(); closeModal();
    A.genMake(+i, { title: f.title, pr: f.pr, who: +f.who || null, due: f.due, prio: f.prio || null,
      labels: f.labels, mk: (f.mk || [])[0] || null, recur: f.recur || null, priv: f.priv,
      note: f.note, ping: f.ping || null, urls: urlList(f.urls) }); },
  "gen-all": () => A.genAll(),
  "gen-close": () => { S.gen = []; S.genFor = null; S.dtab = "tez"; A.set({}); },
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

/* Меню внутри таблицы обрезалось предком с overflow:hidden — кнопка нажималась, меню
   открывалось, и его не было видно: чип выглядел мёртвым (найдено по жалобе владельца
   21.09 «чипы у задач не рабочие»). Если хоть один предок режет, меню переводим в
   координаты экрана и держим у кнопки. */
function clipsMenu(m) {
  for (let e = m.parentElement; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.overflow !== "visible" || s.overflowX !== "visible" || s.overflowY !== "visible") return true;
  }
  return false;
}
function placeMenu(d) {
  const m = d.querySelector(".dmenu");
  if (!m || !clipsMenu(m)) return;
  m.classList.add("floated");
  const r = d.getBoundingClientRect(), mb = m.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), window.innerWidth - mb.width - 8);
  const below = r.bottom + 4, fits = below + mb.height < window.innerHeight - 8;
  m.style.left = Math.round(left) + "px";
  m.style.top = Math.round(fits ? below : Math.max(8, r.top - mb.height - 4)) + "px";
}
function unplaceMenu(d) {
  const m = d.querySelector(".dmenu");
  if (!m) return;
  m.classList.remove("floated"); m.style.left = ""; m.style.top = "";
}
/* Экран уехал — приколотое к координатам меню осталось бы висеть над чужой строкой. */
document.addEventListener("scroll", () => document.querySelectorAll(".drop.open")
  .forEach((d) => { d.classList.remove("open"); unplaceMenu(d); }), true);

document.addEventListener("click", (e) => {
  /* Меню живёт на нажатии: чужие закрываем всегда, своё переключаем. Пока оно держалось
     на :hover/:focus-within, после клика по кнопке меню оставалось висеть, и убрать его
     кликом по пустому месту было нельзя. */
  const inMenu = e.target.closest(".dmenu");
  const trigger = inMenu ? null : e.target.closest(".drop");
  document.querySelectorAll(".drop.open").forEach((d) => { if (d !== trigger) { d.classList.remove("open"); unplaceMenu(d); } });
  if (trigger) { trigger.classList.toggle("open");
    trigger.classList.contains("open") ? placeMenu(trigger) : unplaceMenu(trigger); }
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
  if (!t) {
    $$(".pop,.dig,.menu").forEach((p) => p.classList.remove("open"));
    /* Клик по пустому месту слева закрывает выехавшую панель: она лежит поверх экрана,
       и единственным выходом был крестик в дальнем углу — владелец 21.09: «из этого
       положения нельзя выйти кликом по пустому месту, это контринтуитивно».
       Порядок обратный порядку открытия: сперва то, что лежит сверху. */
    if (!e.target.closest(".detail,.pool,.modal,.pal,.toast")) {
      if (S.selKind) A.close();
      else if (S.poolOpen) A.set({ poolOpen: false });
    }
    return;
  }
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
  if (t && t.dataset.act === "set-ping") A.setPing(+t.dataset.id, e.target.value || null);
});
document.addEventListener("keydown", (e) => {
  /* Esc закрывает открытое меню — вторая дорога для тех, кто не целится мышью в пустоту */
  if (e.key === "Escape" && document.querySelector(".drop.open")) {
    document.querySelectorAll(".drop.open").forEach((d) => d.classList.remove("open"));
    return;
  }
  /* быстрый ввод задачи в колонке доски */
  const qa = e.target.dataset && e.target.dataset.qadd;
  if (qa && e.key === "Enter" && e.target.value.trim()) {
    const title = e.target.value.trim();
    const sec = e.target.dataset.qsec || null;                 /* доска проектов: секция = проект */
    A.createTask({ title, pr: sec, who: ME, due: null, prio: null, labels: [], mk: null, recur: null, priv: false, note: "" });
    A.patchTask(S.sel, { st: qa });
    /* на канбане спринта карточка обязана попасть и в СОСТАВ спринта: поле у задачи
       состава не заменяет, иначе новая карточка исчезала при первой перерисовке */
    if (!sec) A.takeItem(S.sel);
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
