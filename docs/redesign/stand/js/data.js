/* Тестовые данные стенда. Вымышленные, но по форме — как в продукте:
   статусы open/in_progress/done, приоритеты high/med/low, страны кодами,
   метки списком, встречи с источником, хранилищем и странами. */

const TODAY = "2026-09-20";
const d = (s) => s;                               /* даты храним строкой YYYY-MM-DD */

const USERS = [
  { id: 501, n: "Ана Ковач",        i: "АК", c: "#5B3DEC", role: "admin",   mk: "RS", tg: "@ana_k",    em: "ana@imf.example" },
  { id: 502, n: "Марко Дамьянович", i: "МД", c: "#1F7A5A", role: "ops",     mk: "RS", tg: "@marko_d",  em: "marko@imf.example" },
  { id: 503, n: "Ивана Петрович",   i: "ИП", c: "#B9541A", role: "finance", mk: "RS", tg: "@ivana_p",  em: "ivana@imf.example" },
  { id: 504, n: "Лука Хорват",      i: "ЛХ", c: "#1F4E9C", role: "ops",     mk: "HR", tg: "@luka_h",   em: "luka@imf.example" },
  { id: 505, n: "Анна Новак",       i: "АН", c: "#7A3EA1", role: "hr",      mk: "SI", tg: "@anna_n",   em: "anna@imf.example" },
  { id: 506, n: "Эдин Хаджич",      i: "ЭХ", c: "#166A6A", role: "ops",     mk: "BA", tg: "@edin_h",   em: "edin@imf.example" },
  { id: 507, n: "Никола Йованович", i: "НЙ", c: "#8A4B1E", role: "it",      mk: "RS", tg: "@nikola_j", em: "",                    note: "Подключён к рекордеру, почту не завёл — очередь вычитки не видит" },
  { id: 508, n: "Милица Стоянович", i: "МС", c: "#A03A6B", role: "quality", mk: "RS", tg: "@milica_s", em: "milica@imf.example", note: "Ведёт качество по всем рынкам" },
  { id: 509, n: "Дарко Перич",      i: "ДП", c: "#2B6CB0", role: "ops",     mk: "ME", tg: "@darko_p",  em: "darko@imf.example" },
  { id: 510, n: "Елена Вукович",    i: "ЕВ", c: "#B0451A", role: "market",  mk: "HR", tg: "@jelena_v", em: "jelena@imf.example" },
  { id: 511, n: "Стефан Илич",      i: "СИ", c: "#3A7D34", role: "ops",     mk: "RS", tg: "@stefan_i", em: "",                    note: "Новый в команде с 15 сен, доступ в Telegram выдан" },
  { id: 512, n: "Тамара Кнежевич",  i: "ТК", c: "#6B3FA0", role: "hr",      mk: "SI", tg: "@tamara_k", em: "tamara@imf.example" },
];
const ME = 501;
const CYCLE_ST = { active: "идёт", closed: "закрыт", planned: "запланирован" };

const COUNTRIES = [
  { c: "RS", n: "Сербия" }, { c: "HR", n: "Хорватия" }, { c: "SI", n: "Словения" },
  { c: "BA", n: "Босния" }, { c: "ME", n: "Черногория" }, { c: "MK", n: "Македония" },
];

const WORKSPACES = [
  { id: "cee", name: "IMF BD", users: 12, tasks: 168, entries: 214, active: true },
  { id: "latam", name: "LATAM", users: 4, tasks: 31, entries: 22, active: false },
];

const LABELS = [
  { id: "l1", n: "закупки", ic: "tag" }, { id: "l2", n: "процесс", ic: "flow" },
  { id: "l3", n: "встреча", ic: "cal" }, { id: "l4", n: "отчёт", ic: "doc" },
  { id: "l5", n: "обучение", ic: "book" }, { id: "l6", n: "юр", ic: "shield" },
  { id: "l7", n: "доступы", ic: "key" }, { id: "l8", n: "качество", ic: "star" },
  { id: "l9", n: "франчайзи", ic: "team" }, { id: "l10", n: "регулярно", ic: "repeat" },
];

