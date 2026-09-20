/* Поверхности, которых не хватало: сбор задач из встречи, вычитка подряд,
   чтение записи целиком, редактор меток, профиль в админке, команды рекордера, таймлайн. */

/* ── сбор задач из встречи (TasksHarvestSheet) ───────────────── */
const HARVEST = {
  m1: [["Свести смету по позициям к планёрке", 501, "2026-09-22"], ["Запросить у поставщика фиксацию цены", 503, "2026-09-21"]],
  m2: [["Подготовить договор к подписанию", 503, "2026-09-24"], ["Согласовать сроки поставки с франчайзи", 510, "2026-09-22"]],
  m3: [["Свести бюджет Q4 к финальной версии", 503, "2026-10-03"], ["Проверить расходы по Черногории", 509, "2026-09-28"]],
};
function harvestModal(id) {
  const m = S.meetings.find((x) => x.id === id);
  const items = HARVEST[id] || [["Уточнить договорённости по итогам встречи", m.who[0], "2026-09-30"]];
  modal(`Задачи из встречи «${m.t}»`, `
    <div class="hint">Модель предложила задачи по тезисам. Снимите галочку с лишнего, поправьте исполнителя и срок.</div>
    <div class="hrv">${items.map((it, i) => `<div class="hrow">
      <label class="hck"><input type="checkbox" data-f="on${i}" checked></label>
      <div class="hmain">${input(`t${i}`, it[0])}</div>
      <div class="hwho">${select(`w${i}`, S.users.map((u) => [String(u.id), u.n]), String(it[1]))}</div>
      <div class="hdue">${dateInput(`d${i}`, it[2])}</div></div>`).join("")}</div>`,
    `${btn("Отмена", "mclose")}${btn("Создать выбранные", "do-harvest", id, String(items.length), "pri")}`, true);
}

/* ── вычитка подряд ──────────────────────────────────────────── */
function reviewNext(fromId) {
  const pend = S.meetings.filter((m) => m.st === "pending");
  const next = pend.find((m) => m.id !== fromId) || pend[0];
  if (!next) { A.close(); return A.toast("Вычитка закончена — невычитанных встреч нет"); }
  A.select("meeting", next.id);
}

/* ── чтение записи целиком ───────────────────────────────────── */
function readerModal(id) {
  const e = S.entries.find((x) => x.id === id);
  const full = e.full || e.p;
  modal(e.h, `<div class="reader">${full.split("\n\n").map((x) => `<p>${esc(x)}</p>`).join("")}</div>`,
    `${btn("Закрыть", "mclose")}${btn("Править", "edit-entry", id)}${btn("Скопировать текст", "copy", undefined, e.p)}`, true);
}

/* ── редактор меток ──────────────────────────────────────────── */
function screenLabels() {
  return `<div class="panes"><div class="pane"><h3>Метки задач</h3>
    <div class="sub">Общие для воркспейса: ими помечают задачи и фильтруют списки</div>
    ${rows(S.labels.map((l) => [tag(l.n, "l"),
      nTasks(S.tasks.filter((t) => t.labels.includes(l.id)).length),
      `<span class="ib">${btn("Переименовать", "rename-label", l.id, undefined, "sm")}${btn("Удалить", "del-label", l.id, undefined, "sm")}</span>`]))}
    <div class="mt">${btn("Добавить метку", "add-label", undefined, undefined, "pri")}</div></div></div>`;
}
function labelModal(id) {
  const l = id ? label(id) : null;
  modal(l ? "Переименовать метку" : "Новая метка", fld("Название", input("n", l ? l.n : "", "например, закупки")),
    `${btn("Отмена", "mclose")}${btn("Сохранить", "save-label", id || "", undefined, "pri")}`);
}

/* ── профиль пользователя в админке ──────────────────────────── */
function userModal(id) {
  const u = id ? user(+id) : { n: "", role: "ops", em: "", tg: "", mk: "RS", note: "" };
  modal(id ? `Профиль · ${u.n}` : "Новый сотрудник", `
    <div class="two">${fld("Имя", input("n", u.n, "Имя и фамилия"))}${fld("Роль", select("role", Object.entries(ROLE), u.role))}</div>
    <div class="two">${fld("Почта", input("em", u.em, "нужна для очереди вычитки"))}${fld("Telegram", input("tg", u.tg, "@username"))}</div>
    ${fld("Рынки", pick("mk", COUNTRIES.map((c) => [c.c, c.n]), [u.mk]))}
    ${fld("Заметка админа", area("note", u.note || "", "Что важно знать про этого человека"))}
    <div class="hint">Почта связывает человека с участием во встречах: без неё он не увидит свою очередь вычитки.</div>`,
    `${btn("Отмена", "mclose")}${btn(id ? "Сохранить профиль" : "Добавить", "save-user", id || undefined, undefined, "pri")}`);
}

