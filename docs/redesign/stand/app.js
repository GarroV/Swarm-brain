/* Интерактивный стенд редизайна Swarm. Данные вымышленные, бэкенда нет. */
const U = [
  { i: "АК", n: "А. Ковач", c: "#5B3DEC" }, { i: "МД", n: "М. Дам", c: "#1F4E9C" },
  { i: "ИП", n: "И. Пет", c: "#1E8E5E" }, { i: "ЕС", n: "Е. Сав", c: "#C53030" },
];
const av = (u) => u ? `<span class="av" style="background:${u.c}">${u.i}</span>${u.n}` : `<span style="color:var(--ink-empty)">— не назначен</span>`;
const T = (id, t, pr, st, who, due, dueK, prio, mk, list, lens) =>
  ({ id, t, pr, st, who, due, dueK, prio, mk, list, lens });
const TASKS = [
  T(128,"Согласовать смету по оборудованию кухни","Открытие CEE","doing",0,"17 сен","now","P1","закупки","today","mine"),
  T(131,"Ответить франчайзи по срокам поставки","Открытие CEE","wait",1,"18 сен","now","P1","встреча","today","mine"),
  T(132,"Уточнить санитарные требования по площадке","Открытие CEE","todo",2,"18 сен","now","P2","процесс","today","team"),
  T(134,"Собрать тезисы встречи с поставщиком упаковки","Операции","doing",0,"22 сен","soon","P2","встреча","upcoming","mine"),
  T(137,"Проверить чек-лист открытия перед запуском","Открытие CEE","todo",3,"23 сен","soon","P2","процесс","upcoming","team"),
  T(139,"Обновить обучающие материалы для смены","Персонал","todo",1,"24 сен","","P3","обучение","upcoming","mine"),
  T(140,"Свести расходы по логистике за август","Финансы","done",2,"25 сен","","P3","отчёт","upcoming","team"),
  T(141,"Назначить ответственного за приёмку мебели","Открытие CEE","todo",null,"26 сен","","P2","закупки","upcoming","team"),
  T(145,"Описать процесс передачи смены","Операции","todo",0,"2 окт","","P3","процесс","all","mine"),
  T(146,"Сверить меню с локальными поставщиками","Открытие CEE","todo",2,"6 окт","","P3","закупки","all","team"),
  T(147,"Подготовить отчёт по первому месяцу","Финансы","todo",3,"14 окт","","P3","отчёт","all","team"),
  T(150,"Еженедельная сверка остатков","Операции","todo",1,"каждый пн","","P3","регулярно","recurring","mine"),
  T(151,"Ежемесячный отчёт по фудкосту","Финансы","todo",2,"1 числа","","P2","регулярно","recurring","team"),
  T(99,"Выбрать подрядчика на вывеску","Открытие CEE","done",0,"28 авг","","P2","закупки","archive","mine"),
  T(101,"Закрыть договор аренды","Открытие CEE","done",1,"30 авг","","P1","юр","archive","team"),
  T(104,"Завести доступы новым сотрудникам","Персонал","done",3,"2 сен","","P3","доступы","archive","team"),
];
const MEET = [
  { id:"m1", t:"Планёрка по открытию", d:"15 сен, 10:00", who:[0,1,2], st:"review", src:"bumblebee", tasks:3, dur:"48 мин" },
  { id:"m2", t:"Поставщик упаковки — переговоры", d:"16 сен, 14:30", who:[0,3], st:"review", src:"Granola", tasks:1, dur:"32 мин" },
  { id:"m3", t:"Сверка бюджета Q4", d:"17 сен, 11:00", who:[1,2,3], st:"review", src:"Read.ai", tasks:0, dur:"55 мин" },
  { id:"m4", t:"Онбординг новой смены", d:"12 сен, 09:00", who:[1,3], st:"done", src:"bumblebee", tasks:4, dur:"41 мин" },
  { id:"m5", t:"Ревизия меню", d:"10 сен, 16:00", who:[0,2], st:"done", src:"Granola", tasks:2, dur:"27 мин" },
  { id:"m6", t:"Запись без названия", d:"18 сен, 12:04", who:[0], st:"draft", src:"bumblebee", tasks:0, dur:"18 мин" },
];
const RECS = [
  { id:"r1", ty:"meeting", h:"Планёрка по открытию — тезисы", p:"Смета выше бюджета на 14%. Поставщик держит цену до конца недели. Санитарные требования уточняются.", d:"15 сен", who:0 },
  { id:"r2", ty:"document", h:"Стандарт приёмки оборудования", p:"Порядок приёмки, чек-лист по позициям, что делать при расхождении комплектации.", d:"11 сен", who:1 },
  { id:"r3", ty:"note", h:"Контакты подрядчиков по вывескам", p:"Три подрядчика с ценами и сроками, лучший по срокам — второй.", d:"9 сен", who:0 },
  { id:"r4", ty:"transcript", h:"Переговоры с арендодателем", p:"Полный транскрипт: условия по индексации, срок договора, обеспечительный платёж.", d:"5 сен", who:2 },
  { id:"r5", ty:"summary", h:"Итоги августа по операциям", p:"Сводка по сменам, потерям и обучению за август.", d:"1 сен", who:3 },
  { id:"r6", ty:"document", h:"Меню и себестоимость позиций", p:"Таблица позиций с себестоимостью и наценкой, помечены позиции с локальными поставщиками.", d:"28 авг", who:2 },
];
const PROJ = [
  { id:"p1", n:"Открытие CEE", sub:["Площадка","Оборудование","Персонал"], open:7, all:19, who:[0,1,2] },
  { id:"p2", n:"Операции", sub:["Смены","Стандарты"], open:4, all:11, who:[0,2] },
  { id:"p3", n:"Финансы", sub:[], open:3, all:8, who:[3] },
  { id:"p4", n:"Персонал", sub:["Обучение"], open:2, all:6, who:[1,3] },
];
const NOTIF = [
  { t:"Тезисы встречи готовы", s:"«Сверка бюджета Q4» — можно вычитать", w:"12 мин назад" },
  { t:"Комментарий к задаче 128", s:"М. Дам: поставщик держит цену до конца недели", w:"3 ч назад" },
  { t:"Задача просрочена", s:"«Ответить франчайзи по срокам поставки»", w:"вчера" },
];
const NAV = [
  { g:"Работа", items:[
    { id:"tasks", n:"Задачи", c:42, ic:"M3 8.5 6 11.5 13 4.5" },
    { id:"projects", n:"Проекты", c:7, ic:"M2.5 3.5h11v9h-11zM2.5 6.5h11M6 3.5v9" },
    { id:"sprints", n:"Спринты", c:2, ic:"M3 13V8.5M6.3 13V4M9.7 13V7M13 13V10" }]},
  { g:"Знание", items:[
    { id:"meetings", n:"Встречи", c:5, ic:"M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3m5-3v3" },
    { id:"base", n:"База", ic:"M3 3.5h4.2a1.8 1.8 0 0 1 1.8 1.8v7.2M13 3.5H8.8A1.8 1.8 0 0 0 7 5.3v7.2" }]},
  { g:"Люди", items:[{ id:"team", n:"Команда", c:12, ic:"M6 7.6a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M2 13c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6M11.2 5.8a1.9 1.9 0 0 1 0 3.7M11.6 13c0-1.5-.5-2.5-1.3-3.1" }]},
];
const NAVFOOT = [
  { id:"settings", n:"Настройки", ic:"M8 1.8v1.8m0 8.8v1.8m6.2-6.2h-1.8M3.6 8H1.8" },
  { id:"admin", n:"Админ", ic:"M8 2 3 4.2v4c0 3 2.1 5 5 5.8 2.9-.8 5-2.8 5-5.8v-4z" },
  { id:"map", n:"Карта системы", ic:"M4.5 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4M11.5 13.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4M6.5 4.5h3a2 2 0 0 1 2 2v3" },
];
const TABS = {
  tasks:[["today","Сегодня"],["upcoming","Ближайшие"],["all","Все"],["recurring","Регулярные"],["archive","Архив"]],
  meetings:[["review","Вычитка"],["all","Все встречи"],["draft","Черновики bumblebee"]],
  sprints:[["board","Доска"],["check","Чек"],["analytics","Аналитика"],["journal","Журнал"]],
  base:[["all","Все записи"],["meeting","Встречи"],["document","Документы"],["note","Заметки"],["transcript","Транскрипты"],["summary","Сводки"]],
  projects:[["list","Список"],["map","Карта проектов"]],
  team:[["members","Участники"],["ws","Воркспейсы"]],
  settings:[["profile","Профиль"],["integr","Интеграции"],["tokens","Доступы"],["notif","Уведомления"]],
  admin:[["users","Пользователи"],["ws","Воркспейсы"],["broadcast","Рассылка"],["feedback","Фидбек"]],
};
const S = { sec:"tasks", tab:"today", sel:null, lens:"mine", staff:false, byMarket:false, status:new Set(), q:"" };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]));
const dot = (st) => `<span class="dot d-${st}"></span>`;
const ST = { todo:"Открыта", doing:"В работе", wait:"Ждёт", done:"Готова" };