const PROJECTS = [
  { id: "p1", n: "Открытие CEE", parent: null, own: 501, st: "active",  due: "2026-11-30", d: "Открытие точки в CEE: площадка, оборудование, персонал, запуск." },
  { id: "p1a", n: "Площадка",     parent: "p1", own: 504, st: "active",  due: "2026-10-15", d: "Помещение, ремонт, согласования." },
  { id: "p1b", n: "Оборудование", parent: "p1", own: 502, st: "active",  due: "2026-10-30", d: "Закупка и приёмка кухонного оборудования." },
  { id: "p1c", n: "Персонал",     parent: "p1", own: 505, st: "active",  due: "2026-11-10", d: "Найм и обучение первой смены." },
  { id: "p1d", n: "Маркетинг запуска", parent: "p1", own: 510, st: "planned", due: "2026-11-20", d: "Локальная кампания к открытию." },
  { id: "p2", n: "Операции",      parent: null, own: 502, st: "active",  due: null, d: "Текущие операции: смены, стандарты, контроль качества." },
  { id: "p2a", n: "Смены",        parent: "p2", own: 511, st: "active",  due: null, d: "График и подмены." },
  { id: "p2b", n: "Стандарты",    parent: "p2", own: 508, st: "active",  due: null, d: "Стандарты приготовления и сервиса." },
  { id: "p3", n: "Финансы",       parent: null, own: 503, st: "active",  due: "2026-10-15", d: "Бюджет, сверки, расчёты с поставщиками." },
  { id: "p4", n: "Персонал",      parent: null, own: 505, st: "paused",  due: null, d: "Найм и обучение смен." },
  { id: "p5", n: "IT и интеграции", parent: null, own: 507, st: "active", due: null, d: "Интеграции, доступы, рекордер." },
  { id: "p6", n: "Маркетинг",     parent: null, own: 510, st: "active",  due: null, d: "Акции, локальные кампании, франчайзи." },
];

