/* Люди и система: команда, настройки, админ, карта, шапка. */

const ROLE = { admin: "админ", ops: "операции", finance: "финансы", hr: "персонал", it: "IT", quality: "качество", market: "маркетинг" };

function screenTeam() {
  if (S.tab === "ws") return screenWorkspaces();
  const mine = (u) => S.tasks.filter((t) => t.who.includes(u.id) && t.st !== "done" && !t.arch);
  const openOf = (u) => mine(u).length;
  const lateOf = (u) => mine(u).filter((t) => dueKind(t.due) === "now").length;
  const list = S.activeOnly ? S.users.filter((u) => openOf(u) > 0) : S.users;
  return `<div class="bar">${wsChip()}${chip("Только с открытыми задачами", S.activeOnly, "tgl", "activeOnly")}
    <div class="right"><span>${me().role === "admin" ? "Щёлкните строку — откроются задачи человека" : "Задачи коллег видны админу"}</span><span>Показано <b>${list.length}</b> из ${S.users.length}</span></div></div>`
    + table([{ t: "Участник", w: "26%" }, { t: "Роль" }, { t: "Рынок" }, { t: "Telegram" }, { t: "Почта" },
      { t: "Открыто", r: true, w: "100px" }, { t: "Просрочено", r: true, w: "132px" }],
      list.map((u) => { const open = openOf(u), late = lateOf(u);
        return `<tr class="row" ${act("person-tasks", u.id)} tabindex="0">${cell(av(u.id), "t")}${cell(ROLE[u.role] || u.role)}
          ${cell(`<span class="cc">${u.mk}</span>`)}${cell(esc(u.tg))}${cell(u.em ? esc(u.em) : state("не привязана", false))}
          ${cell(`<span class="due">${open}</span>`, "r")}
          ${cell(late ? `<span class="due now">${late}</span>` : `<span class="muted">—</span>`, "r")}</tr>`; }).join(""));
}
function screenWorkspaces() {
  /* у текущего воркспейса цифры берутся из состояния, иначе они разойдутся с соседней вкладкой */
  const num = (w) => w.active
    ? { users: S.users.length, tasks: S.tasks.filter((t) => !t.arch).length, entries: S.entries.length }
    : { users: w.users, tasks: w.tasks, entries: w.entries };
  return `<div class="bar">
    <div class="right"><span>Щёлкните строку — переключиться</span><span>Воркспейсов <b>${S.workspaces.length}</b></span>
      ${btn("＋ Воркспейс", "new-ws", undefined, undefined, "pri sm")}</div></div>`
    + table([{ t: "Воркспейс", w: "30%" }, { t: "Слаг" }, { t: "Участников", r: true }, { t: "Задач", r: true }, { t: "Записей", r: true }, { t: "Статус", r: true }],
      S.workspaces.map((w) => { const n = num(w);
        return `<tr class="row"${w.active ? "" : ` ${act("switch-ws", w.id)} tabindex="0"`}>${cell(esc(w.name), "t")}${cell(`<code>${esc(w.id)}</code>`)}
        ${cell(`<span class="due">${n.users}</span>`, "r")}${cell(`<span class="due">${n.tasks}</span>`, "r")}
        ${cell(`<span class="due">${n.entries}</span>`, "r")}${cell(state(w.active ? "текущий" : "доступен", w.active), "r")}</tr>`; }).join(""));
}

