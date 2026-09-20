/* Люди и система: команда, настройки, админ, карта, шапка. */

const ROLE = { admin: "админ", ops: "операции", finance: "финансы", hr: "персонал", it: "IT", quality: "качество", market: "маркетинг" };

function screenTeam() {
  if (S.tab === "ws") return screenWorkspaces();
  return `<div class="bar">${chip("Воркспейс: IMF BD", true, "noop")}${chip("Только активные", false, "noop")}
    <div class="right"><span>Участников <b>${S.users.length}</b></span></div></div>`
    + table([{ t: "Участник", w: "26%" }, { t: "Роль" }, { t: "Рынок" }, { t: "Telegram" }, { t: "Почта" }, { t: "Открыто задач", r: true }],
      S.users.map((u) => {
        const open = S.tasks.filter((t) => t.who.includes(u.id) && t.st !== "done" && !t.arch).length;
        return `<tr class="row" ${act("noop")}>${cell(av(u.id), "t")}${cell(ROLE[u.role] || u.role)}
          ${cell(`<span class="cc">${u.mk}</span>`)}${cell(esc(u.tg))}${cell(esc(u.em))}
          ${cell(`<span class="pdot p-med"></span>${open}`, "r")}</tr>`;
      }).join(""));
}
function screenWorkspaces() {
  return `<div class="bar">${btn("＋ Воркспейс", "new-ws", undefined, undefined, "pri sm")}
    <div class="right"><span>Воркспейсов <b>${S.workspaces.length}</b></span></div></div>`
    + table([{ t: "Воркспейс", w: "30%" }, { t: "Слаг" }, { t: "Участников", r: true }, { t: "Задач", r: true }, { t: "Записей", r: true }, { t: "Статус", r: true }],
      S.workspaces.map((w) => `<tr class="row">${cell(esc(w.name), "t")}${cell(`<code>${esc(w.id)}</code>`)}
        ${cell(`<span class="due">${w.users}</span>`, "r")}${cell(`<span class="due">${w.tasks}</span>`, "r")}
        ${cell(`<span class="due">${w.entries}</span>`, "r")}${cell(state(w.active ? "текущий" : "доступен", w.active), "r")}</tr>`).join(""));
}

/* ── настройки ───────────────────────────────────────────────── */
function screenSettings() {
  if (S.tab === "columns") return settingsColumns();
  if (S.tab === "labels") return screenLabels();
  const P = {
    profile: () => rows([
      ["Имя", esc(me().n), btn("Изменить", "noop", undefined, undefined, "sm")],
      ["Роль", ROLE[me().role], ""],
      ["Telegram", esc(me().tg), btn("Отвязать", "noop", undefined, undefined, "sm")],
      ["Почта", esc(me().em), btn("Сменить", "noop", undefined, undefined, "sm")],
      ["Язык интерфейса", S.lang === "RU" ? "Русский" : "English", btn("Переключить", "lang", undefined, undefined, "sm")],
      ["Тема", S.theme === "dark" ? "тёмная" : "светлая", btn("Переключить", "theme", undefined, undefined, "sm")],
      ["Часовой пояс", "Europe/Belgrade", btn("Изменить", "noop", undefined, undefined, "sm")],
      ["Аккаунт", "вход через Telegram", btn("Выйти", "logout", undefined, undefined, "sm")],
    ]),
    integr: () => rows(S.integrations.map((i) => [esc(i.n), esc(i.d),
      `<span class="ib">${state(i.st === "on" ? "подключено" : "выключено", i.st === "on")}
       ${btn(i.st === "on" ? "Отключить" : "Подключить", "integr", i.id, undefined, "sm")}</span>`])),
    tokens: () => rows([
      ["MCP-токен для Claude Desktop", "smcp_•••••••• · выпущен 1 сен", btn("Перевыпустить", "noop", undefined, undefined, "sm")],
      ["Инструкция для Claude Desktop", "готова", btn("Открыть", "noop", undefined, undefined, "sm")],
      ["Токен рекордера", "•••••• · build 24", btn("Перевыпустить", "noop", undefined, undefined, "sm")],
      ["Команда установки bumblebee", "curl … | sh", btn("Показать", "rec-install", undefined, undefined, "sm")],
      ["Команда обновления bumblebee", "swarm-rec update", btn("Показать", "rec-update", undefined, undefined, "sm")],
    ]),
    notif: () => rows([
      ["Тезисы готовы", "в Telegram и в колокольчик", btn("Выключить", "noop", undefined, undefined, "sm")],
      ["Комментарии к задачам", "в Telegram", btn("Выключить", "noop", undefined, undefined, "sm")],
      ["Ежедневный дайджест", "09:00", btn("Изменить время", "noop", undefined, undefined, "sm")],
      ["Напоминания по задачам", "включены", btn("Выключить", "noop", undefined, undefined, "sm")],
      ["Невычитанные встречи", "напоминать через 48 ч", btn("Выключить", "noop", undefined, undefined, "sm")],
      ["Сгенерировать дайджест сейчас", "займёт около 10 секунд", btn("Сгенерировать", "dig", undefined, undefined, "sm")],
    ]),
  }[S.tab];
  const title = TABS.settings.find(([id]) => id === S.tab)[1];
  return `<div class="panes"><div class="pane"><h3>${esc(title)}</h3>
    <div class="sub">Настройки применяются к вашему аккаунту</div>${P()}</div></div>`;
}
function settingsColumns() {
  return `<div class="panes"><div class="pane"><h3>Колонки доски спринта</h3>
    <div class="sub">Порядок и состав колонок — общий для воркспейса</div>
    ${rows(S.cols.map((c, i) => [`${dot(c.id)}${esc(c.n)}`,
      `${S.tasks.filter((t) => t.st === c.id && t.sprint === S.cycle).length} задач · статус <code>${c.id}</code>`,
      `<span class="ib">${btn("↑", "col-move", undefined, `${i}:-1`, "sm")}${btn("↓", "col-move", undefined, `${i}:1`, "sm")}
       ${btn(c.on ? "Скрыть" : "Показать", "col-tgl", undefined, String(i), "sm")}</span>`]))}
    <div class="mt">${btn("Добавить колонку", "noop", undefined, undefined, "pri")}${btn("Вернуть по умолчанию", "noop")}</div></div></div>`;
}