/* задача: id, заголовок, проект, статус, исполнители, срок, приоритет, метки, страна, ... */
const mkTask = (o) => ({
  id: o.id, t: o.t, pr: o.pr, st: o.st || "open", who: o.who || [], due: o.due || null,
  prio: o.prio || "med", labels: o.labels || [], mk: o.mk || null, recur: o.recur || null,
  priv: !!o.priv, arch: !!o.arch, src: o.src || "manual", by: o.by || 501, at: o.at || "2026-09-10",
  sprint: o.sprint || null, links: o.links || [], subs: o.subs || [], note: o.note || "",
});
const TASKS = [
  mkTask({ id:128, t:"Согласовать смету по оборудованию кухни", pr:"p1b", st:"in_progress", who:[501], due:"2026-09-17", prio:"high", labels:["l1"], mk:"RS", src:"m1", sprint:"c2", note:"Смета от поставщика выше бюджета на 14%. Свести позиции с согласованными и вынести расхождение на планёрку.", links:[["блокирует",141],["связана",132]], subs:[502,503] }),
  mkTask({ id:131, t:"Ответить франчайзи по срокам поставки", pr:"p6", st:"open", who:[501], due:"2026-09-18", prio:"high", labels:["l9","l3"], mk:"RS", src:"m2", sprint:"c2" }),
  mkTask({ id:132, t:"Уточнить санитарные требования по площадке", pr:"p1a", st:"open", who:[504], due:"2026-09-18", prio:"high", labels:["l2","l6"], mk:"RS", src:"m1", sprint:"c2" }),
  mkTask({ id:133, t:"Свести расходы по логистике за август", pr:"p3", st:"done", who:[503], due:"2026-09-12", prio:"med", labels:["l4"], mk:"RS", sprint:"c2" }),
  mkTask({ id:134, t:"Проверить чек-лист приёмки оборудования", pr:"p1b", st:"open", who:[502], due:"2026-09-21", prio:"med", labels:["l2","l8"], mk:"RS", sprint:"c2" }),
  mkTask({ id:135, t:"Назначить ответственного за приёмку мебели", pr:"p1a", st:"open", who:[], due:"2026-09-22", prio:"med", labels:[], mk:"RS", sprint:"c2" }),
  mkTask({ id:136, t:"Подготовить график первой смены", pr:"p1c", st:"in_progress", who:[505], due:"2026-09-23", prio:"med", labels:["l5"], mk:"SI", sprint:"c2" }),
  mkTask({ id:137, t:"Собрать три КП на вывеску", pr:"p1a", st:"done", who:[504], due:"2026-09-11", prio:"low", labels:["l1"], mk:"HR" }),
  mkTask({ id:138, t:"Обновить стандарт приёмки после ревизии", pr:"p2b", st:"open", who:[508], due:"2026-09-25", prio:"med", labels:["l2","l8"], mk:"RS", sprint:"c2" }),
  mkTask({ id:139, t:"Закрыть доступы уволившимся", pr:"p5", st:"open", who:[507], due:"2026-09-19", prio:"high", labels:["l7"], mk:"RS", sprint:"c2" }),
  mkTask({ id:140, t:"Еженедельная сверка кассы", pr:"p3", st:"open", who:[503], due:"2026-09-22", prio:"med", labels:["l4","l10"], mk:"RS", recur:"weekly" }),
  mkTask({ id:141, t:"Подписать договор с поставщиком упаковки", pr:"p3", st:"open", who:[503], due:"2026-09-26", prio:"high", labels:["l1","l6"], mk:"RS", src:"m2", sprint:"c2" }),
  mkTask({ id:142, t:"Провести обучение по новым позициям меню", pr:"p4", st:"open", who:[512], due:"2026-09-29", prio:"med", labels:["l5"], mk:"SI" }),
  mkTask({ id:143, t:"Ежемесячный отчёт по качеству", pr:"p2b", st:"open", who:[508], due:"2026-10-01", prio:"med", labels:["l4","l10"], mk:"RS", recur:"monthly", sprint:"c3" }),
  mkTask({ id:144, t:"Проверить работу второй линии выдачи", pr:"p2", st:"open", who:[511], due:"2026-09-24", prio:"low", labels:["l2"], mk:"RS" }),
  mkTask({ id:145, t:"Согласовать макеты локальной акции", pr:"p6", st:"in_progress", who:[510], due:"2026-09-27", prio:"med", labels:[], mk:"HR", sprint:"c3" }),
  mkTask({ id:146, t:"Настроить вебхук Read.ai на новый воркспейс", pr:"p5", st:"in_progress", who:[507], due:"2026-09-23", prio:"med", labels:["l7"], mk:"RS" }),
  mkTask({ id:147, t:"Собрать обратную связь смены за неделю", pr:"p2a", st:"open", who:[511], due:"2026-09-21", prio:"low", labels:["l10"], mk:"RS", recur:"weekly" }),
  mkTask({ id:148, t:"Проверить сроки по хорватской лицензии", pr:"p1a", st:"open", who:[504], due:"2026-10-05", prio:"med", labels:["l6"], mk:"HR", sprint:"c3" }),
  mkTask({ id:149, t:"Договориться о встрече с арендодателем", pr:"p1a", st:"done", who:[504], due:"2026-09-09", prio:"med", labels:["l3"], mk:"HR" }),
  mkTask({ id:150, t:"Разобрать очередь вычитки за неделю", pr:"p5", st:"open", who:[501], due:"2026-09-20", prio:"med", labels:["l10"], mk:null, recur:"weekly" }),
  mkTask({ id:151, t:"Обновить bumblebee на рабочих ноутбуках", pr:"p5", st:"open", who:[507], due:"2026-09-28", prio:"low", labels:["l7"], mk:"RS" }),
  mkTask({ id:152, t:"Сверить остатки по складу в Нови-Саде", pr:"p2", st:"open", who:[502], due:"2026-09-24", prio:"med", labels:[], mk:"RS" }),
  mkTask({ id:153, t:"Личное: подготовить разговор по ставкам", pr:"p4", st:"open", who:[501], due:"2026-09-25", prio:"med", labels:[], mk:null, priv:true }),
  mkTask({ id:154, t:"Проверить боснийского поставщика теста", pr:"p1b", st:"open", who:[506], due:"2026-09-30", prio:"med", labels:["l1"], mk:"BA" }),
  mkTask({ id:155, t:"Завести доступы новой смене", pr:"p5", st:"open", who:[], due:"2026-09-26", prio:"low", labels:["l7"], mk:"RS" }),
  mkTask({ id:156, t:"Свести бюджет открытия к финальной версии", pr:"p3", st:"in_progress", who:[503], due:"2026-10-03", prio:"high", labels:["l4"], mk:"RS", sprint:"c2" }),
  mkTask({ id:157, t:"Черногория: проверить условия аренды", pr:"p1a", st:"open", who:[509], due:"2026-10-08", prio:"low", labels:["l6"], mk:"ME" }),
  mkTask({ id:158, t:"Македония: собрать контакты подрядчиков", pr:"p1a", st:"open", who:[], due:null, prio:"low", labels:[], mk:"MK" }),
  mkTask({ id:159, t:"Перезвонить в санитарную службу", pr:"p1a", st:"open", who:[], due:"2026-09-19", prio:"high", labels:["l2"], mk:"RS", sprint:"c2" }),
  mkTask({ id:160, t:"Выложить график смен на неделю", pr:"p2a", st:"open", who:[], due:"2026-09-20", prio:"med", labels:[], mk:"RS" }),
  mkTask({ id:120, t:"Выбрать подрядчика на вывеску", pr:"p1a", st:"done", who:[504], due:"2026-09-05", prio:"med", labels:["l1"], mk:"HR", arch:true }),
  mkTask({ id:121, t:"Старый регламент открытия смены", pr:"p2a", st:"done", who:[511], due:"2026-08-28", prio:"low", labels:["l2"], mk:"RS", arch:true }),
  mkTask({ id:122, t:"Разовая закупка посуды", pr:"p1b", st:"done", who:[502], due:"2026-08-30", prio:"low", labels:["l1"], mk:"RS", arch:true }),
  mkTask({ id:123, t:"Тестовая задача из бота", pr:"p5", st:"done", who:[507], due:"2026-08-20", prio:"low", labels:[], mk:null, arch:true, src:"bot" }),
];

