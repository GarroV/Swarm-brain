/* Поверхности, которых не хватало: сбор задач из встречи, вычитка подряд,
   чтение записи целиком, редактор меток, профиль в админке, команды рекордера, таймлайн. */

/* ── что модель предлагает по встрече (список для «Сгенерировать задачи») ── */
const HARVEST = {
  m1: [["Свести смету по позициям к планёрке", 501, "2026-09-22"], ["Запросить у поставщика фиксацию цены", 503, "2026-09-21"]],
  m2: [["Подготовить договор к подписанию", 503, "2026-09-24"], ["Согласовать сроки поставки с франчайзи", 510, "2026-09-22"]],
  m3: [["Свести бюджет Q4 к финальной версии", 503, "2026-10-03"], ["Проверить расходы по Черногории", 509, "2026-09-28"]],
};
/* ── чтение записи целиком ───────────────────────────────────── */
function readerModal(id) {
  const e = S.entries.find((x) => x.id === id);
  const full = e.full || e.p;
  modal(e.h, `<div class="reader">${full.split("\n\n").map((x) => `<p>${esc(x)}</p>`).join("")}</div>`,
    `${btn("Закрыть", "mclose")}${btn("Править", "edit-entry", id)}${btn("Скопировать текст", "copy", undefined, e.p)}`, true);
}

/* ── редактор меток ──────────────────────────────────────────── */
function screenLabels() {
  return `<div class="panes"><div class="pane"><h3>Списки</h3>
    <div class="sub">Личные списки: задача, попавшая в список, становится личной — её видит только владелец</div>
    ${rows(S.labels.map((l) => [tag(l.n, "l"),
      nTasks(S.tasks.filter((t) => t.labels.includes(l.id)).length),
      `<span class="ib">${btn("Переименовать", "rename-label", l.id, undefined, "sm")}${btn("Удалить", "del-label", l.id, undefined, "sm")}</span>`]))}
    <div class="mt">${btn("Добавить список", "add-label", undefined, undefined, "pri")}</div></div></div>`;
}

/* Справочник ролей задач. В продукте набор зашит в код и поле скрыто — настроить роли
   нельзя, поэтому ими и не пользуются. Здесь роль заводится и снимается из настроек. */
function screenRoles() {
  return `<div class="panes"><div class="pane"><h3>Роли задач</h3>
    <div class="sub">Чья это работа по смыслу: развитие, маркетинг, R&D. Роль ставится в задаче и сужает списки</div>
    ${rows(S.roles.map((r) => [esc(r.n),
      nTasks(S.tasks.filter((t) => t.role === r.id).length),
      `<span class="ib">${btn("Переименовать", "rename-role", r.id, undefined, "sm")}${btn("Удалить", "del-role", r.id, undefined, "sm")}</span>`]))}
    <div class="mt">${btn("Добавить роль", "add-role", undefined, undefined, "pri")}</div></div></div>`;
}
function roleModal(id) {
  const r = S.roles.find((x) => x.id === id);
  modal(r ? "Переименовать роль" : "Новая роль", fld("Название", input("n", r ? r.n : "", "например, операции")),
    `${btn("Отмена", "mclose")}${btn("Сохранить", "save-role", id || "", undefined, "pri")}`);
}
function labelModal(id) {
  const l = id ? label(id) : null;
  modal(l ? "Переименовать список" : "Новый список", fld("Название", input("n", l ? l.n : "", "например, закупки")),
    `${btn("Отмена", "mclose")}${btn("Сохранить", "save-label", id || "", undefined, "pri")}`);
}

