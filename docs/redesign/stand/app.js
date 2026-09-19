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
    { id:"projects", n:"Проекты", c:7, ic:"M2.5 3.5h11v9h-11zM2.5 6.5h11" },
    { id:"sprints", n:"Спринты", c:2, ic:"M2.5 12.5V7m3.7 5.5v-9m3.6 9v-6m3.7 6v-3" }]},
  { g:"Знание", items:[
    { id:"meetings", n:"Встречи", c:5, ic:"M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3m5-3v3" },
    { id:"base", n:"База", ic:"M3 3.5h4.2a1.8 1.8 0 0 1 1.8 1.8v7.2M13 3.5H8.8A1.8 1.8 0 0 0 7 5.3v7.2" }]},
  { g:"Люди", items:[{ id:"team", n:"Команда", c:12, ic:"M2 13c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6M11 5.6a2 2 0 0 1 0 3.8" }]},
];
const NAVFOOT = [
  { id:"settings", n:"Настройки", ic:"M8 1.8v1.8m0 8.8v1.8m6.2-6.2h-1.8M3.6 8H1.8" },
  { id:"admin", n:"Админ", ic:"M8 2 3 4.2v4c0 3 2.1 5 5 5.8 2.9-.8 5-2.8 5-5.8v-4z" },
  { id:"map", n:"Карта системы", ic:"M6.5 4.5h3a2 2 0 0 1 2 2v3" },
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
  const cnt = (id) => S.sec === "tasks" ? TASKS.filter((x) => x.list === id).length
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
    <div class="chip${S.byMarket ? " on" : ""}" data-tgl="byMarket" tabindex="0">По рынкам</div>
    <div class="chip${S.staff ? " on" : ""}" data-tgl="staff" tabindex="0">Все сотрудники</div>
    <div class="right"><span>Просрочено <b>${TASKS.filter((x) => x.dueK === "now").length}</b></span><span>Показано <b>${rows.length}</b></span></div></div>`;
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