const COMMENTS = {
  128: [ { who:502, w:"вчера, 16:20", t:"Поставщик держит цену до конца недели." },
         { who:501, w:"3 ч назад",    t:"Свожу позиции, к планёрке будет разбивка по строкам." } ],
  132: [ { who:504, w:"2 дня назад",  t:"Запросил у санитарной службы, обещали ответ на неделе." } ],
  141: [ { who:503, w:"вчера",        t:"Юрист просит добавить пункт про индексацию." } ],
};
const HISTORY = {
  128: [ { w:"3 ч назад", who:501, t:"перевёл в «В работе»" }, { w:"вчера", who:502, t:"поменял срок на 17 сен" },
         { w:"15 сен", who:501, t:"создал из встречи «Планёрка по открытию»" } ],
  132: [ { w:"18 сен", who:504, t:"взял в работу" }, { w:"15 сен", who:501, t:"создал из встречи" } ],
};

const TEZISY = [
  { h:"Закупки", li:["Смета выше бюджета на 14%, поставщик держит цену до пятницы.","Нужна разбивка по позициям к следующей планёрке."] },
  { h:"Площадка", li:["Санитарные требования уточняются, ответ ожидается на неделе."] },
  { h:"Решения", li:["Подрядчика на вывеску утвердили."] },
];
const TRANSCRIPT = [
  ["00:02", 501, "Начнём со сметы. Поставщик прислал финальную версию вчера вечером."],
  ["00:14", 502, "Она выше бюджета. Если считать с доставкой — на четырнадцать процентов."],
  ["01:05", 501, "Держит ли он цену, если мы ответим не сразу?"],
  ["01:12", 502, "До пятницы держит, дальше пересчёт по курсу."],
  ["03:40", 504, "По площадке: санитарные требования ещё уточняем, ответ обещали на неделе."],
  ["05:21", 501, "Подрядчика на вывеску утверждаем? Возражений нет — утвердили."],
  ["07:03", 503, "Тогда я закладываю в бюджет верхнюю границу и правлю после ответа поставщика."],
];