/* ── админ ───────────────────────────────────────────────────── */
function screenAdmin() {
  if (S.tab === "ws") return screenWorkspaces();
  if (S.tab === "broadcast") return screenBroadcast();
  if (S.tab === "feedback") return screenFeedback();
  return `<div class="bar">${btn("＋ Пользователь", "noop", undefined, undefined, "pri sm")}
    ${chip("Только без почты", false, "noop")}
    <div class="right"><span>В воркспейсе <b>${S.users.length}</b></span><span>Очередь вычитки <b>${S.queue.length}</b></span></div></div>`
    + table([{ t: "Пользователь", w: "24%" }, { t: "Роль" }, { t: "Рынки" }, { t: "Почта" }, { t: "Заметка админа" }, { t: "Действия", r: true, w: "200px" }],
      S.users.map((u) => `<tr class="row">${cell(av(u.id), "t")}${cell(ROLE[u.role] || u.role)}
        ${cell(`<span class="cc">${u.mk}</span>`)}${cell(u.em ? esc(u.em) : state("не привязана", false))}
        ${cell(`<span class="muted">—</span>`)}
        ${cell(`<span class="ib">${btn("Профиль", "user-profile", u.id, undefined, "sm")}${btn("Привязать почту", "user-profile", u.id, undefined, "sm")}
          ${btn("Удалить", "noop", undefined, undefined, "sm")}</span>`, "r acts")}</tr>`).join(""));
}
function screenBroadcast() {
  return `<div class="bar">${btn("＋ Рассылка", "broadcast", undefined, undefined, "pri sm")}
    <div class="right"><span>Отправлено <b>${S.broadcasts.length}</b></span></div></div>`
    + table([{ t: "Текст", w: "50%" }, { t: "Кому" }, { t: "Отправил" }, { t: "Когда", r: true }],
      S.broadcasts.map((b) => `<tr class="row">${cell(esc(b.t), "t")}${cell(esc(b.to))}${cell(av(b.who))}${cell(due(b.at), "r")}</tr>`).join(""));
}
function screenFeedback() {
  const cat = (c) => (FEEDBACK_CATS.find(([v]) => v === c) || [, c])[1];
  return `<div class="bar">${chip(`Открыто: ${S.feedback.filter((f) => f.st === "open").length}`, true, "noop")}
    <div class="right"><span>Всего <b>${S.feedback.length}</b></span></div></div>`
    + table([{ t: "Сообщение", w: "42%" }, { t: "Категория" }, { t: "От кого" }, { t: "Когда" }, { t: "Статус", r: true, w: "180px" }],
      S.feedback.map((f) => `<tr class="row">${cell(esc(f.t), "t")}${cell(tag(cat(f.cat), "p"))}${cell(av(f.who))}${cell(due(f.at))}
        ${cell(f.st === "open" ? btn("Закрыть", "resolve-fb", f.id, undefined, "sm") : state("закрыт", true), "r acts")}</tr>`).join(""));
}