/* ── команды установки рекордера ─────────────────────────────── */
function recorderModal(kind) {
  const cmd = kind === "update" ? "swarm-rec update --channel stable"
    : "curl -fsSL https://swarm-brain.pages.dev/rec/install.sh | sh -s -- --token smcp_••••••••";
  modal(kind === "update" ? "Обновить bumblebee" : "Установить bumblebee",
    `<div class="hint">Выполните команду в Терминале на ноутбуке, где будете записывать встречи.</div>
     <pre class="cmd">${esc(cmd)}</pre>
     ${rows([["Текущий билд", "24 · от 12 сен"], ["Токен рекордера", "привязан к вашему аккаунту"],
       ["Разрешения macOS", "микрофон и системный звук запросит сам"]])}`,
    `${btn("Закрыть", "mclose")}${btn("Скопировать команду", "copy", undefined, cmd, "pri")}`);
}

/* ── таймлайн задач ──────────────────────────────────────────── */
function screenTimeline() {
  const c = cycle();
  const list = S.tasks.filter((t) => t.due && !t.arch && S.statuses.has(t.st) && inLens(t, S.lens)
      && t.due >= c.from && t.due <= c.to)
    .sort((a, b) => a.due.localeCompare(b.due));
  const days = [...new Set(list.map((t) => t.due))];
  if (!days.length) return cycleBar(`<span>Задач со сроком <b>0</b></span>`)
    + empty("В этом цикле нет задач со сроком", "Выберите другой цикл или поставьте задачам даты");
  return cycleBar(`<span>Задач со сроком <b>${list.length}</b></span>`) + `<div class="tlv">${days.map((day) => {
    const items = list.filter((t) => t.due === day);
    const late = dueKind(day) === "now";
    return `<div class="tday${late ? " late" : ""}"><div class="tdh">${fmtDate(day)}<span class="n">${items.length}</span></div>
      <div class="tditems">${items.map((t) => `<div class="tdi" ${act("open-task", t.id)}>${dot(t.st)}${priMark(t.prio)}<b>${esc(t.t)}</b>
        <span class="pj">${esc(projPath(t.pr))}</span>
        <span class="mt">${lbls(t.labels)}${t.recur ? tag(RECUR_LABEL[t.recur], "p") : ""}</span>
        <span class="mk">${t.mk ? `<span class="cc">${t.mk}</span>` : ""}</span>
        <span class="who">${t.who.length ? avShort(t.who[0]) : `<span class="muted">—</span>`}</span></div>`).join("")}</div></div>`;
  }).join("")}</div>`;
}

/* ── календарь дня (Google Calendar) ─────────────────────────── */
function calendarStrip() {
  if (!CALENDAR.length) return "";
  return `<div class="cal">${CALENDAR.map((c) => `<div class="cev">
    <span class="at">${c.at}</span><b>${esc(c.t)}</b>
    <span class="pl">${esc(c.place)}</span>${avs(c.who)}
    ${c.rec ? state("рекордер включится", true) : state("без записи", false)}</div>`).join("")}</div>`;
}

/* ── связи задачи ────────────────────────────────────────────── */
function linkModal(id) {
  const others = S.tasks.filter((t) => t.id !== +id && !t.arch).slice(0, 24);
  modal("Связать задачи", `
    ${fld("Тип связи", select("kind", [["блокирует", "блокирует"], ["заблокирована", "заблокирована"], ["связана", "связана"], ["дубль", "дубль"]], "связана"))}
    ${fld("С какой задачей", select("other", others.map((t) => [String(t.id), `${t.id} · ${t.t}`]), String(others[0] && others[0].id)))}`,
    `${btn("Отмена", "mclose")}${btn("Связать", "do-link", id, undefined, "pri")}`);
}