const mkMeet = (o) => ({ ...o, tez: o.tez || TEZISY, tr: o.tr || TRANSCRIPT, tasks: o.tasks || [] });
const MEETINGS = [
  mkMeet({ id:"m1", t:"Планёрка по открытию", dt:"2026-09-15 10:00", dur:48, who:[501,502,504], src:"bumblebee", st:"confirmed", store:"shared", cc:["RS"], tasks:[128,132,135], claim:{ dev:"MacBook Pro · build 24", at:"10:00", lease:"10:48", defer:0, other:true } }),
  mkMeet({ id:"m2", t:"Поставщик упаковки — переговоры", dt:"2026-09-16 14:30", dur:32, who:[501,503], src:"Granola", st:"pending", store:"shared", cc:["RS"], tasks:[131,141] }),
  mkMeet({ id:"m3", t:"Сверка бюджета Q4", dt:"2026-09-17 11:00", dur:55, who:[502,503,509], src:"Read.ai", st:"pending", store:"shared", cc:["RS","ME"], tasks:[156] }),
  mkMeet({ id:"m4", t:"Онбординг новой смены", dt:"2026-09-12 09:00", dur:41, who:[505,512], src:"bumblebee", st:"confirmed", store:"shared", cc:["SI"], tasks:[136,142], claim:{ dev:"MacBook Air · build 24", at:"09:00", lease:"09:41", defer:0, other:true } }),
  mkMeet({ id:"m5", t:"Ревизия меню", dt:"2026-09-10 16:00", dur:27, who:[501,508], src:"Granola", st:"confirmed", store:"shared", cc:["RS"], tasks:[138] }),
  mkMeet({ id:"m6", t:"Запись без названия", dt:"2026-09-18 12:04", dur:18, who:[501], src:"bumblebee", st:"draft", store:"shared", cc:[], tasks:[], claim:{ dev:"MacBook Pro · build 24", at:"12:04", lease:"12:26", defer:6, other:true } }),
  mkMeet({ id:"m7", t:"Разговор с арендодателем", dt:"2026-09-05 13:00", dur:36, who:[504], src:"bumblebee", st:"confirmed", store:"personal", cc:["HR"], tasks:[149], claim:{ dev:"MacBook Pro · build 23", at:"13:00", lease:"13:36", defer:0, other:false } }),
  mkMeet({ id:"m8", t:"Еженедельная операционка", dt:"2026-09-19 09:30", dur:44, who:[502,508,511], src:"Read.ai", st:"pending", store:"shared", cc:["RS"], tasks:[144,147] }),
  mkMeet({ id:"m9", t:"Босния: поставщик теста", dt:"2026-09-14 15:00", dur:29, who:[506,502], src:"Granola", st:"confirmed", store:"shared", cc:["BA"], tasks:[154] }),
  mkMeet({ id:"m10", t:"Хорватия: лицензия и сроки", dt:"2026-09-08 11:30", dur:38, who:[504,510], src:"bumblebee", st:"confirmed", store:"shared", cc:["HR"], tasks:[148], claim:{ dev:"MacBook Pro · build 23", at:"11:30", lease:"12:08", defer:2, other:true } }),
  mkMeet({ id:"m11", t:"Черновик 16 сен 14:28", dt:"2026-09-16 14:28", dur:12, who:[501], src:"bumblebee", st:"draft", store:"shared", cc:[], tasks:[], claim:{ dev:"MacBook Pro · build 24", at:"14:28", lease:"14:40", defer:0, other:false } }),
  mkMeet({ id:"m12", t:"Личное: разговор о ставках", dt:"2026-09-13 17:00", dur:22, who:[501], src:"Granola", st:"confirmed", store:"personal", cc:[], tasks:[] }),
];