/* ── навигация ─────────────────────────────────────────────── */
function renderNav() {
  const item = (x, on) => `<div class="item${on ? " on" : ""}" data-sec="${x.id}" tabindex="0">
    <svg class="ic" viewBox="0 0 16 16"><path d="${x.ic}"/></svg>${x.n}${x.c ? `<span class="n">${x.c}</span>` : ""}</div>`;
  $(".nav-scroll").innerHTML = NAV.map((g) =>
    `<div class="grp">${g.g}</div>` + g.items.map((x) => item(x, x.id === S.sec)).join("")).join("");
  $(".nav-foot").innerHTML = NAVFOOT.map((x) => item(x, x.id === S.sec)).join("");
}
function renderTabs() {
  const t = TABS[S.sec] || [];
  const cnt = (id) => S.sec === "tasks" ? TASKS.filter((x) => x.list === id && (S.lens === "all" || x.lens === S.lens)).length
    : S.sec === "meetings" ? MEET.filter((x) => x.st === id || id === "all").length : null;
  $(".tabs").innerHTML = t.map(([id, n]) => {
    const c = cnt(id);
    return `<div class="tab${id === S.tab ? " on" : ""}" data-tab="${id}" tabindex="0">${n}${c ? `<span class="c">${c}</span>` : ""}</div>`;
  }).join("");
}