/* ── приёмка инициативы в цикл ───────────────────────────────── */
function acceptModal(id) {
  const i = S.initiatives.find((x) => x.id === id);
  modal(`Принять в цикл · ${i.t}`, `
    <div class="two">${fld("Владелец", select("own", S.users.map((u) => [String(u.id), u.n]), String(i.own)))}
      ${fld("Оценка, очков", input("pts", String(i.pts)))}</div>
    ${fld("В какой цикл", select("cyc", CYCLES.map((c) => [c.id, `${c.n} · ${c.st}`]), S.cycle))}
    ${rows(i.tasks.map((t) => [String(t), esc((S.tasks.find((x) => x.id === t) || {}).t || ""), ""]))}
    <div class="hint">Задачи инициативы попадут на доску текущего цикла.</div>`,
    `${btn("Отмена", "mclose")}${btn("Принять", "do-accept", id, undefined, "pri")}`);
}

/* ── админ: счётчики вычитки ─────────────────────────────────── */
function screenReviewCounts() {
  const pend = S.meetings.filter((m) => m.st === "pending");
  const byUser = S.users.map((u) => [u, pend.filter((m) => m.who.includes(u.id)).length]).filter(([, n]) => n);
  /* это счётчик, а не фильтр: чипом он прикидывался включённым и никого не отфильтровывал */
  return `<div class="bar"><span>Невычитано всего <b>${pend.length}</b></span>
    <div class="right"><span>Считается по участию во встрече</span></div></div>`
    + (byUser.length ? table([{ t: "Человек", w: "30%" }, { t: "Почта" }, { t: "Ждёт вычитки", r: true }, { t: "Напомнить", r: true, w: "180px" }],
      byUser.map(([u, n]) => `<tr class="row">${cell(av(u.id), "t")}${cell(u.em ? esc(u.em) : state("не привязана", false))}
        ${cell(`<span class="due">${n}</span>`, "r")}
        ${cell(btn("Напомнить в Telegram", "remind", u.id, undefined, "sm"), "r acts")}</tr>`).join(""))
      : empty("Очередь пуста", "Все встречи вычитаны"));
}

/* ── полный экран поиска ─────────────────────────────────────── */
function screenSearch() {
  const q = S.aq || "";
  const r = searchAll(q);
  /* подсветка совпадения по основе слова: видно, ЗА ЧТО нашлось */
  const mark = (text) => { const st = stem(q.trim().toLowerCase()); if (!st) return esc(text);
    const i = String(text).toLowerCase().indexOf(st); if (i < 0) return esc(text);
    const s0 = String(text);
    let end = i + st.length;
    while (end < s0.length && /[а-яёa-z]/i.test(s0[end])) end++;
    return esc(s0.slice(0, i)) + `<mark>${esc(s0.slice(i, end))}</mark>` + esc(s0.slice(end)); };
  const total = r.tasks.length + r.meetings.length + r.entries.length + r.files.length;
  return `<div class="bar"><input class="qin" style="min-width:320px" placeholder="Что ищем" value="${esc(q)}" data-qin="search">
    <div class="right"><span>Найдено <b>${total}</b></span>${btn("Спросить базу", "ask", undefined, q, "sm pri")}</div></div>
    ${total ? `<div class="srch">
      ${r.tasks.length ? lab(`Задачи · ${r.tasks.length}`) + rows(r.tasks.map((t) => [dot(t.st),
        `<span class="lnk" ${act("open-task", t.id)}>${mark(t.t)}</span>`, `${esc(projPath(t.pr))} · ${due(t.due, t.st === "done")}`])) : ""}
      ${r.meetings.length ? lab(`Встречи · ${r.meetings.length}`) + rows(r.meetings.map((m) => [tag(m.src, "m"),
        `<span class="lnk" ${act("open-meet", m.id)}>${mark(m.t)}</span>`, fmtDT(m.dt)])) : ""}
      ${r.entries.length ? lab(`База · ${r.entries.length}`) + rows(r.entries.map((e) => [tag(TY_LABEL[e.ty], "l"),
        `<span class="lnk" ${act("open-entry", e.id)}>${mark(e.h)}</span>`, mark(e.p.slice(0, 64))])) : ""}
      ${r.files.length ? lab(`Файлы · ${r.files.length}`) + rows(r.files.map((f) => [`<span class="ft ft-${f.ty}">${f.ty}</span>`,
        `<span class="lnk" ${act("open-file", f.id)}>${mark(f.n)}</span>`, esc(f.sz)])) : ""}
    </div>` : empty("Ничего не нашлось", "Попробуйте другое слово или спросите базу")}`;
}