/* очередь вычитки агентских встреч (в продукте — самый большой экран) */
const AGENT_QUEUE = [
  { id:"a1", t:"Планёрка по логистике", dt:"2026-09-19 10:00", src:"agent", who:[502,511], dup:null,
    tez:[{h:"Логистика",li:["Задержка поставки на два дня, перенесли приёмку.","Нужен резервный перевозчик."]}],
    tasks:[{t:"Найти резервного перевозчика", who:502, due:"2026-09-24"},{t:"Перенести приёмку на четверг", who:511, due:"2026-09-22"}], cc:["RS"] },
  { id:"a2", t:"Встреча с франчайзи (Загреб)", dt:"2026-09-18 16:00", src:"agent", who:[510,504], dup:"m10",
    tez:[{h:"Франчайзи",li:["Просят пересмотреть сроки поставки оборудования."]}],
    tasks:[{t:"Ответить франчайзи по срокам", who:510, due:"2026-09-21"}], cc:["HR"] },
  { id:"a3", t:"Обсуждение стандартов качества", dt:"2026-09-17 14:00", src:"agent", who:[508], dup:null,
    tez:[{h:"Качество",li:["Чек-лист смены расширяем на две позиции."]}],
    tasks:[{t:"Обновить чек-лист смены", who:508, due:"2026-09-26"}], cc:["RS"] },
];

const ENTRIES = [
  { id:"r1", ty:"meeting",    h:"Планёрка по открытию — тезисы", p:"Смета выше бюджета на 14%. Поставщик держит цену до конца недели. Санитарные требования уточняются.", at:"2026-09-15", who:501, cc:["RS"], priv:false, meet:"m1", ix:{ n:14, at:"15 сен" } },
  { id:"r2", ty:"document",   h:"Стандарт приёмки оборудования", p:"Порядок приёмки, чек-лист по позициям, что делать при расхождении комплектации.", at:"2026-09-11", who:502, cc:["RS"], priv:false, ix:{ n:22, at:"11 сен" } },
  { id:"r3", ty:"note",       h:"Контакты подрядчиков по вывескам", p:"Три подрядчика с ценами и сроками, лучший по срокам — второй.", at:"2026-09-09", who:504, cc:["HR"], priv:false, ix:{ n:4, at:"9 сен" } },
  { id:"r4", ty:"transcript", h:"Переговоры с арендодателем", p:"Полный транскрипт: условия по индексации, срок договора, обеспечительный платёж.", at:"2026-09-05", who:504, cc:["HR"], priv:true, meet:"m7", ix:{ n:41, at:"5 сен" } },
  { id:"r5", ty:"summary",    h:"Итоги августа по операциям", p:"Сводка по сменам, потерям и обучению за август.", at:"2026-09-01", who:502, cc:["RS"], priv:false, ix:{ n:9, at:"1 сен" } },
  { id:"r6", ty:"document",   h:"Меню и себестоимость позиций", p:"Таблица позиций с себестоимостью и наценкой, помечены позиции с локальными поставщиками.", at:"2026-08-28", who:508, cc:["RS"], priv:false, ix:{ n:9, at:"28 авг" } },
  { id:"r7", ty:"note",       h:"Санитарные требования — выписка", p:"Что требует служба по вентиляции и мойке, сроки согласования.", at:"2026-09-12", who:504, cc:["RS"], priv:false, ix:{ n:6, at:"12 сен" } },
  { id:"r8", ty:"meeting",    h:"Ревизия меню — тезисы", p:"Две позиции выводим, одну оставляем с новой ценой.", at:"2026-09-10", who:508, cc:["RS"], priv:false, meet:"m5", ix:{ n:7, at:"10 сен" } },
  { id:"r9", ty:"link",       h:"Реестр поставщиков (Google Sheets)", p:"Общая таблица поставщиков по странам, ведёт закупка.", at:"2026-09-03", who:503, cc:[], priv:false, ix:{ n:0, at:"—" } },
  { id:"r10", ty:"document",  h:"Договор аренды — рабочая версия", p:"Версия с правками юриста: индексация, срок, обеспечительный платёж.", at:"2026-09-04", who:503, cc:["HR"], priv:true, ix:{ n:31, at:"4 сен" } },
  { id:"r11", ty:"transcript",h:"Босния: поставщик теста", p:"Транскрипт разговора с поставщиком, условия и минимальная партия.", at:"2026-09-14", who:506, cc:["BA"], priv:false, meet:"m9", ix:{ n:12, at:"14 сен" } },
  { id:"r12", ty:"summary",   h:"Неделя 38 — сводка по открытию", p:"Что сделано за неделю, где отстаём, что просит решения.", at:"2026-09-19", who:501, cc:["RS"], priv:false, ix:{ n:5, at:"19 сен" } },
  { id:"r13", ty:"note",      h:"Идеи локальной акции к запуску", p:"Три варианта механики, оценка бюджета по каждому.", at:"2026-09-16", who:510, cc:["HR","RS"], priv:false, ix:{ n:3, at:"16 сен" } },
  { id:"r14", ty:"document",  h:"Регламент открытия смены", p:"Пошаговый порядок открытия: касса, оборудование, заготовки.", at:"2026-08-25", who:511, cc:["RS"], priv:false, ix:{ n:11, at:"25 авг" } },
];