/* ── экраны ────────────────────────────────────────────────── */
function screenTasks() {
  let rows = TASKS.filter((x) => x.list === S.tab);
  if (S.lens === "mine") rows = rows.filter((x) => x.lens === "mine");
  if (S.lens === "team") rows = rows.filter((x) => x.lens === "team");
  if (S.status.size) rows = rows.filter((x) => S.status.has(x.st === "wait" ? "todo" : x.st));
  const bar = `<div class="bar">
    ${["mine","team","all"].map((l) => `<div class="chip${S.lens === l ? " on" : ""}" data-lens="${l}" tabindex="0">${{ mine:"Мои", team:"Команды", all:"Все" }[l]}</div>`).join("")}
    <div style="width:1px;height:18px;background:var(--line-strong);margin:0 4px"></div>
    ${["todo","doing","done"].map((s) => `<div class="chip${S.status.has(s) ? " on" : ""}" data-st="${s}" tabindex="0">${dot(s)}${ST[s]}</div>`).join("")}
    <div style="flex-basis:100%;height:0"></div><div class="chip${S.byMarket ? " on" : ""}" data-tgl="byMarket" tabindex="0">Группировать по рынкам</div>
    <div class="chip${S.staff ? " on" : ""}" data-tgl="staff" tabindex="0">Все сотрудники</div>
    <div class="right"><span>Просрочено <b>${rows.filter((x) => x.dueK === "now").length}</b></span><span>Показано <b>${rows.length}</b></span></div></div>`;
  if (!rows.length) return bar + `<div class="empty"><b>Здесь пусто</b>Смените линзу или фильтр статуса</div>`;
  const groups = S.tab === "archive" ? [["Закрытые", rows]]
    : [["Просрочено", rows.filter((x) => x.dueK === "now")], ["На этой неделе", rows.filter((x) => x.dueK === "soon")], ["Позже", rows.filter((x) => !x.dueK)]];
  const body = groups.filter(([, r]) => r.length).map(([n, r]) =>
    `<tr class="sect"><td colspan="6">${n} · ${r.length}</td></tr>` + r.map((x) => `
    <tr class="row${S.sel === x.id ? " sel" : ""}" data-task="${x.id}" tabindex="0">
      <td class="t">${dot(x.st)}${esc(x.t)}</td><td>${esc(x.pr)}</td><td>${av(U[x.who])}</td>
      <td><span class="tag tag-${x.mk === "встреча" ? "m" : x.mk === "процесс" ? "p" : "o"}">${x.mk}</span></td>
      <td class="r"><span class="due ${x.dueK}">${x.due}</span></td><td class="r"><span class="pri${x.prio === "P1" ? " hi" : ""}">${x.prio}</span></td></tr>`).join("")).join("");
  return bar + `<div class="list"><table><thead><tr><th style="width:42%">Задача</th><th>Проект</th><th>Исполнитель</th><th>Метка</th><th class="r">Срок</th><th class="r">Приор.</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function screenMeetings() {
  const rows = MEET.filter((x) => S.tab === "all" ? true : x.st === S.tab);
  const strip = S.tab === "review" ? `<div class="review">Невычитанных встреч: ${MEET.filter((x) => x.st === "review").length}. Тезисы готовы, ждут подтверждения.<button class="btn">Вычитать подряд</button></div>` : "";
  if (!rows.length) return strip + `<div class="empty"><b>Встреч нет</b>Записи появятся после bumblebee, Granola или Read.ai</div>`;
  return strip + `<div class="list"><table><thead><tr><th style="width:40%">Встреча</th><th>Когда</th><th>Участники</th><th>Источник</th><th class="r">Длит.</th><th class="r">Задач</th></tr></thead><tbody>${rows.map((x) => `
    <tr class="row${S.sel === x.id ? " sel" : ""}" data-meet="${x.id}" tabindex="0">
      <td class="t">${dot(x.st === "review" ? "wait" : x.st === "draft" ? "todo" : "done")}${esc(x.t)}</td>
      <td>${x.d}</td><td>${x.who.map((i) => `<span class="av" style="background:${U[i].c}">${U[i].i}</span>`).join("")}</td>
      <td><span class="tag tag-m">${x.src}</span></td><td class="r"><span class="due">${x.dur}</span></td>
      <td class="r"><span class="pri">${x.tasks || "—"}</span></td></tr>`).join("")}</tbody></table></div>`;
}
function screenBase() {
  const rows = RECS.filter((x) => S.tab === "all" || x.ty === S.tab);
  const TY = { meeting:["tag-m","Встреча"], document:["tag-p","Документ"], note:["tag-o","Заметка"], transcript:["tag-p","Транскрипт"], summary:["tag-o","Сводка"] };
  if (!rows.length) return `<div class="empty"><b>Записей этого типа нет</b></div>`;
  return `<div class="grid">${rows.map((x) => `<div class="rec" data-rec="${x.id}" tabindex="0">
    <h4>${esc(x.h)}</h4><p>${esc(x.p)}</p>
    <div class="m"><span class="tag ${TY[x.ty][0]}">${TY[x.ty][1]}</span><span>${x.d}</span><span style="margin-left:auto">${av(U[x.who])}</span></div></div>`).join("")}</div>`;
}
function screenProjects() {
  if (S.tab === "map") return `<div class="empty"><b>Карта проектов</b>Дерево проектов и подпроектов — react-flow, как сейчас</div>`;
  return `<div class="list"><table><thead><tr><th style="width:40%">Проект</th><th>Подпроекты</th><th>Команда</th><th class="r">Открыто</th><th class="r">Всего</th></tr></thead><tbody>${PROJ.map((p) => `
    <tr class="row" data-proj="${p.id}" tabindex="0"><td class="t">${dot("doing")}${esc(p.n)}</td>
    <td>${p.sub.length ? p.sub.join(" · ") : "<span style='color:var(--ink-empty)'>—</span>"}</td>
    <td>${p.who.map((i) => `<span class="av" style="background:${U[i].c}">${U[i].i}</span>`).join("")}</td>
    <td class="r"><span class="due">${p.open}</span></td><td class="r"><span class="pri">${p.all}</span></td></tr>`).join("")}</tbody></table></div>`;
}
function screenSprints() {
  if (S.tab !== "board") return `<div class="empty"><b>${{ check:"Чек спринта", analytics:"Аналитика", journal:"Журнал перемещений" }[S.tab]}</b>Экран есть сейчас, в стенде показан заглушкой</div>`;
  const cols = [["Бэклог","todo",TASKS.filter((x) => x.st === "todo").slice(0,4)],["В работе","doing",TASKS.filter((x) => x.st === "doing")],["Ждёт","wait",TASKS.filter((x) => x.st === "wait")],["Готово","done",TASKS.filter((x) => x.st === "done")]];
  return `<div class="board">${cols.map(([n, st, items]) => `<div class="col"><h3>${dot(st)}${n}<span class="n">${items.length}</span></h3>
    <div class="cards">${items.map((x) => `<div class="card" data-task="${x.id}" tabindex="0">${esc(x.t)}<div class="m">${av(U[x.who])}<span style="margin-left:auto" class="due ${x.dueK}">${x.due}</span></div></div>`).join("")}</div></div>`).join("")}</div>`;
}
function screenTeam() {
  if (S.tab === "ws") return `<div class="panes"><div class="pane"><h3>Воркспейсы</h3><div class="sub">Тенант = единица изоляции данных</div>
    <div class="rowset"><div><span class="k">IMF BD</span><span class="v">cee</span><span class="a state on">текущий</span></div>
    <div><span class="k">Прочие рынки</span><span class="v">other</span><span class="a state off">доступен</span></div></div></div></div>`;
  return `<div class="list"><table><thead><tr><th style="width:34%">Участник</th><th>Роль</th><th>Воркспейс</th><th class="r">Задач</th><th class="r">Активность</th></tr></thead><tbody>${U.map((u, i) => `
    <tr class="row" tabindex="0"><td class="t">${av(u)}</td><td>${i === 0 ? "Админ" : "Участник"}</td><td>IMF BD</td>
    <td class="r"><span class="due">${[6,5,4,3][i]}</span></td><td class="r"><span class="pri">${["сегодня","сегодня","вчера","3 дня"][i]}</span></td></tr>`).join("")}</tbody></table></div>`;
}
function screenSettings() {
  const P = {
    profile:[["Имя","А. Ковач"],["Telegram","@user"],["Язык интерфейса","Русский · English"],["Часовой пояс","Europe/Belgrade"]],
    integr:[["Google Calendar","подключён",1],["Granola","подключён",1],["Read.ai","вебхук активен",1],["bumblebee","build 24",1]],
    tokens:[["MCP-токен для Claude Desktop","smcp_••••••••"],["Токен рекордера","•••••• (перевыпуск в боте)"]],
    notif:[["Тезисы готовы","включено",1],["Комментарии к задачам","включено",1],["Ежедневный дайджест","09:00",1],["Напоминания по задачам","включено",1]],
  }[S.tab];
  return `<div class="panes"><div class="pane"><h3>${TABS.settings.find(([i]) => i === S.tab)[1]}</h3>
    <div class="sub">Настройки применяются к вашему аккаунту</div><div class="rowset">${P.map(([k, v, on]) =>
      `<div><span class="k">${k}</span><span class="v">${v}</span>${on ? `<span class="a state on">вкл</span>` : `<span class="a"><button class="btn" style="height:26px">Изменить</button></span>`}</div>`).join("")}</div></div></div>`;
}
function screenAdmin() {
  if (S.tab === "broadcast") return `<div class="panes"><div class="pane"><h3>Рассылка команде</h3><div class="sub">Уходит в Telegram всем участникам воркспейса</div>
    <div class="note" style="margin-bottom:10px">Текст сообщения…</div><button class="btn pri">Отправить</button></div></div>`;
  if (S.tab === "feedback") return `<div class="panes"><div class="pane"><h3>Фидбек</h3><div class="sub">Приходит из бота и из веба, со скриншотами</div>
    <div class="rowset"><div><span class="k">Баг</span><span class="v">Не открывается встреча на телефоне</span><span class="a state off">открыт</span></div>
    <div><span class="k">Идея</span><span class="v">Нужен архив задач</span><span class="a state on">сделано</span></div></div></div></div>`;
  if (S.tab === "ws") return screenTeam();
  return `<div class="list"><table><thead><tr><th style="width:34%">Пользователь</th><th>Доступ</th><th>Воркспейс</th><th class="r">Записей</th><th class="r">Последний вход</th></tr></thead><tbody>${U.map((u, i) => `
    <tr class="row" tabindex="0"><td class="t">${av(u)}</td><td>${i === 0 ? "Админ" : "Разрешён"}</td><td>IMF BD</td>
    <td class="r"><span class="due">${[24,18,11,7][i]}</span></td><td class="r"><span class="pri">${["сегодня","сегодня","вчера","3 дня"][i]}</span></td></tr>`).join("")}</tbody></table></div>`;
}
const SCREENS = { tasks:screenTasks, meetings:screenMeetings, base:screenBase, projects:screenProjects, sprints:screenSprints, team:screenTeam, settings:screenSettings, admin:screenAdmin,
  map:() => `<div class="empty"><b>Карта системы</b>Схема связей проектов, встреч и задач</div>`,
  answer:() => `<div class="answer"><div class="q">${esc(S.q)}</div><div class="a">Смета по оборудованию пришла выше бюджета на 14%<sup>1</sup>. Поставщик подтвердил, что держит цену до конца недели<sup>2</sup>, поэтому решение нужно принять на ближайшей планёрке. Санитарные требования по площадке пока уточняются<sup>3</sup>.</div>
    <div class="lab">Источники</div>
    <div class="rowset"><div><span class="k">1 · Встреча</span><span class="v">Планёрка по открытию, 15 сен</span></div>
    <div><span class="k">2 · Комментарий</span><span class="v">Задача 128, М. Дам</span></div>
    <div><span class="k">3 · Заметка</span><span class="v">Санитарные требования, 12 сен</span></div></div></div>` };

/* ── деталь ────────────────────────────────────────────────── */
function renderDetail() {
  const app = $(".app"), d = $(".detail");
  const task = TASKS.find((x) => x.id === S.sel), meet = MEET.find((x) => x.id === S.sel), rec = RECS.find((x) => x.id === S.sel);
  if (!task && !meet && !rec) { app.classList.remove("with-detail"); return; }
  app.classList.add("with-detail");
  if (task) d.innerHTML = `<div class="d-head"><div class="d-crumb">${esc(task.pr)} · Задача ${task.id}</div>
    <div class="d-title">${esc(task.t)}</div>
    <div class="d-acts"><button class="btn pri">Взять в работу</button><button class="btn">Передать</button><button class="btn">Архивировать</button><button class="btn" data-close="1">✕</button></div></div>
    <div class="d-body"><dl class="f">
      <dt>Статус</dt><dd>${dot(task.st)}${ST[task.st]}</dd><dt>Исполнитель</dt><dd>${av(U[task.who])}</dd>
      <dt>Срок</dt><dd><span class="due ${task.dueK}">${task.due}</span>${task.dueK === "now" ? ' <span style="color:var(--bad);font-size:var(--fs-meta)">· просрочено</span>' : ""}</dd>
      <dt>Приоритет</dt><dd><span class="pri${task.prio === "P1" ? " hi" : ""}">${task.prio}</span></dd>
      <dt>Метки</dt><dd><span class="tag tag-o">${task.mk}</span></dd></dl>
    <div class="lab">Откуда задача</div><div class="src">Из встречи «Планёрка по открытию» · 15 сен</div>
    <div class="lab">Описание</div><div class="note">Смета от поставщика выше бюджета на <em>14%</em>. Свести позиции с согласованными и вынести расхождение на планёрку.</div>
    <div class="lab">Обсуждение · 2</div>
    <div class="cm"><span class="av" style="background:${U[1].c}">${U[1].i}</span><div class="b"><div class="w"><b>${U[1].n}</b> · вчера</div>Поставщик держит цену до конца недели.</div></div>
    <div class="cm"><span class="av" style="background:${U[0].c}">${U[0].i}</span><div class="b"><div class="w"><b>${U[0].n}</b> · 3 ч назад</div>Свожу позиции, к планёрке будет разбивка.</div></div></div>`;
  if (meet) d.innerHTML = `<div class="d-head"><div class="d-crumb">${meet.src} · ${meet.d}</div><div class="d-title">${esc(meet.t)}</div>
    <div class="d-acts">${meet.st === "review" ? '<button class="btn pri">Подтвердить тезисы</button>' : '<button class="btn pri">Открыть запись</button>'}<button class="btn">Сгенерировать задачи</button><button class="btn">Транскрипт</button><button class="btn" data-close="1">✕</button></div></div>
    <div class="d-body"><dl class="f"><dt>Участники</dt><dd>${meet.who.map((i) => U[i].n).join(", ")}</dd>
      <dt>Длительность</dt><dd><span class="due">${meet.dur}</span></dd><dt>Задач создано</dt><dd><span class="pri">${meet.tasks}</span></dd>
      <dt>Статус</dt><dd>${meet.st === "review" ? "На согласовании" : meet.st === "draft" ? "Черновик записи" : "Подтверждена"}</dd></dl>
    <div class="lab">Тезисы</div><div class="tez"><h5>Закупки</h5><li>Смета выше бюджета на 14%, поставщик держит цену до пятницы.</li><li>Нужна разбивка по позициям к следующей планёрке.</li>
      <h5>Площадка</h5><li>Санитарные требования уточняются, ответ ожидается на неделе.</li><h5>Решения</h5><li>Подрядчика на вывеску утвердили.</li></div>
    <div class="lab">Задачи из встречи</div><div class="rowset"><div><span class="k">128</span><span class="v">Согласовать смету</span><span class="a state off">в работе</span></div>
      <div><span class="k">132</span><span class="v">Уточнить санитарные требования</span><span class="a state off">открыта</span></div></div></div>`;
  if (rec) d.innerHTML = `<div class="d-head"><div class="d-crumb">Запись базы знаний</div><div class="d-title">${esc(rec.h)}</div>
    <div class="d-acts"><button class="btn pri">Открыть полностью</button><button class="btn">Править</button><button class="btn">Скачать</button><button class="btn" data-close="1">✕</button></div></div>
    <div class="d-body"><dl class="f"><dt>Тип</dt><dd>${rec.ty}</dd><dt>Автор</dt><dd>${av(U[rec.who])}</dd><dt>Добавлена</dt><dd><span class="due">${rec.d}</span></dd></dl>
    <div class="lab">Фрагмент</div><div class="note">${esc(rec.p)}</div>
    <div class="lab">Связанное</div><div class="rowset"><div><span class="k">Встреча</span><span class="v">Планёрка по открытию</span></div><div><span class="k">Проект</span><span class="v">Открытие CEE</span></div></div></div>`;
}

/* ── сборка ────────────────────────────────────────────────── */
const TITLES = { tasks:["Работа","Задачи"], projects:["Работа","Проекты"], sprints:["Работа","Спринты"], meetings:["Знание","Встречи"], base:["Знание","База"], team:["Люди","Команда"], settings:["Система","Настройки"], admin:["Система","Админ"], map:["Система","Карта системы"], answer:["Поиск","Ответ"] };
function render() {
  renderNav();
  const [crumb, title] = TITLES[S.sec];
  $(".crumb").textContent = crumb; $("h1").textContent = title;
  if (TABS[S.sec]) { $(".tabs").classList.remove("hidden"); renderTabs(); } else $(".tabs").classList.add("hidden");
  $(".body").innerHTML = SCREENS[S.sec]();
  renderDetail();
}
function go(sec) {
  S.sec = sec; S.sel = null; S.status.clear();
  S.tab = TABS[sec] ? TABS[sec][0][0] : null;
  render();
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-sec],[data-tab],[data-task],[data-meet],[data-rec],[data-lens],[data-st],[data-tgl],[data-close],[data-bell],[data-search]");
  if (!t) { $(".pop").classList.remove("open"); return; }
  if (t.dataset.sec) return go(t.dataset.sec);
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.sel = null; return render(); }
  if (t.dataset.task) { S.sel = +t.dataset.task; return render(); }
  if (t.dataset.meet || t.dataset.rec) { S.sel = t.dataset.meet || t.dataset.rec; return render(); }
  if (t.dataset.lens) { S.lens = t.dataset.lens; return render(); }
  if (t.dataset.st) { S.status.has(t.dataset.st) ? S.status.delete(t.dataset.st) : S.status.add(t.dataset.st); return render(); }
  if (t.dataset.tgl) { S[t.dataset.tgl] = !S[t.dataset.tgl]; return render(); }
  if (t.dataset.close) { S.sel = null; return render(); }
  if (t.dataset.bell) { $(".pop").classList.toggle("open"); return; }
  if (t.dataset.search) openPal();
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPal(); }
  if (e.key === "Escape") { closePal(); if (S.sel) { S.sel = null; render(); } }
  if (e.key === "Enter" && e.target.dataset && (e.target.dataset.sec || e.target.dataset.tab || e.target.dataset.task)) e.target.click();
});
function openPal() { $(".scrim").classList.add("open"); $(".pal").classList.add("open"); $("#q").value = ""; palResults(""); $("#q").focus(); }
function closePal() { $(".scrim").classList.remove("open"); $(".pal").classList.remove("open"); }
function palResults(q) {
  const ql = q.toLowerCase();
  const tk = TASKS.filter((x) => !ql || x.t.toLowerCase().includes(ql)).slice(0, 4);
  const rc = RECS.filter((x) => !ql || (x.h + x.p).toLowerCase().includes(ql)).slice(0, 4);
  const mt = MEET.filter((x) => !ql || x.t.toLowerCase().includes(ql)).slice(0, 3);
  $(".res").innerHTML =
    (q ? `<div class="r on" data-ask="1"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 14 14"/></svg><span class="t">Спросить базу: «${esc(q)}»</span><span class="s">Enter</span></div>` : "") +
    (tk.length ? `<div class="grp">Задачи</div>` + tk.map((x) => `<div class="r" data-task="${x.id}"><span class="t">${esc(x.t)}</span><span class="s">${x.pr}</span></div>`).join("") : "") +
    (rc.length ? `<div class="grp">База знаний</div>` + rc.map((x) => `<div class="r" data-rec="${x.id}"><span class="t">${esc(x.h)}</span><span class="s">${x.d}</span></div>`).join("") : "") +
    (mt.length ? `<div class="grp">Встречи</div>` + mt.map((x) => `<div class="r" data-meet="${x.id}"><span class="t">${esc(x.t)}</span><span class="s">${x.d}</span></div>`).join("") : "");
  $(".res").querySelectorAll("[data-task],[data-rec],[data-meet]").forEach((el) => el.addEventListener("click", () => {
    closePal(); S.sec = el.dataset.task ? "tasks" : el.dataset.rec ? "base" : "meetings";
    S.tab = el.dataset.task ? "today" : el.dataset.rec ? "all" : "review";
    S.sel = el.dataset.task ? +el.dataset.task : (el.dataset.rec || el.dataset.meet); render();
  }));
  const ask = $(".res [data-ask]");
  if (ask) ask.addEventListener("click", () => { closePal(); S.q = q; S.sec = "answer"; S.sel = null; render(); });
}
window.addEventListener("DOMContentLoaded", () => {
  $("#q").addEventListener("input", (e) => palResults(e.target.value));
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.value) { const q = e.target.value; closePal(); S.q = q; S.sec = "answer"; S.sel = null; render(); } });
  $(".scrim").addEventListener("click", closePal);
  $(".pop").innerHTML = `<h4>Уведомления</h4>` + NOTIF.map((n) => `<div class="n"><b>${n.t}</b><div>${n.s}</div><div class="w">${n.w}</div></div>`).join("");
  render();
});

