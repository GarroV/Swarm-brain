/* Каркас: навигация, шапка, маршрут, один обработчик действий на всё приложение. */

const NAV = [
  { g: "Работа", items: [
    { id: "tasks", n: "Задачи", ic: "M2 8l4 4 8-9" },
    { id: "projects", n: "Проекты", ic: "M1.5 3h13v10h-13zM1.5 6.5h13M6 6.5V13" },
    { id: "sprints", n: "Спринты", ic: "M2 13V7M6 13V3M10 13V9M14 13V5" } ] },
  { g: "Знание", items: [
    { id: "meetings", n: "Встречи", ic: "M2 4h12v10H2zM2 7h12M5 2v3M11 2v3" },
    { id: "base", n: "База", ic: "M3 2h10v12H3zM5.5 5h5M5.5 8h5M5.5 11h3" } ] },
  { g: "Люди", items: [
    { id: "team", n: "Команда", ic: "M5.5 7a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4zM1.8 13c0-2 1.7-3.4 3.7-3.4S9.2 11 9.2 13M11 5.2a1.9 1.9 0 100 3.8M11.6 9.8c1.6.2 2.6 1.4 2.6 3" } ] },
];
const NAVFOOT = [
  { id: "settings", n: "Настройки", ic: "M8 10a2 2 0 100-4 2 2 0 000 4zM8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6L3.5 3.5" },
  { id: "admin", n: "Админ", ic: "M8 1.8l5.2 2v3.4c0 3-2.2 5.6-5.2 6.9-3-1.3-5.2-3.9-5.2-6.9V3.8z" },
  { id: "map", n: "Карта системы", ic: "M3.4 4.6a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2zM12.6 14.6a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2zM3.4 4.6V9a2 2 0 002 2h5.6" },
];
const TABS = {
  tasks: [["today", "Сегодня"], ["upcoming", "Ближайшие"], ["all", "Все"], ["recurring", "Регулярные"], ["archive", "Архив"]],
  projects: [["list", "Список"], ["map", "Карта проектов"]],
  sprints: [["board", "Доска"], ["timeline", "Таймлайн"], ["pool", "Инициативы"], ["check", "Чек цикла"], ["analytics", "Аналитика"], ["journal", "Журнал"]],
  meetings: [["review", "Вычитка"], ["all", "Все встречи"], ["draft", "Черновики bumblebee"], ["queue", "Очередь агента"]],
  base: [["all", "Все записи"], ["meeting", "Встречи"], ["document", "Документы"], ["note", "Заметки"],
         ["transcript", "Транскрипты"], ["summary", "Сводки"], ["link", "Ссылки"], ["files", "Файлы"]],
  team: [["members", "Участники"], ["ws", "Воркспейсы"]],
  settings: [["profile", "Профиль"], ["integr", "Интеграции"], ["tokens", "Доступы"], ["notif", "Уведомления"], ["columns", "Колонки доски"], ["labels", "Метки"]],
  admin: [["users", "Пользователи"], ["ws", "Воркспейсы"], ["review", "Очередь вычитки"], ["broadcast", "Рассылка"], ["feedback", "Фидбек"]],
};
const TITLES = {
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
  $(".nav-scroll").innerHTML = NAV.map((g) => `<div class="grp">${g.g}</div>` + g.items.map(item).join("")).join("");
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
  tasks: screenTasks, projects: screenProjects, sprints: screenSprints, meetings: screenMeetings,
  base: screenBase, team: screenTeam, settings: screenSettings, admin: screenAdmin,
  map: screenMap, answer: screenAnswer, search: screenSearch,
};