/* ── карта системы ───────────────────────────────────────────── */
function screenMap() {
  const box = (t, x, y, w) => `<g><rect x="${x}" y="${y}" width="${w}" height="34" rx="8" fill="var(--surface)" stroke="var(--line-strong)"/>
    <text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" fill="var(--ink)">${t}</text></g>`;
  return `<div class="panes wide"><div class="pane"><h3>Карта системы</h3>
    <div class="sub">Как связаны источники, база и поверхности</div>
    <svg viewBox="0 0 760 270" style="width:100%;height:auto;font:500 11px var(--font-ui)">
      ${[["bumblebee", 30], ["Granola", 95], ["Read.ai", 160], ["Telegram-бот", 225]].map(([t, y]) =>
        box(t, 20, y, 120) + `<path d="M140 ${y + 17} H 280" stroke="var(--accent-line)" stroke-width="1.5" fill="none"/>`).join("")}
      <rect x="280" y="100" width="140" height="72" rx="10" fill="var(--accent-soft)" stroke="var(--accent)"/>
      <text x="350" y="130" text-anchor="middle" fill="var(--accent)" font-weight="700">База знаний</text>
      <text x="350" y="148" text-anchor="middle" fill="var(--ink-2)" font-size="10">entries · meetings · tasks</text>
      ${[["Веб «Рой»", 45], ["Claude Desktop (MCP)", 110], ["Уведомления в Telegram", 175]].map(([t, y]) =>
        `<path d="M420 136 H 540" stroke="var(--accent-line)" stroke-width="1.5" fill="none"/>` + box(t, 540, y, 190)).join("")}
    </svg>
    ${lab("Что где живёт")}
    ${rows([
      ["Задачи", "веб, бот, Claude Desktop", state("все поверхности", true)],
      ["Встречи и тезисы", "рекордер и импорт → база → веб", state("вычитка в вебе", true)],
      ["Файлы", "загрузка в вебе, индекс в базе", state("поиск по тексту", true)],
      ["Уведомления", "только Telegram", state("бот не редактор", true)],
    ])}</div></div>`;
}

/* ── шапка: колокольчик, дайджест, меню ──────────────────────── */
function renderHeaderPopovers() {
  $(".pop").innerHTML = `<h4>Уведомления ${btn("Прочитать все", "readall", undefined, undefined, "sm")}</h4>
    ${S.notif.map((n, i) => `<div class="n${n.unread ? " unread" : ""}" ${act(n.go[0] === "tasks" ? "open-task" : "open-meet", n.go[1])}>
      <button class="rd" ${act("read-one", i)} title="отметить прочитанным">✓</button>
      <b>${esc(n.t)}</b>${esc(n.s)}<div class="w">${esc(n.w)}</div></div>`).join("")}`;
  const over = S.tasks.filter((t) => dueKind(t.due) === "now" && t.who.includes(ME) && !t.arch);
  $(".dig").innerHTML = `<h4>Дайджест на сегодня</h4>
    <div class="sec"><h5>Требует вас</h5>
      ${over.map((t) => `<div class="li" ${act("open-task", t.id)}><i class="d"></i>${esc(t.t)}</div>`).join("") || '<div class="li"><i class="d"></i>Просроченного нет</div>'}
      <div class="li" ${act("sec", "meetings")}><i class="d"></i>${S.meetings.filter((m) => m.st === "pending").length} встречи ждут вычитки</div>
      <div class="li" ${act("sec", "meetings")}><i class="d"></i>${S.queue.length} агентских встреч в очереди</div></div>
    <div class="sec"><h5>Встречи сегодня</h5>
      <div class="li"><i class="d"></i>11:00 · Сверка бюджета Q4</div>
      <div class="li"><i class="d"></i>15:30 · Поставщик упаковки</div></div>
    <div class="sec"><h5>Движение за сутки</h5>
      <div class="li"><i class="d"></i>Закрыто ${S.tasks.filter((t) => t.st === "done").length} задач, создано 4</div>
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