/* ═══ РАСШИРЕНИЕ: полный функционал ═══════════════════════════════ */
const MARKETS = ["RS","HR","SI","BA","General"];
const LABELS = ["закупки","процесс","встреча","отчёт","обучение","юр","доступы","регулярно"];
const HIST = [
  { w:"3 ч назад", a:"А. Ковач", t:"перенёс в «В работе»" },
  { w:"вчера", a:"М. Дам", t:"поставил срок 17 сен" },
  { w:"15 сен", a:"Система", t:"создана из встречи «Планёрка по открытию»" },
];
const LINKS = [["блокирует","141","Назначить ответственного за приёмку мебели"],["связана","132","Уточнить санитарные требования"]];
S.dtab = "over"; S.bulk = new Set(); S.lang = "RU";

/* модалка */
function modal(title, body, foot) {
  $(".mscrim").classList.add("open");
  const m = $(".modal"); m.classList.add("open");
  m.innerHTML = `<header><h3>${title}</h3><button class="btn" data-mclose="1">✕</button></header>
    <div class="mbody">${body}</div><footer>${foot}</footer>`;
}
function closeModal() { $(".mscrim").classList.remove("open"); $(".modal").classList.remove("open"); }
const opt = (arr, sel) => arr.map((x) => `<option${x === sel ? " selected" : ""}>${x}</option>`).join("");
const chips = (arr, on) => arr.map((x) => `<span class="chip${on && on.includes(x) ? " on" : ""}">${x}</span>`).join("");