/* ── профиль пользователя в админке ──────────────────────────── */
function userModal(id) {
  const u = id ? user(+id) : { n: "", role: "ops", em: "", tg: "", mk: "RS", note: "" };
  modal(id ? `Профиль · ${u.n}` : "Новый сотрудник", `
    <div class="two">${fld("Имя", input("n", u.n, "Имя и фамилия"))}${fld("Роль", select("role", Object.entries(ROLE), u.role))}</div>
    <div class="two">${fld("Почта", input("em", u.em, "нужна для очереди вычитки"))}${fld("Telegram", input("tg", u.tg, "@username"))}</div>
    ${fld("Рынок", pick("mk", COUNTRIES.map((c) => [c.c, c.n]), [u.mk], true))}
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
  /* Таймлайн живёт под полосой цикла — значит показывает ЗАДАЧИ ЦИКЛА, как доска,
     чек и аналитика. Раньше он брал всё, у чего срок попал в даты окна, и печатал
     «Задач со сроком 27» там, где на соседней вкладке стояло «Задач в цикле 12». */
  const seen = (t) => !t.arch && S.statuses.has(t.st) && inLens(t, S.lens) && t.due;
  const list = cycleTasks().filter(seen).sort((a, b) => a.due.localeCompare(b.due));
  /* работа с датой внутри окна, но мимо цикла, не исчезает молча — её считают отдельно */
  const outside = S.tasks.filter((t) => seen(t) && t.sprint !== c.id && t.due >= c.from && t.due <= c.to).length;
  const note = outside ? `<span>Со сроком в эти даты, но вне цикла: <b>${outside}</b></span>` : "";
  const days = [...new Set(list.map((t) => t.due))];
  if (!days.length) return sprintBar(`<span>Задач со сроком <b>0</b></span>${note}`)
    + empty("В этом цикле нет задач со сроком", "Выберите другой цикл или поставьте задачам даты");
  return sprintBar(`<span>Задач со сроком <b>${list.length}</b></span>${note}`) + `<div class="tlv">${days.map((day) => {
    const items = list.filter((t) => t.due === day);
    /* день красный только пока в нём есть незакрытая задача: у сделанной срок уже ничего не требует */
    const late = dueKind(day) === "now" && items.some((t) => t.st !== "done");
    return `<div class="tday${late ? " late" : ""}"><div class="tdh">${fmtDate(day)}<span class="n">${items.length}</span></div>
      <div class="tditems">${items.map((t) => `<div class="tdi" ${act("open-task", t.id)}>${dot(t.st)}${priMark(t.prio)}<b>${esc(t.t)}</b>
        <span class="pj">${esc(projPath(t.pr))}</span>
        <span class="mt">${lbls(t.labels)}${t.recur ? tag(RECUR_LABEL[t.recur], "p") : ""}</span>
        <span class="mk">${t.mk ? `<span class="cc">${t.mk}</span>` : `<span class="muted">—</span>`}</span>
        <span class="who">${t.who.length ? avShort(t.who[0]) : `<span class="muted">—</span>`}</span></div>`).join("")}</div></div>`;
  }).join("")}</div>`;
}

/* ── календарь дня (Google Calendar) ─────────────────────────── */
/* Встречи дня — колонкой сбоку. Горизонтальной полосой они забирали всю ширину сверху
   и толкали работу вниз; вертикальным блоком стоят рядом и ничего не отжимают. */
/* В строке ровно то, по чему решают «идти или нет»: время, название, площадка,
   кнопка и «идёт сейчас» (решение владельца 22.09.2026 — «по сути нужны только
   название, упоминание какая платформа, кнопка "подключиться" и статус "идет
   сейчас"»). Аватары участников и состояние рекордера («рекордер включится» /
   «без записи») убраны: на решение зайти в звонок они не влияют, а строку дробят.
   Состояние записи по-прежнему видно там, где им занимаются, — в диагностике
   встреч (`screens-system.js`) и на панели встречи. */
const NOW_HM = "11:12";
const isNow = (c) => c.at <= NOW_HM && NOW_HM < c.to;

function calendarList() {
  /* календарь может быть не подключён или доступ по нему истечь: пустой список в этом
     случае читается как «встреч сегодня нет», а это враньё — и человек не узнает,
     что чинить. Состояние называем словом и даём дорогу. */
  if (S.cal === "off") return `<div class="calv"><div class="cnone"><b>Календарь не подключён</b>
    <span>Встречи дня и запуск рекордера берутся из Google Calendar</span>
    ${btn("Подключить календарь", "cal-connect", undefined, undefined, "pri sm")}</div></div>`;
  if (S.cal === "expired") return `<div class="calv"><div class="cnone"><b>Доступ к календарю истёк</b>
    <span>Google отозвал разрешение — встречи дня сейчас не приходят</span>
    ${btn("Переподключить", "cal-connect", undefined, undefined, "pri sm")}</div></div>`;
  if (!CALENDAR.length) return `<div class="calv"><div class="cnone"><b>Сегодня встреч нет</b>
    <span>Календарь подключён — день свободен</span></div></div>`;
  /* Из календаря человек идёт НА ВСТРЕЧУ: без ссылки он лезет искать её в Google
     Calendar или в почте, и опаздывает (просьба владельца 21.09). У встречи без ссылки
     кнопки нет — пустая кнопка «Перейти» хуже отсутствующей. */
  return `<div class="calv">${CALENDAR.map((c) => `<div class="cev${isNow(c) ? " now" : ""}">
    <span class="at">${c.at}</span><b>${esc(c.t)}</b>
    ${c.url ? `<a class="cgo${isNow(c) ? " now" : ""}" href="${esc(c.url)}" target="_blank" rel="noreferrer"
      title="Открыть ${esc(c.place)}">${isNow(c) ? "Подключиться" : "Перейти"}</a>` : `<span></span>`}
    <div class="cf"><span class="pl">${esc(c.place)}</span>
    ${isNow(c) ? state("идёт сейчас", true) : ""}</div></div>`).join("")}</div>`;
}

/* ── связи задачи ────────────────────────────────────────────── */
/* длиннее списка в выпадающем окне не выбирают — дальше ищут поиском */
const LINK_OPTIONS = 24;
function linkModal(id) {
  const others = S.tasks.filter((t) => t.id !== +id && !t.arch).slice(0, LINK_OPTIONS);
  modal("Связать задачи", `
    ${fld("Тип связи", select("kind", [["блокирует", "блокирует"], ["заблокирована", "заблокирована"], ["связана", "связана"], ["дубль", "дубль"]], "связана"))}
    ${fld("С какой задачей", select("other", others.map((t) => [String(t.id), `${t.id} · ${t.t}`]), String(others[0] && others[0].id)))}`,
    `${btn("Отмена", "mclose")}${btn("Связать", "do-link", id, undefined, "pri")}`);
}


/* ── админ: счётчики вычитки ─────────────────────────────────── */
function screenReviewCounts() {
  const pend = S.meetings.filter((m) => m.st === "pending");
  const byUser = S.users.map((u) => [u, pend.filter((m) => m.who.includes(u.id)).length]).filter(([, n]) => n);
  /* это счётчик, а не фильтр: чипом он прикидывался включённым и никого не отфильтровывал */
  /* 3 встречи дают 8 строк: одна встреча ждёт вычитки у каждого участника.
     Без второго числа экран выглядит так, будто счётчики спорят между собой. */
  const seats = byUser.reduce((n, [, k]) => n + k, 0);
  return `<div class="bar"><span>Невычитано встреч <b>${pend.length}</b></span>
    <div class="right"><span>Ждут вычитки у людей: <b>${seats}</b> — одна встреча приходит каждому участнику</span></div></div>`
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
  const shown = r.tasks.length + r.meetings.length + r.entries.length + r.files.length;
  const CAP_NAME = { tasks: "задач", meetings: "встреч", entries: "записей базы", files: "файлов" };
  return `<div class="bar"><input class="qin" style="min-width:320px" placeholder="Что ищем" value="${esc(q)}" data-qin="search">
    <div class="right"><span>Найдено <b>${r.total}</b>${r.total > shown ? `, показано ${shown}` : ""}</span>${btn("Спросить базу", "ask", undefined, q, "sm pri")}</div></div>
    ${r.capped.length ? `<div class="hint pad">Показаны первые: ${r.capped.map((c) => `${CAP_NAME[c.k]} ${c.shown} из ${c.all}`).join(", ")}. Уточните запрос, чтобы увидеть остальное.</div>` : ""}
    ${shown ? `<div class="srch">
      ${r.tasks.length ? lab(`Задачи · ${r.tasks.length}`) + rows(r.tasks.map((t) => [dot(t.st),
        `<span class="lnk" ${act("open-task", t.id)}>${mark(t.t)}</span>`, `${esc(projPath(t.pr))} · ${due(t.due, t.st === "done")}`])) : ""}
      ${r.meetings.length ? lab(`Встречи · ${r.meetings.length}`) + rows(r.meetings.map((m) => [tag(m.src, "m"),
        `<span class="lnk" ${act("open-meet", m.id)}>${mark(m.t)}</span>`, fmtDT(m.dt)])) : ""}
      ${r.entries.length ? lab(`База · ${r.entries.length}`) + rows(r.entries.map((e) => [tag(TY_LABEL[e.ty], "l"),
        `<span class="lnk" ${act("open-entry", e.id)}>${mark(e.h)}</span>`, mark(clip(e.p, 64))])) : ""}
      ${r.files.length ? lab(`Файлы · ${r.files.length}`) + rows(r.files.map((f) => [`<span class="ft ft-${f.ty}">${f.ty}</span>`,
        `<span class="lnk" ${act("open-file", f.id)}>${mark(f.n)}</span>`, fsz(f.kb)])) : ""}
    </div>` : empty("Ничего не нашлось", "Попробуйте другое слово или спросите базу")}`;
}