/* ── настройки ───────────────────────────────────────────────── */
function screenSettings() {
  if (S.tab === "labels") return screenLabels();
  if (S.tab === "roles") return screenRoles();
  const P = {
    profile: () => rows([
      ["Имя", esc(me().n), btn("Изменить", "user-profile", ME, undefined, "sm")],
      ["Роль", ROLE[me().role], ""],
      ["Telegram", esc(me().tg), btn("Изменить", "user-profile", ME, undefined, "sm")],
      ["Почта", me().em ? esc(me().em) : state("не привязана", false), btn("Изменить", "user-profile", ME, undefined, "sm")],
      /* кнопка называет, ЧТО СТАНЕТ: «Переключить» заставляет угадывать, на что именно,
         а вариантов у языка и темы больше одного не бывает только сегодня */
      ["Язык интерфейса", S.lang === "RU" ? "Русский" : "English", btn(S.lang === "RU" ? "English" : "Русский", "lang", undefined, undefined, "sm")],
      ["Тема", S.theme === "dark" ? "тёмная" : "светлая", btn(S.theme === "dark" ? "Светлая" : "Тёмная", "theme", undefined, undefined, "sm")],
      /* значение написано на выбранной кнопке — второй раз слева оно только сбивает */
      ["Часовой пояс", `<span class="muted">по нему считаются сроки и время встреч</span>`, `<span class="ib">${btn("Europe/Belgrade", "tz", undefined, "Europe/Belgrade", "sm" + (S.tz === "Europe/Belgrade" ? " on" : ""))}${btn("Europe/Zagreb", "tz", undefined, "Europe/Zagreb", "sm" + (S.tz === "Europe/Zagreb" ? " on" : ""))}</span>`],
      ["Аккаунт", "вход через Telegram", btn("Выйти", "logout", undefined, undefined, "sm")],
    ]),
    /* строка открывает развёрнутую инструкцию справа: место есть, а без инструкции
       «Подключить» — это загадка про то, где брать ключ (просьба владельца 21.09) */
    integr: () => rows(S.integrations.map((i) => [`<span class="lnk" ${act("open-integr", i.id)}>${esc(i.n)}</span>`
      + (i.soon ? ` ${state("в разработке", false)}` : ""),
      /* у Granola в продукте видно, сколько заметок ещё не разобрано, и их импортируют
         кнопкой: без числа человек не знает, есть ли что забирать */
      i.id === "granola" ? `${esc(i.d)} · необработанных заметок: ${S.granolaNew}` : esc(i.d),
      `<span class="ib">${i.soon ? "" : state(i.st === "on" ? "подключено" : "выключено", i.st === "on")}
       ${i.id === "granola" && i.st === "on" ? btn("Импорт заметок", "granola-import", undefined, undefined, "sm") : ""}
       ${btn("Инструкция", "open-integr", i.id, undefined, "sm")}
       ${btn(i.st === "on" ? "Отключить" : "Подключить", "integr", i.id, undefined, "sm" + (i.soon ? " dis" : ""))}</span>`])),
    tokens: () => rows([
      ...S.tokens.map((t) => [esc(t.n), `<code>${esc(t.v)}</code> · выпущен ${esc(t.at)}`,
        `<span class="ib">${btn("Скопировать", "copy", undefined, t.v, "sm")}${btn("Перевыпустить", "reissue", t.id, undefined, "sm attn")}</span>`]),
      ["Инструкция для Claude Desktop", "как подключить MCP к Claude Desktop", btn("Открыть", "mcp-guide", undefined, undefined, "sm")],
      ["Команда установки bumblebee", "curl … | sh", btn("Показать", "rec-install", undefined, undefined, "sm")],
      ["Команда обновления bumblebee", "swarm-rec update", btn("Показать", "rec-update", undefined, undefined, "sm")],
    ]),
    notif: () => rows([
      ...S.notifPrefs.map((n) => [esc(n.n), esc(n.d),
        `<span class="ib">${state(n.on ? "включено" : "выключено", n.on)}
         ${btn(n.on ? "Выключить" : "Включить", "notif-pref", n.id, undefined, "sm")}</span>`]),
      /* дайджест собирается по периоду и рынкам — в продукте это его настройки, и без
         них «Сгенерировать» молча берёт что-то своё */
      ["Период дайджеста", "за какой срок собирать", `<span class="ib">${
        [["week", "за неделю"], ["two", "за 2 недели"], ["month", "за месяц"]].map(([k, n]) =>
          `<button class="chip${S.digPeriod === k ? " on" : ""}" ${act("dig-period", undefined, k)}>${n}</button>`).join("")}</span>`],
      ["Рынки дайджеста", S.digMk.length ? "дайджест собирается по этим рынкам" : "рынки не выбраны — собирать не из чего",
        `<span class="ib">${COUNTRIES.map((c) =>
          `<button class="chip${S.digMk.includes(c.c) ? " on" : ""}" ${act("dig-mk", undefined, c.c)}><span class="cc">${c.c}</span></button>`).join("")}</span>`],
      ["Сгенерировать дайджест сейчас", "займёт около 10 секунд", btn("Сгенерировать", "dig", undefined, undefined, "sm")],
    ]),
  }[S.tab];
  const title = TABS.settings.find(([id]) => id === S.tab)[1];
  return `<div class="panes"><div class="pane"><h3>${esc(title)}</h3>
    <div class="sub">Настройки применяются к вашему аккаунту</div>${P()}</div></div>`;
}