function newTaskModal() {
  modal("Новая задача", `
    <div class="fld"><label>Название</label><input placeholder="Что нужно сделать"></div>
    <div class="fld"><label>Описание</label><textarea placeholder="Контекст, ссылки, детали"></textarea></div>
    <div class="two">
      <div class="fld"><label>Проект</label><select>${opt(PROJ.map((p) => p.n))}</select></div>
      <div class="fld"><label>Исполнитель</label><select>${opt(["— не назначен", ...U.map((u) => u.n)])}</select></div>
      <div class="fld"><label>Срок</label><input type="date"></div>
      <div class="fld"><label>Приоритет</label><select>${opt(["P1","P2","P3"], "P2")}</select></div></div>
    <div class="fld"><label>Метки</label><div class="pick">${chips(LABELS, ["процесс"])}</div></div>
    <div class="fld"><label>Рынки</label><div class="pick">${chips(MARKETS, ["RS"])}</div></div>
    <div class="fld"><label>Повтор</label><select>${opt(["без повтора","каждый день","каждый понедельник","каждое 1 число"])}</select></div>
    <div class="fld"><label>Напоминание</label><select>${opt(["не напоминать","за день до срока","в день срока утром"])}</select></div>
    <label class="sw"><i></i>Личная задача — видна только мне</label>`,
    `<button class="btn" data-mclose="1">Отмена</button><button class="btn pri" data-mclose="1">Создать задачу</button>`);
}
function newEntryModal() {
  modal("Новая запись в базе", `
    <div class="fld"><label>Заголовок</label><input placeholder="О чём запись"></div>
    <div class="fld"><label>Тип</label><select>${opt(["Заметка","Документ","Транскрипт","Сводка"])}</select></div>
    <div class="fld"><label>Текст</label><textarea placeholder="Полный текст — сохраняется целиком, без сокращений"></textarea></div>
    <div class="fld"><label>Файл</label><input type="file"></div>
    <div class="fld"><label>Страны и рынки</label><div class="pick">${chips(MARKETS, ["General"])}</div></div>
    <label class="sw"><i></i>Личная запись — видна только мне</label>`,
    `<button class="btn" data-mclose="1">Отмена</button><button class="btn pri" data-mclose="1">Сохранить в базу</button>`);
}
function feedbackModal() {
  modal("Сообщить о проблеме", `
    <div class="fld"><label>Категория</label><select>${opt(["Баг — что-то сломалось","Идея — чего не хватает","Вопрос","Другое"])}</select></div>
    <div class="fld"><label>Что случилось</label><textarea placeholder="Опишите, что вы делали и что пошло не так"></textarea></div>
    <div class="fld"><label>Скриншот</label><input type="file" accept="image/*"></div>
    <div class="src">Экран, язык и версия прикрепятся автоматически</div>`,
    `<button class="btn" data-mclose="1">Отмена</button><button class="btn pri" data-mclose="1">Отправить</button>`);
}
function tezisyModal() {
  modal("Правка тезисов", `
    <div class="fld"><label>Тезисы встречи</label><textarea style="min-height:180px">ЗАКУПКИ
— Смета выше бюджета на 14%, поставщик держит цену до пятницы.
— Нужна разбивка по позициям к следующей планёрке.

ПЛОЩАДКА
— Санитарные требования уточняются.</textarea></div>
    <div class="src">«Переписать» отправит текст модели и заменит тезисы — исходный транскрипт не меняется</div>`,
    `<button class="btn" data-mclose="1">Отмена</button><button class="btn" data-mclose="1">Переписать моделью</button><button class="btn pri" data-mclose="1">Сохранить</button>`);
}