function render() {
  renderNav();
  const [crumb, title] = TITLES[S.sec] || ["", S.sec];
  $(".crumb").textContent = crumb; $("h1").textContent = title;
  if (TABS[S.sec]) { $(".tabs").classList.remove("hidden"); renderTabs(); } else $(".tabs").classList.add("hidden");
  $(".body").innerHTML = SCREENS[S.sec]();
  renderDetail();
  const unread = S.notif.filter((n) => n.unread).length;
  $(".bell .b").textContent = unread || "";
  $(".bell .b").style.display = unread ? "" : "none";
  $(".toast").textContent = S.toast || "";
  $(".toast").classList.toggle("open", !!S.toast);
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
  "bulk-clear": () => A.set({ bulk: new Set() }),
  "bulk-assign": (id) => A.bulk("assign", +id),
  "bulk-due": (_, v) => A.bulk("due", v),
  "bulk-status": (_, v) => A.bulk("status", v),
  "bulk-label": (_, v) => A.bulk("label", v),
  "bulk-archive": () => A.bulk("archive"),
  take: (id) => A.takeTask(+id),
  move: (id, v) => A.moveTask(+id, v),
  archive: (id) => A.archiveTask(+id),
  restore: (id) => A.restoreTask(+id),
  "set-prio": (id, v) => A.patchTask(+id, { prio: v }, `приоритет: ${PRIO_LABEL[v]}`),
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
  "merge-dup": (id) => A.mergeDup(id),
  "keep-dup": (id) => A.keepDup(id),
  "q-accept": (id, v) => A.queueAccept(id, v || "shared"),
  "q-reject": (id) => A.queueReject(id),
  "new-entry": () => newEntryModal(),
  "create-entry": () => { const f = formData(); if (!f.title) return A.toast("Нужно название");
    closeModal(); A.createEntry({ ty: f.ty, title: f.title, text: f.text, cc: f.cc, priv: f.priv, file: f.file }); },
  "reindex-entry": (id) => A.reindex("entry", id),
  "reindex-file": (id) => A.reindex("file", id),
  "del-entry": (id) => A.deleteEntry(id),
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
  "accept-init": (id) => A.acceptInitiative(id),
  "drop-init": (id) => A.dropInitiative(id),
  "close-cycle": () => A.closeCycle(),
  "col-move": (_, v) => { const [i, d] = v.split(":").map(Number), j = i + d;
    if (j < 0 || j >= S.cols.length) return; const n = [...S.cols]; [n[i], n[j]] = [n[j], n[i]]; A.set({ cols: n }); },
  "col-tgl": (_, v) => A.set({ cols: S.cols.map((c, k) => k === +v ? { ...c, on: !c.on } : c) }),
  integr: (id) => A.toggleIntegration(id),
  broadcast: () => broadcastModal(),
  "do-broadcast": () => { const f = formData(); closeModal(); A.broadcast(f.text, f.to); },
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
  "do-accept": (id) => { const f = formData(); closeModal();
    S.initiatives = S.initiatives.map((i) => i.id === id ? { ...i, st: "accepted", own: +f.own, pts: +f.pts } : i);
    A.toast("Инициатива принята в цикл"); },
  remind: (id) => A.toast(`Напоминание отправлено: ${user(+id).n}`),
  "show-all": (_, v) => { closePal(); S.aq = v; S.sec = "search"; A.set({}); },
  harvest: (id) => harvestModal(id),
  "do-harvest": (id, n) => { const f = formData(); closeModal();
    const items = []; for (let i = 0; i < +n; i++) if (f["on" + i]) items.push({ t: f["t" + i], who: +f["w" + i], due: f["d" + i] });
    if (!items.length) return A.toast("Ничего не выбрано");
    A.harvest(id, items); },
  "review-next": (id) => reviewNext(id),
  reader: (id) => readerModal(id),
  "add-label": () => labelModal(null),
  "rename-label": (id) => labelModal(id),
  "del-label": (id) => A.delLabel(id),
  "save-label": (id) => { const f = formData(); closeModal(); A.saveLabel(id || null, f.n); },
  "user-profile": (id) => userModal(id),
  "new-user": () => userModal(null),
  "set-cycle": (id) => { S.cycle = id; render(); },
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
  if (pickChip) { pickChip.classList.toggle("on"); return; }
  const swEl = e.target.closest("[data-sw]");
  if (swEl) { swEl.classList.toggle("on"); return; }
  const t = e.target.closest("[data-act]");
  if (!t) { $$(".pop,.dig,.menu").forEach((p) => p.classList.remove("open")); return; }
  const a = t.dataset.act;
  if (!ACTS[a]) return;
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
});
document.addEventListener("keydown", (e) => {
  /* быстрый ввод задачи в колонке доски */
  const qa = e.target.dataset && e.target.dataset.qadd;
  if (qa && e.key === "Enter" && e.target.value.trim()) {
    const title = e.target.value.trim();
    A.createTask({ title, pr: "p1", who: ME, due: null, prio: "med", labels: [], mk: null, recur: null, priv: false, note: "" });
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
  if (e.key === "Enter") {
    const t = e.target.closest("[data-act='set-due']");
    if (t) A.patchTask(+t.dataset.id, { due: e.target.value || null }, "сменил срок");
  }
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
      + grp("База", r.entries.map((x) => `<div class="r" ${act("open-entry", x.id)}><span class="t">${esc(x.h)}</span><span class="s">${esc(x.p.slice(0, 60))}</span></div>`))
      + grp("Файлы", r.files.map((f) => `<div class="r" ${act("open-file", f.id)}><span class="t">${esc(f.n)}</span><span class="s">${f.sz}</span></div>`))
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
  render();
});