const FILES = [
  { id:"f1", n:"Смета_оборудование_v3.xlsx", ty:"xlsx", sz:"248 КБ", rec:"r2", who:502, at:"2026-09-15", ix:"14 фрагментов" },
  { id:"f2", n:"Договор_аренды_подписанный.pdf", ty:"pdf", sz:"1,2 МБ", rec:"r10", who:503, at:"2026-09-05", ix:"41 фрагмент" },
  { id:"f3", n:"Планировка_зала.png", ty:"png", sz:"860 КБ", rec:"r2", who:504, at:"2026-09-11", ix:"не индексируется" },
  { id:"f4", n:"Меню_себестоимость.xlsx", ty:"xlsx", sz:"96 КБ", rec:"r6", who:508, at:"2026-08-28", ix:"9 фрагментов" },
  { id:"f5", n:"Стандарт_приёмки.docx", ty:"docx", sz:"54 КБ", rec:"r2", who:502, at:"2026-09-11", ix:"в очереди" },
  { id:"f6", n:"Санитарные_требования.pdf", ty:"pdf", sz:"420 КБ", rec:"r7", who:504, at:"2026-09-12", ix:"6 фрагментов" },
  { id:"f7", n:"Сводка_август.xlsx", ty:"xlsx", sz:"132 КБ", rec:"r5", who:502, at:"2026-09-01", ix:"9 фрагментов" },
  { id:"f8", n:"Макеты_акции.png", ty:"png", sz:"2,1 МБ", rec:"r13", who:510, at:"2026-09-16", ix:"не индексируется" },
  { id:"f9", n:"Регламент_смены.docx", ty:"docx", sz:"38 КБ", rec:"r14", who:511, at:"2026-08-25", ix:"11 фрагментов" },
];

const CYCLES = [
  { id:"c2", n:"Сентябрь, цикл 2", from:"2026-09-08", to:"2026-09-28", st:"active" },
  { id:"c1", n:"Сентябрь, цикл 1", from:"2026-08-25", to:"2026-09-07", st:"closed" },
  { id:"c3", n:"Октябрь, цикл 1",  from:"2026-09-29", to:"2026-10-12", st:"planned" },
];
const INITIATIVES = [
  { id:"i1", t:"Запустить приёмку оборудования", pr:"p1b", own:502, st:"accepted",    pts:5, tasks:[128,134] },
  { id:"i2", t:"Закрыть санитарные согласования", pr:"p1a", own:504, st:"in_progress", pts:3, tasks:[132] },
  { id:"i3", t:"Финальный бюджет открытия",       pr:"p3",  own:503, st:"in_progress", pts:8, tasks:[156,141] },
  { id:"i4", t:"Первая смена набрана и обучена",  pr:"p1c", own:505, st:"proposed",    pts:5, tasks:[136] },
  { id:"i5", t:"Доступы и интеграции в порядке",  pr:"p5",  own:507, st:"proposed",    pts:2, tasks:[139,146] },
];