/* деталь задачи со вкладками */
const baseDetail = renderDetail;
renderDetail = function () {
  baseDetail();
  const task = TASKS.find((x) => x.id === S.sel);
  if (!task) return;
  const head = $(".detail .d-head");
  head.insertAdjacentHTML("afterend", `<div class="dtabs">
    ${[["over","Обзор"],["hist","История"],["links","Связи"],["subs","Подписчики"]].map(([i, n]) =>
      `<div class="dtab${S.dtab === i ? " on" : ""}" data-dtab="${i}">${n}</div>`).join("")}</div>`);
  if (S.dtab === "over") return;
  const b = $(".detail .d-body");
  if (S.dtab === "hist") b.innerHTML = `<div class="lab" style="margin-top:0;padding-top:0;border:0">Журнал перемещений</div>
    <div class="tl">${HIST.map((h) => `<div class="e"><div class="p"></div><div><b>${h.a}</b> ${h.t}<div class="w">${h.w}</div></div></div>`).join("")}</div>`;
  if (S.dtab === "links") b.innerHTML = `<div class="lab" style="margin-top:0;padding-top:0;border:0">Связи задачи</div>
    <div class="rowset">${LINKS.map(([k, id, t]) => `<div><span class="k">${k}</span><span class="v">${id} · ${t}</span></div>`).join("")}</div>
    <div style="margin-top:10px"><button class="btn">Связать с другой задачей</button></div>`;
  if (S.dtab === "subs") b.innerHTML = `<div class="lab" style="margin-top:0;padding-top:0;border:0">Кто получает уведомления</div>
    <div class="rowset">${U.slice(0,2).map((u) => `<div><span class="k">${u.n}</span><span class="v">комментарии и смена статуса</span><span class="a state on">подписан</span></div>`).join("")}</div>
    <div style="margin-top:10px"><button class="btn">Подписаться</button><button class="btn" style="margin-left:6px">Напомнить мне</button></div>`;
};