/* ── админ ───────────────────────────────────────────────────── */
function screenAdmin() {
  if (S.tab === "ws") return screenWorkspaces();
  if (S.tab === "review") return screenReviewCounts();
  /* разбор агентских встреч — работа админа: на экране «Встречи» он путал вкладкой,
     которую владелец не смог назвать («что такое очередь агента я вообще не знаю») */
  if (S.tab === "queue") return screenQueue();
  if (S.tab === "broadcast") return screenBroadcast();
  if (S.tab === "feedback") return screenFeedback();
  const noMail = S.users.filter((u) => !u.em);
  const list = S.noMailOnly ? noMail : S.users;
  return `<div class="bar">
    ${chip(`Только без почты · ${noMail.length}`, S.noMailOnly, "tgl-nomail")}
    <div class="right"><span>Показано <b>${list.length}</b> из ${S.users.length}</span><span>Очередь вычитки <b>${S.queue.length}</b></span>
      ${btn("＋ Пользователь", "new-user", undefined, undefined, "pri sm")}</div></div>`
    + (list.length ? table([{ t: "Пользователь", w: "22%" }, { t: "Роль" }, { t: "Рынок" }, { t: "Почта" }, { t: "Заметка админа", w: "26%" }, { t: "Действия", r: true, w: "258px" }],
      list.map((u) => `<tr class="row">${cell(av(u.id), "t")}${cell(ROLE[u.role] || u.role)}
        ${cell(`<span class="cc">${u.mk}</span>`)}${cell(u.em ? esc(u.em) : state("не привязана", false))}
        ${cell(u.note ? esc(u.note) : `<span class="muted">—</span>`)}
        ${cell(`<span class="ib">${btn("Профиль", "user-profile", u.id, undefined, "sm")}
          ${u.em ? "" : btn("Привязать почту", "bind-mail", u.id, undefined, "sm attn")}</span>`, "r acts")}</tr>`).join(""))
      : empty("Почта привязана у всех", "Снимите фильтр, чтобы увидеть весь воркспейс"));
}
function screenBroadcast() {
  return `<div class="bar">
    <div class="right"><span>Отправлено <b>${S.broadcasts.length}</b></span>
      ${btn("＋ Рассылка", "broadcast", undefined, undefined, "pri sm")}</div></div>`
    + table([{ t: "Текст", w: "50%" }, { t: "Кому" }, { t: "Отправил" }, { t: "Когда", r: true }],
      S.broadcasts.map((b) => `<tr class="row">${cell(esc(b.t), "t")}${cell(esc(b.to))}${cell(av(b.who))}${cell(dt(b.at), "r")}</tr>`).join(""));
}
function screenFeedback() {
  const cat = (c) => (FEEDBACK_CATS.find(([v]) => v === c) || [, c])[1];
  const open = S.feedback.filter((f) => f.st === "open");
  /* чип со счётчиком выглядел включённым фильтром, а список показывал всё подряд: теперь он фильтрует */
  const list = S.fbo ? open : S.feedback;
  return `<div class="bar">${chip(`Открыто: ${open.length}`, S.fbo, "fb-open")}
    <div class="right"><span>Показано <b>${list.length}</b> из ${S.feedback.length}</span></div></div>`
    + (list.length ? table([{ t: "Сообщение", w: "40%" }, { t: "Категория" }, { t: "От кого" }, { t: "Когда" },
      { t: "Статус" }, { t: "Действие", r: true, w: "150px" }],
      list.map((f) => `<tr class="row">${cell(esc(f.t), "t")}${cell(tag(cat(f.cat), "p"))}${cell(avShort(f.who))}${cell(dt(f.at))}
        ${cell(f.st === "open" ? state("открыт", false) : state("закрыт", true))}
        ${cell(f.st === "open" ? btn("Закрыть", "resolve-fb", f.id, undefined, "sm") : `<span class="muted">—</span>`, "r acts")}</tr>`).join(""))
      : empty("Открытого фидбека нет", "Всё разобрано"));
}