/* календарь дня: приходит из Google Calendar, встречи ещё не записаны */
const CALENDAR = [
  { at:"11:00", t:"Сверка бюджета Q4", who:[502,503,509], place:"Google Meet", rec:true },
  { at:"15:30", t:"Поставщик упаковки — повтор", who:[501,503], place:"офис, переговорная", rec:false },
  { at:"17:00", t:"Онбординг: вторая смена", who:[505,512], place:"Google Meet", rec:true },
];

const NOTIF = [
  { t:"Тезисы встречи готовы", s:"«Сверка бюджета Q4» — можно вычитать", w:"12 мин назад", go:["meetings","m3"], unread:true },
  { t:"Комментарий к задаче 128", s:"М. Дамьянович: поставщик держит цену до конца недели", w:"3 ч назад", go:["tasks",128], unread:true },
  { t:"Задача просрочена", s:"«Ответить франчайзи по срокам поставки»", w:"вчера", go:["tasks",131], unread:true },
  { t:"Черновик рекордера", s:"Запись 18 сен ждёт разбора", w:"вчера", go:["meetings","m6"], unread:false },
  { t:"Вас добавили в подписчики", s:"Задача 141 «Подписать договор с поставщиком упаковки»", w:"2 дня назад", go:["tasks",141], unread:false },
];

const FEEDBACK = [
  { id:"fb1", cat:"recorder", t:"Не поймал вторую сторону в Zoom", who:504, at:"2026-09-18", st:"open" },
  { id:"fb2", cat:"search",   t:"Поиск не находит по части слова", who:508, at:"2026-09-17", st:"open" },
  { id:"fb3", cat:"tasks",    t:"Хочу массовую смену исполнителя", who:502, at:"2026-09-16", st:"resolved" },
  { id:"fb4", cat:"meetings", t:"Тезисы слишком длинные", who:501, at:"2026-09-14", st:"resolved" },
  { id:"fb5", cat:"ui",       t:"На ноутбуке всё мелкое", who:503, at:"2026-09-12", st:"open" },
  { id:"fb6", cat:"claude",   t:"MCP отваливается раз в день", who:507, at:"2026-09-11", st:"open" },
];
const FEEDBACK_CATS = [
  ["recorder","bumblebee"],["meetings","Встречи"],["search","Поиск"],["tasks","Задачи"],
  ["knowledge","База знаний"],["digest","Дайджест"],["auth","Вход / доступ"],
  ["integrations","Интеграции"],["claude","Claude / MCP"],["ui","Интерфейс"],["other","Другое"],
];

const BROADCASTS = [
  { at:"2026-09-15", who:501, to:"весь воркспейс", t:"В пятницу планёрка в 10:00, тезисы придут в бот." },
  { at:"2026-09-02", who:501, to:"админы", t:"Обновите bumblebee до build 24." },
];

const NOTIF_PREFS = [
  { id:"tez",     n:"Тезисы готовы",         d:"в Telegram и в колокольчик", on:true },
  { id:"comment", n:"Комментарии к задачам", d:"в Telegram",                 on:true },
  { id:"digest",  n:"Ежедневный дайджест",   d:"09:00, будни",               on:true },
  { id:"remind",  n:"Напоминания по задачам", d:"за день до срока",          on:true },
  { id:"unread",  n:"Невычитанные встречи",  d:"напоминать через 48 ч",      on:false },
];
const TOKENS = [
  { id:"mcp", n:"MCP-токен для Claude Desktop", v:"smcp_••••••••", at:"1 сен" },
  { id:"rec", n:"Токен рекордера",              v:"••••••",        at:"12 сен" },
];
const INTEGRATIONS = [
  { id:"google",  n:"Google Calendar", st:"on",  d:"ana@imf.example · встречи дня" },
  { id:"granola", n:"Granola",         st:"on",  d:"авто-импорт заметок" },
  { id:"readai",  n:"Read.ai",         st:"on",  d:"вебхук активен" },
  { id:"bee",     n:"bumblebee",       st:"on",  d:"build 24 · установлен 12 сен" },
  { id:"mcp",     n:"Claude Desktop (MCP)", st:"on", d:"токен smcp_•••• · выпущен 1 сен" },
];