/* массовые действия + кнопка создания в Задачах */
const baseTasks = SCREENS.tasks;
SCREENS.tasks = function () {
  let html = baseTasks();
  html = html.replace('<div class="right">', `<button class="btn pri" data-new="task" style="height:26px;font-size:var(--fs-meta)">＋ Задача</button><div class="right">`);
  if (S.bulk.size) html = `<div class="bulk">Выбрано: ${S.bulk.size}<button class="btn">Назначить</button><button class="btn">Срок</button><button class="btn">Метка</button><button class="btn">В архив</button><span class="x"><button class="btn" data-bulkclr="1">Снять выделение</button></span></div>` + html;
  return html.replace(/<td class="t">/g, (m) => `<td class="ck"><input type="checkbox" data-ck="1"></td>${m}`)
             .replace('<th style="width:42%">Задача</th>', '<th class="ck"><input type="checkbox" data-ckall="1"></th><th style="width:38%">Задача</th>');
};
SCREENS.base = ((base) => function () {
  return `<div class="bar"><button class="btn pri" data-new="entry" style="height:26px;font-size:var(--fs-meta)">＋ Запись</button>
    <div class="chip">Страна: все</div><div class="chip">Только мои</div>
    <div class="right"><span>Записей <b>${RECS.length}</b></span><span>Файлов <b>12</b></span></div></div>` + base();
})(SCREENS.base);
SCREENS.meetings = ((base) => function () {
  return `<div class="bar"><div class="chip on">Период: всё время</div><div class="chip">Источник: все</div><div class="chip">Участник: все</div>
    <div class="right"><span>Невычитано <b>${MEET.filter((x) => x.st === "review").length}</b></span></div></div>` + base();
})(SCREENS.meetings);

/* спринты: живые вкладки */
SCREENS.sprints = ((base) => function () {
  if (S.tab === "check") return `<div class="panes"><div class="pane"><h3>Чек спринта «Сентябрь, цикл 2»</h3><div class="sub">Что обещали и где стоим · 12 из 19 закрыто</div>
    <div class="rowset">${PROJ.map((p) => `<div><span class="k">${p.n}</span><span class="v">${p.all - p.open} из ${p.all} закрыто</span><span class="a state ${p.open > 4 ? "off" : "on"}">${p.open > 4 ? "отстаёт" : "в графике"}</span></div>`).join("")}</div>
    <div style="margin-top:12px"><button class="btn pri">Закрыть цикл</button><button class="btn" style="margin-left:6px">Перенести хвосты</button></div></div></div>`;
  if (S.tab === "analytics") return `<div class="panes"><div class="pane"><h3>Аналитика цикла</h3><div class="sub">Скорость и распределение нагрузки</div>
    <div class="rowset"><div><span class="k">Закрыто за цикл</span><span class="v">12 задач</span></div>
    <div><span class="k">Средний срок в работе</span><span class="v">3,4 дня</span></div>
    <div><span class="k">Просрочено</span><span class="v">3 задачи</span></div>
    <div><span class="k">Перенесено из прошлого</span><span class="v">5 задач</span></div></div>
    <div class="lab">Нагрузка по людям</div><div class="rowset">${U.map((u, i) => `<div><span class="k">${u.n}</span><span class="v">${[6,5,4,3][i]} задач</span><span class="a state ${i === 0 ? "off" : "on"}">${i === 0 ? "перегруз" : "норма"}</span></div>`).join("")}</div></div></div>`;
  if (S.tab === "journal") return `<div class="panes"><div class="pane"><h3>Журнал перемещений</h3><div class="sub">Кто и когда двигал задачи по доске</div>
    <div class="tl">${[["3 ч назад","А. Ковач","перенёс «Согласовать смету» в «В работе»"],["вчера","М. Дам","вернул «Проверить чек-лист» в «Бэклог»"],["вчера","И. Пет","закрыл «Свести расходы по логистике»"],["2 дня назад","Система","перенесла 5 хвостов в новый цикл"]].map(([w, a, t]) =>
      `<div class="e"><div class="p"></div><div><b>${a}</b> ${t}<div class="w">${w}</div></div></div>`).join("")}</div></div></div>`;
  return base();
})(SCREENS.sprints);