/* ── карта системы ───────────────────────────────────────────── */
function screenMap() {
  const box = (t, x, y, w) => `<g><rect x="${x}" y="${y}" width="${w}" height="34" rx="8" fill="var(--surface)" stroke="var(--line-strong)"/>
    <text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" fill="var(--ink)">${t}</text></g>`;
  /* колено: линия обязана дойти до узла, а не оборваться в воздухе */
  const wire = (x1, y1, x2, y2) => { const mx = Math.round((x1 + x2) / 2);
    return `<path d="M${x1} ${y1} H${mx} V${y2} H${x2}" stroke="var(--accent-line)" stroke-width="1.5" fill="none"/>`; };
  /* заголовок карточки не повторяет заголовок экрана: «Карта системы» стояла дважды
     подряд и съедала строку, ничего не сообщая */
  return `<div class="panes wide"><div class="pane"><h3>Источники, база и поверхности</h3>
    <div class="sub">Как связаны источники, база и поверхности</div>
    <svg viewBox="0 0 760 270" style="width:100%;height:auto;font:500 11px var(--font-ui)">
      ${[["bumblebee", 30], ["Granola", 95], ["Read.ai", 160], ["Telegram-бот", 225]].map(([t, y]) =>
        box(t, 20, y, 120) + wire(140, y + 17, 280, 136)).join("")}
      <rect x="280" y="100" width="140" height="72" rx="10" fill="var(--accent-soft)" stroke="var(--accent)"/>
      <text x="350" y="130" text-anchor="middle" fill="var(--accent)" font-weight="700">База знаний</text>
      <text x="350" y="148" text-anchor="middle" fill="var(--ink-2)" font-size="10">entries · meetings · tasks</text>
      ${[["Веб SWARM", 45], ["Claude Desktop (MCP)", 110], ["Уведомления в Telegram", 175]].map(([t, y]) =>
        wire(420, 136, 540, y + 17) + box(t, 540, y, 190)).join("")}
    </svg>
    ${lab("Что где живёт")}
    ${rows([
      ["Задачи", "веб, бот, Claude Desktop", state("все поверхности", true)],
      ["Встречи и тезисы", "рекордер и импорт → база → веб", state("вычитка в вебе", true)],
      ["Файлы", "загрузка в вебе, индекс в базе", state("поиск по тексту", true)],
      ["Уведомления", "только Telegram", state("бот не редактор", false)],
    ])}</div></div>`;
}