/* настройки: живые действия */
SCREENS.settings = function () {
  const P = {
    profile:[["Имя","А. Ковач","—"],["Telegram","@user","Отвязать"],["Язык интерфейса", S.lang === "RU" ? "Русский" : "English","Переключить"],["Часовой пояс","Europe/Belgrade","Изменить"],["Демо-режим","выключен","—"]],
    integr:[["Google Calendar","подключён · встречи дня","Отключить"],["Granola","подключён · авто-импорт","Отключить"],["Read.ai","вебхук активен","Проверить"],["bumblebee","build 24 · установлен","Обновить"]],
    tokens:[["MCP-токен для Claude Desktop","smcp_••••••••","Перевыпустить"],["Токен рекордера","•••••• ","Перевыпустить"],["Инструкция для Claude Desktop","готова","Открыть"]],
    notif:[["Тезисы готовы","в Telegram и в колокольчик","Выключить"],["Комментарии к задачам","в Telegram","Выключить"],["Ежедневный дайджест","09:00","Изменить время"],["Напоминания по задачам","включены","Выключить"],["Невычитанные встречи","напоминать через 48 ч","Выключить"]],
  }[S.tab];
  return `<div class="panes"><div class="pane"><h3>${TABS.settings.find(([i]) => i === S.tab)[1]}</h3>
    <div class="sub">Настройки применяются к вашему аккаунту</div>
    <div class="rowset">${P.map(([k, v, a]) => `<div><span class="k">${k}</span><span class="v">${v}</span>
      <span class="a">${a === "—" ? "" : `<button class="btn" style="height:26px"${a === "Переключить" ? ' data-lang="1"' : ""}>${a}</button>`}</span></div>`).join("")}</div></div></div>`;
};

/* карта системы */
SCREENS.map = () => `<div class="panes" style="max-width:none"><div class="pane"><h3>Карта системы</h3>
  <div class="sub">Как связаны поверхности, данные и люди</div>
  <svg viewBox="0 0 720 260" style="width:100%;height:auto;font:500 11px var(--font-ui)">
    ${[["bumblebee",40,30],["Granola",40,95],["Read.ai",40,160],["Telegram-бот",40,225]].map(([t, x, y]) =>
      `<g><rect x="${x}" y="${y}" width="112" height="34" rx="8" fill="#fff" stroke="#DDE2E8"/><text x="${x + 56}" y="${y + 21}" text-anchor="middle" fill="#1B2028">${t}</text></g>
       <path d="M${x + 112} ${y + 17} H 268" stroke="#C9D9F0" stroke-width="1.5" fill="none"/>`).join("")}
    <rect x="268" y="95" width="130" height="70" rx="10" fill="#E8EEF8" stroke="#1F4E9C"/><text x="333" y="125" text-anchor="middle" fill="#1F4E9C" font-weight="700">База знаний</text>
    <text x="333" y="143" text-anchor="middle" fill="#5C6672" font-size="10">entries · meetings · tasks</text>
    ${[["Веб «Рой»",520,45],["Claude Desktop (MCP)",520,110],["Уведомления в Telegram",520,175]].map(([t, x, y]) =>
      `<path d="M398 130 H ${x}" stroke="#C9D9F0" stroke-width="1.5" fill="none"/>
       <g><rect x="${x}" y="${y}" width="164" height="34" rx="8" fill="#fff" stroke="#DDE2E8"/><text x="${x + 82}" y="${y + 21}" text-anchor="middle" fill="#1B2028">${t}</text></g>`).join("")}
  </svg></div></div>`;

/* обработчики расширения */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-new],[data-mclose],[data-dtab],[data-bulkclr],[data-ck],[data-ckall],[data-dig],[data-me],[data-lang],[data-fab],[data-readall]");
  if (!t) { $(".menu")?.classList.remove("open"); $(".dig")?.classList.remove("open"); return; }
  if (t.dataset.new === "task") return newTaskModal();
  if (t.dataset.new === "entry") return newEntryModal();
  if (t.dataset.fab) return feedbackModal();
  if (t.dataset.mclose) return closeModal();
  if (t.dataset.dtab) { S.dtab = t.dataset.dtab; return render(); }
  if (t.dataset.bulkclr) { S.bulk.clear(); return render(); }
  if (t.dataset.ckall) { const on = t.checked; document.querySelectorAll("[data-ck]").forEach((c) => { c.checked = on; }); S.bulk = on ? new Set(TASKS.map((x) => x.id)) : new Set(); return render(); }
  if (t.dataset.ck) { const id = +t.closest("tr").dataset.task; S.bulk.has(id) ? S.bulk.delete(id) : S.bulk.add(id); return render(); }
  if (t.dataset.dig) { $(".dig").classList.toggle("open"); $(".menu").classList.remove("open"); return; }
  if (t.dataset.me) { $(".menu").classList.toggle("open"); $(".dig").classList.remove("open"); return; }
  if (t.dataset.lang) { S.lang = S.lang === "RU" ? "EN" : "RU"; return render(); }
});
window.addEventListener("DOMContentLoaded", () => {
  $(".fab").dataset.fab = "1";
  $(".dig").innerHTML = `<h4>Дайджест на сегодня</h4>
    <div class="sec"><h5>Требует вас</h5>
      <div class="li"><i class="d"></i>3 задачи просрочены — смета, франчайзи, санитария</div>
      <div class="li"><i class="d"></i>3 встречи ждут вычитки</div></div>
    <div class="sec"><h5>Встречи сегодня</h5>
      <div class="li"><i class="d"></i>11:00 · Сверка бюджета Q4</div>
      <div class="li"><i class="d"></i>15:30 · Поставщик упаковки</div></div>
    <div class="sec"><h5>Движение за сутки</h5>
      <div class="li"><i class="d"></i>Закрыто 2 задачи, создано 4</div>
      <div class="li"><i class="d"></i>Новых записей в базе: 1</div></div>`;
  $(".menu").innerHTML = `<div class="mi">А. Ковач<span class="a">админ</span></div><div class="sep"></div>
    <div class="mi" data-lang="1">Язык интерфейса<span class="a">${S.lang}</span></div>
    <div class="mi">Воркспейс<span class="a">IMF BD</span></div>
    <div class="mi">Claude Desktop<span class="a">MCP</span></div><div class="sep"></div>
    <div class="mi">Выйти</div>`;
  render();
});