/* ── шапка: колокольчик, дайджест, меню ──────────────────────── */
function renderHeaderPopovers() {
  $(".pop").innerHTML = `<h4>Уведомления ${btn("Прочитать все", "readall", undefined, undefined, "sm")}</h4>
    ${S.notif.map((n, i) => `<div class="n${n.unread ? " unread" : ""}" ${act(n.go[0] === "tasks" ? "open-task" : "open-meet", n.go[1])}>
      <button class="rd" ${act("read-one", i)} title="отметить прочитанным">✓</button>
      <b>${esc(n.t)}</b>${esc(n.s)}<div class="w">${esc(n.w)}</div></div>`).join("")}`;
  const over = S.tasks.filter((t) => dueKind(t.due) === "now" && t.who.includes(ME) && !t.arch);
  const pending = S.meetings.filter((m) => m.st === "pending").length;
  $(".dig").innerHTML = `<h4>Дайджест на сегодня</h4>
    <div class="sec"><h5>Требует вас</h5>
      ${over.map((t) => `<div class="li" ${act("open-task", t.id)}><i class="d"></i>${esc(t.t)}</div>`).join("") || '<div class="li"><i class="d"></i>Просроченного нет</div>'}
      <div class="li" ${act("sec", "meetings")}><i class="d"></i>${nMeet(pending)} ${pending % 10 === 1 && pending % 100 !== 11 ? "ждёт" : "ждут"} вычитки</div>
      <div class="li" ${act("sec", "meetings")}><i class="d"></i>${plural(S.queue.length, "агентская встреча", "агентские встречи", "агентских встреч")} в очереди</div></div>
    <div class="sec"><h5>Встречи сегодня · ${CALENDAR.length}</h5>
      ${CALENDAR.map((c) => `<div class="li"><i class="d"></i>${c.at} · ${esc(c.t)}${c.rec ? "" : " · без записи"}</div>`).join("")}</div>
    <div class="sec"><h5>Движение за сутки</h5>
      <div class="li"><i class="d"></i>Закрыто ${nTasks(S.tasks.filter((t) => t.st === "done").length)}, создано 4</div>
      <div class="li"><i class="d"></i>Новых записей в базе: 1</div></div>`;
  $(".menu").innerHTML = `<div class="mi">${av(ME)}<span class="a">${ROLE[me().role]}</span></div><div class="sep"></div>
    <button class="mi" ${act("theme")}>Тема<span class="a">${S.theme === "dark" ? "тёмная" : "светлая"}</span></button>
    <button class="mi" ${act("lang")}>Язык интерфейса<span class="a">${S.lang}</span></button>
    <button class="mi" ${act("sec", "team")}>Воркспейс<span class="a">IMF BD</span></button>
    <button class="mi" ${act("sec", "settings")}>Настройки<span class="a">⌘,</span></button><div class="sep"></div>
    <button class="mi" ${act("logout")}>Выйти</button>`;
}

/* ── модалки системы ─────────────────────────────────────────── */
function feedbackModal() {
  modal("Сообщить о проблеме", `
    ${fld("Где именно", pick("cat", FEEDBACK_CATS.map(([v, n]) => [v, n]), ["ui"]))}
    ${fld("Что не так", area("text", "", "Что ожидали и что получилось"))}
    ${fld("Скриншот", input("shot", "", "перетащите файл или вставьте из буфера"))}
    <div class="hint">Уйдёт в админку и в бот владельцу. Ответ придёт в Telegram.</div>`,
    `${btn("Отмена", "mclose")}${btn("Отправить", "send-fb", undefined, undefined, "pri")}`);
}
function broadcastModal() {
  modal("Рассылка в Telegram", `
    ${fld("Кому", select("to", [["весь воркспейс", "весь воркспейс"], ["админы", "админы"], ["операции", "роль: операции"]], "весь воркспейс"))}
    ${fld("Текст", area("text", "", "Коротко и по делу"))}
    <div class="hint">Дойдёт всем, у кого привязан Telegram. Тем, у кого не привязан, — нет.</div>`,
    `${btn("Отмена", "mclose")}${btn("Отправить", "do-broadcast", undefined, undefined, "pri")}`);
}
function wsModal() {
  modal("Новый воркспейс", `${fld("Слаг (не меняется потом)", input("id", "", "cee2"))}
    ${fld("Название", input("name", "", "IMF BD — вторая команда"))}
    <div class="hint">Слаг — внутренний ключ, он остаётся прежним даже после переименования.</div>`,
    `${btn("Отмена", "mclose")}${btn("Создать", "do-ws", undefined, undefined, "pri")}`);
}
