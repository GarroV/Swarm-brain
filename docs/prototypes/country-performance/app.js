'use strict';

// Standalone design study. All people, tasks, venues and measurements are fictional.
const VIEWS = [
  ['matrix', 'Матрица стран', 'Сравнение в одной плоскости'],
  ['cockpit', 'Пульт страны', 'Одна страна, вся картина'],
  ['attention', 'Требует внимания', 'От сигнала к действию'],
  ['columns', 'Четыре колонки', 'Каждая страна — свой контекст'],
  ['overview', 'Аналитический обзор', 'От общего к конкретной точке'],
];
const DEMO_COUNTRY_DATA = {
  RS: { name:'Сербия', currency:'RSD', quality:[89.4,91.8], inspections:[2,3,'Белград · Центр','12 ноября'],
    units:[
      ['rs1','Белград · Центр',1800000,1700000,1620000,1800,1740,1610,31,29,30,9.2,10,10.5,690,690,810],
      ['rs2','Белград · Юг',1300000,1500000,1260000,1400,1530,1290,34,30,32,10.4,10.9,11,330,420,390],
      ['rs3','Нови-Сад · Центр',900000,1100000,910000,1010,1190,1020,28,29,29,8.8,9.5,9.1,240,450,300],
    ] },
  BG: { name:'Болгария', currency:'EUR', quality:[93.2,95.1], inspections:[3,3,'София · Центр','13 ноября'],
    units:[
      ['bg1','София · Центр',140000,130000,124000,1740,1680,1560,29,30,31,9.1,9.4,9.8,180,240,300],
      ['bg2','София · Юг',100000,102000,92000,1220,1250,1160,32,31,33,9.8,10.2,10.4,270,330,420],
      ['bg3','Пловдив · Центр',70000,68000,60000,850,810,740,30,32,31,10.1,10.7,11,150,210,240],
    ] },
  HR: { name:'Хорватия', currency:'EUR', quality:[92.8,94], inspections:[1,2,'Загреб · Центр','11 ноября'],
    units:[
      ['hr1','Загреб · Центр',130000,138000,118000,1580,1660,1500,30,31,32,10.1,9.8,10.2,420,390,450],
      ['hr2','Загреб · Восток',92000,97000,84000,1130,1200,1040,32,30,31,10.3,10.1,10.6,300,330,390],
      ['hr3','Сплит · Центр',58000,60000,54000,720,740,680,null,29,30,9.8,9.6,10.2,180,240,270],
    ] },
  SI: { name:'Словения', currency:'EUR', quality:[95.1,96.3], inspections:[2,2,'Любляна · Центр','14 ноября'],
    units:[
      ['si1','Любляна · Центр',88000,80000,76000,1050,970,910,27,29,29,8.4,9,9.2,90,150,180],
      ['si2','Любляна · Север',67000,62000,58000,810,750,710,28,29,30,8.8,9.2,9.4,120,180,210],
      ['si3','Марибор · Центр',43000,40000,36000,520,480,430,29,31,31,9.2,9.6,10,90,150,180],
    ] },
};
// Supported codes and names mirror miniapp/src/lib/countries.ts; fixtures exist only above.
const COUNTRY_NAMES = {
  RS:'Сербия', HR:'Хорватия', SI:'Словения', ME:'Черногория', BG:'Болгария',
  ES:'Испания', RO:'Румыния', PL:'Польша', EE:'Эстония', LT:'Литва', CY:'Кипр',
  HU:'Венгрия', MD:'Молдова', BY:'Беларусь', TR:'Турция', AZ:'Азербайджан',
  AM:'Армения', GE:'Грузия', TJ:'Таджикистан', KG:'Кыргызстан', MN:'Монголия',
  NG:'Нигерия', MX:'Мексика', ID:'Бали/Индонезия', RU:'Россия', UA:'Украина', KZ:'Казахстан',
};
const COUNTRY_INFO = Object.fromEntries(Object.entries(COUNTRY_NAMES).map(([code,name])=>[
  code, DEMO_COUNTRY_DATA[code] || {name,currency:'',units:[],quality:null,inspections:null},
]));
const MAX_COUNTRIES = 8;
const METRICS = [
  {key:'revenue', label:'Выручка', unit:'money', lower:false, help:'Выручка без НДС по точкам страны, без конвертации валют. Закрытые дни 1–14 ноября.'},
  {key:'orders', label:'Заказы', unit:'', lower:false, help:'Количество заказов за закрытые дни 1–14 ноября.'},
  {key:'delivery', label:'Доставка', unit:'мин', lower:true, help:'Среднее время доставки, взвешенное по заказам. Меньше — лучше. При пропуске точки итог не рассчитывается.'},
  {key:'kitchen', label:'Приготовление в ресторане', unit:'мин', lower:true, help:'Среднее время приготовления в ресторане, взвешенное по заказам. Меньше — лучше.'},
  {key:'stops', label:'Стопы', unit:'мин', lower:true, help:'Суммарные ресторан-минуты на стопе за период. Время разных точек суммируется. Меньше — лучше.'},
  {key:'certificates', label:'Сертификаты за опоздание', unit:'шт.', lower:true, help:'Пример количества сертификатов за опоздание (delivery/vouchers). Это не число опоздавших заказов. Меньше — лучше.'},
];
const CERTIFICATE_EXAMPLES = {
  rs1:[12,15,18], rs2:[18,16,20], rs3:[8,12,10],
  bg1:[9,12,14], bg2:[11,13,15], bg3:[6,8,10],
  hr1:[14,12,16], hr2:[10,11,13], hr3:[5,7,9],
  si1:[4,7,8], si2:[5,8,9], si3:[3,5,6],
};
const STORAGE_KEY = 'swarm-country-design-v1';
const store = {
  read() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } },
  write(value) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Session-only fallback. */ } },
};
const saved = store.read() || {};
const HOME_BLOCKS = [
  ['reminders','Напоминания и объявления','Задания, вычитка и сообщения команды'],
  ['meetings','Ближайшие встречи','Расписание и переход к созвону'],
  ['tasks','Ближайшие задачи','Пять ближайших задач со сроками'],
  ['quality','Рейтинги и проверки','РС, РКО и выездные проверки'],
  ['units','Пиццерии','Разбивка выбранной страны по точкам'],
];
const state = {
  view:'matrix', country:'RS', mode:'MoM', unit:null, metric:'revenue',
  countries:Array.isArray(saved.countries) ? [...new Set(saved.countries.filter(code => typeof code==='string'&&Object.hasOwn(COUNTRY_INFO,code)))].slice(0,MAX_COUNTRIES) : ['RS','BG','HR','SI'],
  dark:saved.dark === true, tasks:new Set(),
  home:Object.fromEntries(HOME_BLOCKS.map(([key])=>[key,typeof saved.home?.[key]==='boolean'?saved.home[key]:true])),
  acknowledged:new Set(Array.isArray(saved.acknowledged)?saved.acknowledged:[]),
};
if (!state.countries.length) state.countries = ['RS'];
const app = document.getElementById('app');
const dialog = document.getElementById('detail-dialog');
let returnFocus = null;
let marketDraft = null;
const fmt = (n, digits=0) => n==null?'—':new Intl.NumberFormat('ru-RU', {maximumFractionDigits:digits,minimumFractionDigits:digits}).format(n);
const esc = text => String(text).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const icons = {
  home:'<path d="m3 10 7-6 7 6v7H6v-7M8 17v-5h4v5"/>',
  task:'<rect x="4" y="4" width="12" height="13" rx="2"/><path d="m7 10 2 2 4-4M7 4V2m6 2V2"/>',
  calendar:'<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M6 2v5m8-5v5M3 9h14m-10 3h2m3 0h2"/>',
  projects:'<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/>',
  base:'<path d="M4 3h10l3 3v11H4zM13 3v4h4M7 10h7m-7 3h5"/>',
  chart:'<path d="M3 3v14h14M6 13V9m4 4V5m4 8V7"/>',
  search:'<circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/>',
  settings:'<path d="m8 3 4 0 1 3 3 1 1 4-3 2-1 3-4 1-2-3-3-1-1-4 3-2z"/><circle cx="10" cy="10" r="2.4"/>',
  arrow:'<path d="M4 10h12m-5-5 5 5-5 5"/>',
  chevron:'<path d="m7 5 5 5-5 5"/>',
  sun:'<circle cx="10" cy="10" r="3.3"/><path d="M10 1v2m0 14v2M1 10h2m14 0h2M3.6 3.6 5 5m10 10 1.4 1.4M3.6 16.4 5 15M15 5l1.4-1.4"/>',
  moon:'<path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z"/>',
  bell:'<path d="M4 14h12l-2-3V7a4 4 0 0 0-8 0v4zM8 17h4"/>',
  pin:'<path d="m7 3 8 2-3 4 1 4-4-1-4 3 1-6zM8 12l-4 5"/>',
  video:'<rect x="3" y="5" width="10" height="10" rx="2"/><path d="m13 8 4-2v8l-4-2"/>',
  alert:'<path d="m10 2 8 15H2zM10 7v5m0 2v1"/>',
  clock:'<circle cx="10" cy="10" r="7"/><path d="M10 6v5l3 2"/>',
  close:'<path d="m5 5 10 10M5 15 15 5"/>',
};
const icon = (name, size=16) => `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.chart}</svg>`;
const mark = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 8.6 5v10L12 22l-8.6-5V7L12 2Z" stroke="currentColor" stroke-width="1.7"/><path d="m6.5 8.8 5.5 3.1 5.5-3.1M12 12v6M7 7l5 3 5-3" stroke="currentColor" stroke-width="1.7"/></svg>';

function units(code) {
  return COUNTRY_INFO[code].units.map(a => ({
    id:a[0], name:a[1], revenue:a[2], revenueMoM:a[3], revenueYoY:code==='BG'?null:a[4],
    orders:a[5], ordersMoM:a[6], ordersYoY:a[7],
    delivery:a[8], deliveryMoM:a[9], deliveryYoY:a[10],
    kitchen:a[11], kitchenMoM:a[12], kitchenYoY:a[13],
    stops:a[14], stopsMoM:a[15], stopsYoY:a[16],
    certificates:CERTIFICATE_EXAMPLES[a[0]][0],
    certificatesMoM:CERTIFICATE_EXAMPLES[a[0]][1],
    certificatesYoY:CERTIFICATE_EXAMPLES[a[0]][2],
    stale:a[0] === 'bg3', missing:a[8] === null,
  }));
}
function aggregate(code) {
  const list = units(code), result = {stale:list.some(x=>x.stale), missing:list.some(x=>x.missing),demoMissing:list.length===0};
  for (const suffix of ['', 'MoM', 'YoY']) {
    for (const key of ['revenue','orders','stops','certificates']) result[key+suffix] = !list.length||list.some(u=>u[key+suffix]==null) ? null : list.reduce((sum,u)=>sum+u[key+suffix],0);
    for (const key of ['delivery','kitchen']) {
      result[key+suffix] = !list.length||list.some(u=>u[key+suffix] == null) ? null : list.reduce((sum,u)=>sum+u[key+suffix]*u['orders'+suffix],0)/result['orders'+suffix];
    }
  }
  return result;
}
function comparisonDate() {
  return state.mode === 'YoY' ? '01–14.11.2025' : '01–14.10.2026';
}
function reference(data, key, code) {
  if (state.mode === 'LFL' || (state.mode === 'YoY' && code === 'BG' && key === 'revenue')) return null;
  return data[key+state.mode] ?? null;
}
function displayValue(value, metric, code, compact=false) {
  if (value == null) return '<span class="metric-value">—</span>';
  let number = fmt(value,metric.unit==='мин' && metric.key!=='stops' ? 1 : 0);
  if (metric.key === 'revenue' && compact) number = value >= 1000000 ? `${fmt(value/1000000,1)} млн` : `${fmt(value/1000,0)} тыс.`;
  const unit = metric.unit === 'money' ? COUNTRY_INFO[code].currency : metric.unit;
  return `<span class="metric-value">${number}${unit ? `<span class="unit">${unit}</span>` : ''}</span>`;
}
function delta(data, metric, code, short=false) {
  if (data.demoMissing) return '<span class="no-data">Демо-данных нет</span>';
  if (data[metric.key] == null) return `<span class="status-label">${data.id?'Нет данных по точке':'Нет данных · 1 из 3 точек'}</span><span class="no-data">${data.id?'Сравнение недоступно':'Итог не рассчитан'}</span>`;
  if (state.mode === 'LFL') {
    const detail = ['revenue','orders'].includes(metric.key) ? 'Сопоставимые пиццерии: период проверяется' : 'Нет сопоставимых данных';
    return `<span class="no-data">${detail}</span>`;
  }
  if (state.mode === 'YoY' && code === 'BG' && metric.key === 'revenue') return '<span class="no-data">Валюта изменилась: BGN → EUR<br>Нужна приведённая база</span>';
  const current=data[metric.key], previous=reference(data,metric.key,code);
  if (previous == null || previous === 0) return '<span class="no-data">Нет базы сравнения</span>';
  const percent = (current-previous)/previous*100;
  const good = metric.lower ? percent<0 : percent>0;
  const symbol = percent<0 ? '▼' : percent>0 ? '▲' : '→';
  const signed = (n,d=0) => `${n>0?'+':n<0?'−':''}${fmt(Math.abs(n),d)}`;
  const diffUnit = metric.unit === 'money' ? COUNTRY_INFO[code].currency : metric.unit;
  const diff = signed(current-previous,metric.unit==='мин' && metric.key!=='stops'?1:0);
  const comparison = `${diff}${diffUnit?' '+diffUnit:''} · было ${fmt(previous,metric.unit==='мин'&&metric.key!=='stops'?1:0)}`;
  return `<span class="delta ${percent===0?'muted':good?'good':'bad'}" aria-label="${percent<0?'Снижение':'Рост'} на ${fmt(Math.abs(percent),1)} процента">${symbol} ${signed(percent,1)}%${short ? '' : `<span class="comparison">${comparison}</span>`}</span>`;
}
function metricHTML(data, metric, code, compact=false) {
  return `${displayValue(data[metric.key],metric,code,compact)}${delta(data,metric,code)}`;
}
function metricTile(data, metric, code, compact=false) {
  return `<div class="metric-tile${compact?' compact':''}"><div class="metric-label"><span class="metric-help" title="${esc(metric.help)}">${metric.label}</span></div>${metricHTML(data,metric,code,compact)}</div>`;
}
function metrics(code, omitRevenue=false) {
  const data=aggregate(code);
  return `<div class="metric-grid">${METRICS.filter(m=>!omitRevenue||m.key!=='revenue').map(m=>metricTile(data,m,code)).join('')}</div>`;
}
function freshness(code) {
  const d=aggregate(code);
  if(d.demoMissing) return '<span class="muted">Нет демонстрационных данных</span>';
  if(d.stale) return '<span class="warn"><span class="dot"></span>Одна точка: обновление 14 ноя, 07:20</span>';
  if(d.missing) return '<span class="warn"><span class="dot"></span>Доставка: нет данных по одной точке</span>';
  return '<span class="status-fresh"><span class="dot"></span>Обновлено 15 ноя, 08:10 CET</span>';
}
function countryChips() {
  return `<div class="country-chips" aria-label="Выбрать страну">${state.countries.map(code=>`<button class="country-chip ${state.country===code?'selected':''}" data-country="${code}" aria-pressed="${state.country===code}"><span class="code">${code}</span>${COUNTRY_INFO[code].name}<small>${DEMO_COUNTRY_DATA[code]?'3 точки':'Демо-данных нет'}</small></button>`).join('')}</div>`;
}
function periodBar() {
  return `<div class="period-bar"><div class="period-copy"><strong>01–14.11.2026</strong><small>${state.mode==='LFL'?'Сопоставимые пиццерии · период проверяется':`vs ${comparisonDate()}`}</small></div><div class="segmented" aria-label="Способ сравнения">${['MoM','YoY','LFL'].map(m=>`<button data-mode="${m}" class="${state.mode===m?'active':''}" aria-pressed="${state.mode===m}" title="${m==='LFL'?'Период источника проверяется':m==='MoM'?'Те же дни прошлого месяца':'Те же дни прошлого года'}">${m==='MoM'?'Прошлый месяц':m==='YoY'?'Прошлый год':'Те же пиццерии'}</button>`).join('')}</div></div>`;
}
function analyticsHead(title='Пульс моих стран', subtitle='Срез: 15 ноября 2026, 08:30 CET · текущий день исключён') {
  const points=state.countries.reduce((sum,code)=>sum+units(code).length,0);
  return `<div class="analytics-head"><div><h2>${title}</h2><p>${subtitle}</p></div><span class="pill">Страны: ${state.countries.length} · ${points} точек в примере</span></div>`;
}
function quality(code, inline=false) {
  const c=COUNTRY_INFO[code];
  if(!c.quality) return '<div class="card no-demo-panel"><h3>Рейтинги и проверки</h3><p>Демо-данных нет для выбранной страны.</p></div>';
  if(inline) return `<div class="column-quality"><div class="quality-inline"><span>РС · 1–14 ноя</span><strong>${fmt(c.quality?.[0],1)}</strong></div><div class="quality-inline"><span>РКО · 2–8 ноя</span><strong>${fmt(c.quality?.[1],1)}</strong></div><div class="inspection-summary"><strong>${c.inspections[0]} из ${c.inspections[1]} проверок</strong> по плану ноября<br>Последняя: ${c.inspections[3]}<br><button class="text-link" data-inspection="${code}">Посмотреть проверки ${icon('arrow',11)}</button></div></div>`;
  return `<div class="quality-grid"><div class="quality-card"><h3>Стандарты · РС</h3><div class="quality-score">${fmt(c.quality?.[0],1)}<small>/ 100</small></div><div class="quality-progress"><span style="width:${c.quality?.[0]}%"></span></div><p>Волна 1–14 ноября · 3 из 3 точек</p></div><div class="quality-card"><h3>Клиентский опыт · РКО</h3><div class="quality-score">${fmt(c.quality?.[1],1)}<small>/ 100</small></div><div class="quality-progress"><span style="width:${c.quality?.[1]}%"></span></div><p>Неделя 2–8 ноября · 3 из 3 точек</p></div><div class="quality-card inspection"><h3>Выездные проверки</h3><strong>${c.inspections[0]} из ${c.inspections[1]} по плану ноября</strong><p>${c.inspections[2]} · ${c.inspections[3]}</p><button class="text-link" data-inspection="${code}">Проверки и замечания ${icon('arrow',11)}</button></div></div>`;
}
const TASKS = [
  ['Согласовать план по доставке в RS','АК','сегодня'],
  ['Закрыть замечания по стандартам','МП','сегодня'],
  ['Подготовить обзор по странам','ЕК','16 ноя'],
  ['Проверить график выездных проверок','АК','16 ноя'],
  ['Согласовать план обучения на декабрь','НС','17 ноя'],
];
function tasks() {
  return `<section class="card"><div class="card-heading"><span>Ближайшие задачи <small>· топ 5</small></span><button class="text-link" data-work="tasks">Все ${icon('arrow',12)}</button></div><div class="task-list">${TASKS.map((t,i)=>`<div class="task-row ${state.tasks.has(i)?'task-done':''}"><button class="task-check" data-task="${i}" aria-label="${state.tasks.has(i)?'Вернуть в работу':'Отметить выполненной'}: ${t[0]}" aria-pressed="${state.tasks.has(i)}"></button><button class="task-title" data-task-detail="${i}">${t[0]}</button><span class="avatar">${t[1]}</span><span class="due ${i<2?'today':''}">${t[2]}</span></div>`).join('')}</div></section>`;
}
function meetings(showJoin=false) {
  const join=(id,title)=>showJoin
    ? `<button class="join-meeting" data-join-meeting="${id}" aria-label="Подключиться: ${title}">${icon('video',13)} Подключиться</button>`
    : `<button class="icon-button" data-meeting="${id}" aria-label="Открыть созвон ${title}">${icon('video',14)}</button>`;
  return `<section class="card"><div class="card-heading"><span>Ближайшие встречи</span><small>15 ноября · CET</small></div><div class="meeting-list"><div class="meeting"><div class="meeting-time">10:00<small>30 мин</small></div><div><button data-meeting="0" style="padding:0;text-align:left"><h3>Операционный синк</h3></button><p>RS · BG · HR · SI · 6 участников</p></div>${join(0,'Операционный синк')}</div><div class="meeting"><div class="meeting-time">14:30<small>45 мин</small></div><div><button data-meeting="1" style="padding:0;text-align:left"><h3>Качество и клиентский опыт</h3></button><p>Обзор проверок · 4 участника</p></div>${join(1,'Качество и клиентский опыт')}</div></div></section>`;
}
function notes() {
  if(state.view==='cockpit') return actionBoard();
  return `<div class="notes" aria-label="Доска стикеров"><button class="note" data-note="0"><span class="note-head"><span>${icon('pin',11)} Личное</span><span class="note-due">до 17 ноября</span></span><strong>Обновить OKR на декабрь ${icon('arrow',11)}</strong></button><button class="note" data-note="1"><span class="note-head"><span>${icon('pin',11)} Команде</span><span class="note-due">до 16 ноября</span></span><strong>Заполнить недельный дайджест ${icon('arrow',11)}</strong></button><button class="note" data-note="2"><span class="note-head"><span>${icon('pin',11)} На вычитку</span><span class="note-due">2 встречи</span></span><strong>Подтвердить решения созвонов ${icon('arrow',11)}</strong></button></div>`;
}
function work() { return `<div class="work-grid">${tasks()}${meetings()}</div>${notes()}`; }
function chart(code, large=false) {
  if(!DEMO_COUNTRY_DATA[code]) return '<div class="no-demo-panel">Нет демонстрационных данных для графика.</div>';
  const current=aggregate(code).revenue, previous=state.mode==='LFL'?null:reference(aggregate(code),'revenue',code);
  const max=Math.max(current,previous||current)*1.04;
  const pattern=[0,.05,.12,.16,.24,.32,.39,.47,.53,.61,.67,.77,.88,1];
  const previousPattern=[0,.07,.14,.21,.27,.36,.44,.51,.58,.66,.73,.82,.91,1];
  const path = (list,total) => list.map((v,i)=>`${i?'L':'M'}${10+i*580/13},${140-v*total/max*125}`).join(' ');
  return `<div class="spark-container"><svg class="mini-chart" viewBox="0 0 600 150" role="img" aria-label="Пример накопительной выручки ${COUNTRY_INFO[code].name}, 1–14 ноября"><defs><linearGradient id="area-${large?'large':'small'}-${code}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="currentColor" stop-opacity=".12"/><stop offset="100%" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>${[30,85,140].map(y=>`<path d="M10 ${y}H590" stroke="var(--line2)" stroke-width="1"/>`).join('')}<path d="${path(pattern,current)}L590 140H10Z" fill="url(#area-${large?'large':'small'}-${code})"/>${previous?`<path d="${path(previousPattern,previous)}" fill="none" stroke="var(--muted)" stroke-opacity=".65" stroke-width="2" stroke-dasharray="6 5"/>`:''}<path d="${path(pattern,current)}" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="590" cy="${140-current/max*125}" r="4" fill="currentColor"/></svg><div class="chart-axis"><span>1 ноя</span><span>7 ноя</span><span>14 ноя</span></div>${large?`<div class="legend"><span><i></i>1–14 ноября 2026</span>${previous?`<span><i class="previous"></i>${comparisonDate()}</span>`:''}<span>Пример накопительного ряда · ${COUNTRY_INFO[code].currency}</span></div>`:''}</div>`;
}

// Daily fixtures belong only to the selected cockpit; the other four studies keep their charts.
// Totals are allocated across days; time series are daily order-weighted means, never cumulative.
const DAILY_EXAMPLE_WEIGHTS = [7,8,6,7,9,12,11,7,6,8,7,9,13,10];
const DAILY_TIME_OFFSETS = [-1.4,-.6,.9,-.2,1.5,2.1,.7,-.8,-1.1,.3,1.2,-.5,.5,-.4];
function dailyExampleSeries(code, metric, previous=false) {
  const data=aggregate(code),total=previous?reference(data,metric.key,code):data[metric.key];
  if(total==null) return null;
  const offset=METRICS.indexOf(metric)+(previous?3:0);
  const weights=DAILY_EXAMPLE_WEIGHTS.map((_,i)=>DAILY_EXAMPLE_WEIGHTS[(i+offset)%14]);
  const weightSum=weights.reduce((sum,n)=>sum+n,0);
  if(['delivery','kitchen'].includes(metric.key)) {
    const orderMetric=METRICS.find(m=>m.key==='orders');
    const orders=dailyExampleSeries(code,orderMetric,previous);
    const deviations=DAILY_TIME_OFFSETS.map((_,i)=>DAILY_TIME_OFFSETS[(i+offset)%14]*(metric.key==='kitchen'?.4:1));
    const centre=deviations.reduce((sum,n,i)=>sum+n*orders[i],0)/orders.reduce((sum,n)=>sum+n,0);
    return deviations.map(n=>total+n-centre);
  }
  const exact=weights.map(n=>total*n/weightSum),result=exact.map(Math.floor);
  const remaining=Math.round(total-result.reduce((sum,n)=>sum+n,0));
  const ranks=exact.map((n,i)=>({i,remainder:n-result[i]})).sort((a,b)=>b.remainder-a.remainder);
  for(let i=0;i<remaining;i++) result[ranks[i].i]++;
  return result;
}
function cockpitMetricUnit(metric,code) {
  if(metric.key==='revenue') return COUNTRY_INFO[code].currency;
  if(metric.key==='orders') return 'заказов';
  if(metric.key==='stops') return 'ресторан-мин';
  return metric.unit;
}
function cockpitChart(code,metric) {
  const current=dailyExampleSeries(code,metric),previous=dailyExampleSeries(code,metric,true);
  const average=['delivery','kitchen'].includes(metric.key),unit=cockpitMetricUnit(metric,code);
  const description=average?'Среднее за день · по заказам':'За каждый день · без накопления';
  if(!DEMO_COUNTRY_DATA[code]) return `<div class="cockpit-chart" data-chart-kind="missing" data-chart-metric="${metric.key}"><div class="cockpit-chart-heading"><span>${metric.label} · пример</span></div><div class="cockpit-chart-missing" role="status">${icon('chart',20)}<strong>Нет демонстрационных данных</strong><span>Для страны ${COUNTRY_INFO[code].name} пример пока не задан.<br>Значение, сравнение и линия не рассчитываются.</span></div><div class="chart-axis"><span>1 ноя</span><span>7 ноя</span><span>14 ноя</span></div></div>`;
  const legend=`<div class="legend cockpit-chart-legend"><span><i></i>1–14 ноября 2026</span>${previous?`<span><i class="previous"></i>${comparisonDate()}</span>`:''}</div>`;
  if(!current) return `<div class="cockpit-chart" data-chart-kind="missing" data-chart-metric="${metric.key}"><div class="cockpit-chart-heading"><span>${description}</span><span>${unit}</span></div><div class="cockpit-chart-missing" role="status">${icon('alert',20)}<strong>Нет полного ряда по стране</strong><span>Доставка Сплит · Центр не передана.<br>Среднее и линия не рассчитаны · 2 из 3 точек.</span></div><div class="chart-axis"><span>1 ноя</span><span>7 ноя</span><span>14 ноя</span></div></div>`;
  const all=current.concat(previous||[]),low=average?Math.floor(Math.min(...all)*.9):0;
  const high=Math.ceil(Math.max(...all)*1.12),span=high-low||1;
  const x=i=>84+i*504/13,y=n=>144-(n-low)/span*126;
  const path=list=>list.map((n,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  const axis=n=>metric.key==='revenue'&&n>=1000?`${fmt(n/1000,0)} тыс.`:fmt(n,average?1:0);
  const middle=average?(low+high)/2:Math.round((low+high)/2);
  const grid=[low,middle,high].map(n=>`<text x="74" y="${y(n)+5}" text-anchor="end" fill="var(--muted)" font-size="16">${axis(n)}</text><path d="M84 ${y(n)}H588" stroke="var(--line2)"/>`).join('');
  return `<div class="cockpit-chart" data-chart-kind="${average?'daily-average':'daily-total'}" data-chart-metric="${metric.key}"><div class="cockpit-chart-heading"><span>${description}</span><span>${unit} · пример</span></div><svg class="cockpit-chart-svg" viewBox="0 0 600 154" role="img" aria-label="${metric.label}: пример ${average?'дневных средних':'дневных значений'}, ${COUNTRY_INFO[code].name}, ${unit}, 1–14 ноября">${grid}${previous?`<path class="chart-previous-line" d="${path(previous)}" fill="none" stroke="var(--muted)" stroke-width="1.8" stroke-dasharray="5 4"/>`:''}<path class="chart-current-line" d="${path(current)}" fill="none" stroke="var(--primary)" stroke-width="2.4" stroke-linejoin="round"/>${current.map((n,i)=>`<circle cx="${x(i)}" cy="${y(n)}" r="2" fill="var(--primary)"><title>${i+1} ноября: ${fmt(n,average?1:0)} ${unit} · пример</title></circle>`).join('')}</svg><div class="chart-axis"><span>1 ноя</span><span>7 ноя</span><span>14 ноя</span></div>${legend}</div>`;
}
function cockpitMetricSelector(code) {
  const data=aggregate(code);
  return `<div class="cockpit-metric-selector" role="group" aria-label="Показатель на большом графике">${METRICS.map(metric=>`<button type="button" class="cockpit-metric-button ${state.metric===metric.key?'selected':''}" data-metric="${metric.key}" aria-pressed="${state.metric===metric.key}" aria-controls="cockpit-active-metric" title="${esc(metric.help)}"><span class="cockpit-metric-name">${metric.label}</span><span class="cockpit-metric-summary">${displayValue(data[metric.key],metric,code,true)}${delta(data,metric,code,true)}</span><span class="cockpit-metric-state">${state.metric===metric.key?'На графике':'Показать график'} ${icon('arrow',11)}</span></button>`).join('')}</div>`;
}
function cockpitHero(code) {
  const metric=METRICS.find(m=>m.key===state.metric)||METRICS[0],data=aggregate(code),c=COUNTRY_INFO[code];
  const aggregation=['delivery','kitchen'].includes(metric.key)?'Среднее по заказам за период':metric.key==='stops'?'Сумма ресторан-минут за период':'Сумма за период';
  return `<section class="hero-country cockpit-active-hero" id="cockpit-active-metric" aria-label="Выбранный показатель"><div class="cockpit-hero-heading"><div><span class="eyebrow">${code} · ${DEMO_COUNTRY_DATA[code]?'Все 3 пиццерии':'Демо-данных нет'}</span><h2>${c.name}</h2></div><button type="button" class="button cockpit-revenue-return" data-return-revenue="true" aria-pressed="${metric.key==='revenue'}">Выручка ${icon('arrow',11)}</button></div><div class="hero-split"><div class="cockpit-hero-summary"><div class="metric-label cockpit-active-label">${metric.label} · 1–14 ноября</div><div class="cockpit-active-number">${displayValue(data[metric.key],metric,code)}</div><div class="cockpit-active-comparison">${delta(data,metric,code)}</div><p class="cockpit-aggregation-label">${aggregation} · ${cockpitMetricUnit(metric,code)}<br>Пример данных</p></div>${cockpitChart(code,metric)}</div><p class="footer-note">${freshness(code)}</p></section>`;
}
function unitCard(code,u) {
  return `<button class="unit-card ${state.unit===u.id?'selected-unit':''}" data-unit="${u.id}" data-unit-country="${code}"><span class="unit-title">${u.name}${icon('chevron',13)}</span><div class="unit-meta">${u.stale?'<span class="warn">Данные устарели · 14 ноя, 07:20</span>':u.missing?'<span class="warn">Доставка: нет данных</span>':'15 ноя, 08:10 CET · пример'}</div><div class="unit-numbers"><div><strong>${fmt(u.revenue)} ${COUNTRY_INFO[code].currency}</strong>${delta(u,METRICS[0],code,true)}</div><div><small>Доставка</small><strong>${u.delivery==null?'—':fmt(u.delivery)+' мин'}</strong></div></div><span class="detail-link">Показатели точки ${icon('arrow',12)}</span></button>`;
}
function unitList(code) {
  if(!DEMO_COUNTRY_DATA[code]) return '<section class="card no-demo-panel section-space" id="country-units"><h3>Пиццерии</h3><p>Демо-данных нет для выбранной страны.</p></section>';
  return `<section class="detail-strip" id="country-units"><div class="detail-head"><div><h3><span class="code">${code}</span> ${COUNTRY_INFO[code].name} · пиццерии</h3><p>${freshness(code)}</p></div><span class="pill">3 точки</span></div><div class="unit-list">${units(code).map(u=>unitCard(code,u)).join('')}</div></section>`;
}
function unitFocus() {
  if(!state.unit) return '';
  const u=units(state.country).find(x=>x.id===state.unit);
  if(!u) return '';
  return `<section class="unit-focus" id="unit-focus" tabindex="-1"><div class="unit-focus-header"><div><span class="eyebrow">${state.country} / Отдельная пиццерия</span><h3>${u.name}</h3><p>1–14 ноября · пример данных${u.stale?' · устарело: 14 ноября, 07:20 CET':''}</p></div><button class="button" data-close-unit="true">К стране ${icon('close',12)}</button></div><div class="metric-grid">${METRICS.map(m=>metricTile(u,m,state.country)).join('')}</div><p class="footer-note">Все суммы — в ${COUNTRY_INFO[state.country].currency}. ${state.mode==='LFL'?'Сопоставимые пиццерии: период проверяется.':'Сравнение: '+comparisonDate()+'.'} Показатели рейтингов и проверок ниже относятся ко всей выбранной стране.</p></section>`;
}
function footnote() {
  return `<p class="footer-note">Пример данных. Валюты не суммируются. Доставка и приготовление — средние по заказам; стопы — суммарные ресторан-минуты. РС и РКО: собственные периоды, шкала 0–100. ${state.mode==='LFL'?'Период для сопоставимых пиццерий ещё не подтверждён. Остальные показатели — без этого сравнения.':'▲ / ▼ — направление изменения; цвет — лучше / хуже. Меньше время, стопы и сертификаты за опоздание — лучше.'}</p>`;
}
function matrixView() {
  return `${work()}${analyticsHead()}${periodBar()}<div class="card matrix-card"><table class="matrix"><caption class="sr-only">Показатели стран за 1–14 ноября. Пример данных.</caption><thead><tr><th scope="col">Страна / охват</th>${METRICS.map(m=>`<th scope="col"><span class="metric-help" title="${esc(m.help)}">${m.label}${m.key==='stops'?' · мин':''}</span></th>`).join('')}<th scope="col">Качество<br>РС / РКО</th></tr></thead><tbody>${state.countries.map(code=>{const c=COUNTRY_INFO[code],d=aggregate(code);return `<tr class="${state.country===code?'row-selected':''}"><td><div><button class="matrix-country" data-country="${code}"><span class="country-title"><span class="code">${code}</span><span class="country-name">${c.name}</span></span></button><p class="country-info">${c.units.length?'3 точки · '+c.currency:'Демо-данных нет'}${d.stale?' · <span class="warn">устарело</span>':d.missing?' · <span class="warn">пропуск</span>':''}</p></div><button class="text-link" data-open-country="${code}">Пиццерии ${icon('chevron',10)}</button></td>${METRICS.map(m=>`<td data-label="${m.label}">${metricHTML(d,m,code,true)}</td>`).join('')}<td class="quality-cell" data-label="Рейтинги 0–100 · разные периоды"><span><strong>${fmt(c.quality?.[0],1)}</strong><small class="comparison">РС · 1–14 ноя</small></span><span><strong>${fmt(c.quality?.[1],1)}</strong><small class="comparison">РКО · 2–8 ноя</small></span></td></tr>`;}).join('')}</tbody></table></div><p class="footer-note">Сертификаты за опоздание — количество выданных сертификатов (delivery/vouchers), шт. Все значения — пример.</p>${unitList(state.country)}${unitFocus()}${quality(state.country)}${footnote()}`;
}
function cockpitView() {
  const code=state.country;
  return `${state.home.reminders?actionBoard(true):''}<div class="cockpit-layout"><div class="cockpit-main">${analyticsHead('Страны под управлением')}${periodBar()}<div class="cockpit-country-nav" style="--country-count:${Math.min(state.countries.length,4)}">${state.countries.map(k=>`<button class="country-preview ${code===k?'active':''}" data-country="${k}" aria-pressed="${code===k}"><span class="code">${k}</span><span class="country-name">${COUNTRY_INFO[k].name}</span><span class="preview-revenue">${aggregate(k).revenue==null?'—':fmt(aggregate(k).revenue/1000)+' тыс.'} <small>${COUNTRY_INFO[k].currency}</small></span>${delta(aggregate(k),METRICS[0],k,true)}</button>`).join('')}</div>${cockpitHero(code)}${cockpitMetricSelector(code)}${state.home.quality?quality(code):''}${state.home.units?unitList(code):''}${state.home.units?unitFocus():''}${footnote()}</div><aside class="cockpit-side" aria-label="Мой рабочий день"><div class="day-heading"><h2>Мой рабочий день</h2><span>15 ноября · CET</span></div>${state.home.meetings?meetings(true):''}${state.home.tasks?tasks():''}${!state.home.meetings&&!state.home.tasks?'<div class="card empty-day"><p>Выберите, что показывать рядом с показателями страны.</p><button class="button customize-home" data-customize="true">Настроить главную</button></div>':''}</aside></div>`;
}
function attentionView() {
  const code=state.country;
  const alerts=[
    {country:'RS',title:'Доставка растёт, выручка снижается',body:'Средняя доставка выше прошлого месяца; выручка 4,0 млн vs 4,3 млн RSD. Проверьте Белград · Юг.',label:'Отклонение',icon:'alert',warning:false},
    {country:'BG',title:'По одной точке устарели данные',body:'Пловдив · Центр: последнее обновление 14 ноября, 07:20 CET. Итог BG включает старое значение.',label:'Свежесть',icon:'clock',warning:true},
    {country:'HR',title:'Нет времени доставки в Сплите',body:'По одной из трёх точек отсутствует показатель. Среднее по стране не рассчитано.',label:'Нет данных',icon:'alert',warning:true},
  ].filter(a=>state.countries.includes(a.country));
  return `<div class="exception-work"><div>${meetings()}<div style="height:12px"></div>${notes()}</div>${tasks()}</div><div class="section-space">${analyticsHead('Сначала — то, что требует внимания')}${periodBar()}<div class="summary-ribbon"><div class="summary-cell"><strong>${alerts.filter(a=>!a.warning).length}</strong><span>к прошлому месяцу · пример</span></div><div class="summary-cell"><strong>${alerts.filter(a=>a.warning).length}</strong><span>сигнала о данных</span></div><div class="summary-cell"><strong>${state.countries.reduce((sum,key)=>sum+units(key).length,0)}</strong><span>точек в моём охвате</span></div></div><div class="exception-layout"><div><div class="section-label"><h2>Куда посмотреть</h2><small>К прошлому месяцу · пример</small></div><div class="attention-list">${alerts.length?alerts.map(a=>`<button class="attention-row ${a.warning?'warning':''}" data-open-country="${a.country}"><span class="attention-icon">${icon(a.icon,16)}</span><span><h3><span class="code">${a.country}</span> ${a.title}</h3><p>${a.body}</p></span><span class="severity">${a.label} ${icon('chevron',10)}</span></button>`).join(''):'<div class="card-pad muted">В примере для выбранных стран нет сигналов.</div>'}</div><div class="section-space"><div class="section-label"><h2>Контекст выбранной страны</h2></div>${countryChips()}<div style="height:13px"></div>${metrics(code)}</div></div><aside class="exception-side"><div class="section-label"><h2>Качество · ${code}</h2><small>Пример</small></div>${quality(code)}</aside></div>${unitList(code)}${unitFocus()}${footnote()}</div>`;
}
function columnsView() {
  return `<div class="columns-top-work">${meetings()}${tasks()}</div>${analyticsHead('Все мои страны — рядом')}${periodBar()}<div class="country-columns">${state.countries.map(code=>{const c=COUNTRY_INFO[code],d=aggregate(code);return `<section class="country-column ${state.country===code?'active':''}"><div class="column-header"><h2><span class="code">${code}</span> ${c.name}</h2><p>${c.units.length?'3 пиццерии · '+c.currency:'Демо-данных нет'}${d.stale?' · <span class="warn">устарело</span>':d.missing?' · <span class="warn">пропуск</span>':''}</p><button class="text-link" data-country="${code}">Выбрать ${icon('chevron',11)}</button></div>${METRICS.map(m=>`<div class="column-metric"><div class="metric-label"><span class="metric-help" title="${esc(m.help)}">${m.label}</span></div>${metricHTML(d,m,code,true)}</div>`).join('')}${quality(code,true)}<div class="column-units"><div class="eyebrow">Пиццерии</div>${units(code).map(u=>`<button class="column-unit" data-unit="${u.id}" data-unit-country="${code}"><span>${u.name}${u.stale?' <span class="warn">· устарело</span>':''}</span><strong>${fmt(u.revenue/1000)} тыс. ${c.currency} ${icon('chevron',10)}</strong></button>`).join('')}</div></section>`;}).join('')}</div>${unitFocus()}${footnote()}<div class="section-space">${notes()}</div>`;
}
function overviewView() {
  const code=state.country,c=COUNTRY_INFO[code],d=aggregate(code);
  return `${analyticsHead('Обзор операций')}${periodBar()}<div class="overview-layout"><aside><div class="section-label"><h2>Мои страны</h2><small>${state.countries.reduce((sum,key)=>sum+units(key).length,0)} точек</small></div><div class="card overview-index">${state.countries.map(k=>`<button class="overview-country ${code===k?'active':''}" data-country="${k}" aria-pressed="${code===k}"><span class="code">${k}</span><span><h3>${COUNTRY_INFO[k].name}</h3><p>${aggregate(k).revenue==null?'—':fmt(aggregate(k).revenue/1000)+' тыс.'} ${COUNTRY_INFO[k].currency} · ${DEMO_COUNTRY_DATA[k]?'3 точки':'Демо-данных нет'}</p></span>${delta(aggregate(k),METRICS[0],k,true)}</button>`).join('')}</div><div class="overview-today">${meetings()}<div style="height:13px"></div>${tasks()}${notes()}</div></aside><div><section class="card overview-hero"><div class="overview-hero-heading"><div><h2>${c.name}</h2><p>${freshness(code)}</p></div><span class="pill">${code} · 01–14.11.2026</span></div><div class="overview-revenue"><div><div class="metric-label">Выручка · закрытые дни</div>${displayValue(d.revenue,METRICS[0],code)}</div><div>${delta(d,METRICS[0],code)}</div></div><div class="chart-large">${chart(code,true)}</div>${metrics(code,true)}</section><div class="section-space overview-bottom"><div><div class="section-label"><h2>Качество и проверки</h2></div>${quality(code)}</div><div><div class="section-label"><h2>От страны к точке</h2><small>Выручка · ${c.currency}</small></div><div class="card overview-unit-list">${units(code).map(u=>unitCard(code,u)).join('')}</div></div></div>${unitFocus()}${footnote()}</div></div><div class="overview-mobile-work" style="display:none">${work()}</div>`;
}
function render() {
  document.documentElement.dataset.theme=state.dark?'dark':'light';
  document.title=`Swarm Brain · ${VIEWS.find(v=>v[0]===state.view)[1]}`;
  const nav=[['home','Главная'],['task','Задачи'],['calendar','Созвоны'],['projects','Проекты'],['base','База знаний']];
  const current=VIEWS.find(v=>v[0]===state.view);
  app.innerHTML=`<div class="shell"><aside class="rail" aria-label="Навигация Swarm Brain"><a class="brand" href="#cockpit"><span class="brand-mark">${mark}</span><span class="brand-word">swarm brain</span></a><div class="space"><span class="initials">OP</span><span>Operations<small>Рабочее пространство</small></span></div><span class="rail-label">РАБОЧИЙ ДЕНЬ</span>${nav.map(([i,label],n)=>`<button class="rail-link ${n===0?'active':''}" ${n===0?'data-view="'+state.view+'"':'data-section="'+label+'"'} title="${label}">${icon(i,17)}<span>${label}</span>${n===1?'<span class="count">5</span>':''}</button>`).join('')}<div class="rail-gap"></div><span class="rail-label">АНАЛИТИКА</span><button class="rail-link" data-section="Анализ рынка" title="Анализ рынка">${icon('chart',17)}<span>Анализ рынка</span></button><button class="rail-link" data-section="Поиск" title="Поиск">${icon('search',17)}<span>Поиск по Swarm</span></button><div class="rail-foot"><span class="avatar">АК</span><div><strong style="font-size:11px">Алекс · пример</strong><div class="small muted">Операционная команда</div></div></div></aside><div class="main-shell"><header class="topbar"><span class="breadcrumb">Главная</span><div class="top-tools"><span class="pill demo">Пример данных</span><button class="icon-button" data-theme-toggle="true" aria-label="${state.dark?'Светлая':'Тёмная'} тема" title="${state.dark?'Светлая':'Тёмная'} тема">${icon(state.dark?'sun':'moon',15)}</button><button class="icon-button" data-section="Уведомления" aria-label="Уведомления">${icon('bell',15)}</button><span class="avatar">АК</span></div></header><nav class="prototype-nav" aria-label="Пять вариантов главной">${VIEWS.map(([key,label],i)=>`<a class="prototype-tab ${state.view===key?'active':''}" href="#${key}" ${state.view===key?'aria-current="page"':''}><span class="num">0${i+1}</span><span>${label}</span></a>`).join('')}</nav><main class="page" id="main"><div class="page-head"><div><h1>${state.view==='attention'?'Мой рабочий день':'Главная'}</h1><p>${current[2]} <span class="muted">· вариант ${VIEWS.indexOf(current)+1} / 5</span></p></div><div class="head-right">${state.view==='cockpit'?`<button class="button customize-home" data-customize="true" aria-haspopup="dialog">${icon('settings',15)} Настроить главную</button><span class="customize-hint">Страны и блоки</span>`:`<button class="button" data-markets="true">${icon('settings',13)} Мои страны</button>`}</div></div>${({matrix:matrixView,cockpit:cockpitView,attention:attentionView,columns:columnsView,overview:overviewView}[state.view])()}<footer class="canvas-caption"><span><strong>SWARM BRAIN</strong> · ${current[1]} · интерактивный эскиз</span><span>Все страны, точки, люди и показатели — пример. Боевые данные не подключены.</span></footer></main></div></div>`;
}
function readHash() {
  const key=location.hash.slice(1).split('/')[0];
  state.view=VIEWS.some(v=>v[0]===key)?key:'cockpit';
  state.unit=null;
  if(!state.countries.includes(state.country)) state.country=state.countries[0];
}
function announce(text) { document.getElementById('announce').textContent=text; }
function openDialog(title,body,actions='') {
  returnFocus=document.activeElement;
  dialog.innerHTML=`<div class="dialog-top"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-close-dialog="true" aria-label="Закрыть">${icon('close',15)}</button></div>${body}${actions}`;
  dialog.showModal();
}
function closeDialog() { dialog.close();marketDraft=null;returnFocus?.focus(); }
function selectCountry(code,scroll=false) {
  state.country=code;state.unit=null;render();announce(`Выбрана ${COUNTRY_INFO[code].name}`);
  if(scroll) document.getElementById('country-units')?.scrollIntoView({block:'center',behavior:'instant'});
}

function persistHome() {
  store.write({countries:state.countries,dark:state.dark,home:state.home,acknowledged:[...state.acknowledged]});
}
const STICKERS = [
  {id:'review',kind:'reminder',label:'Для вас',title:'Вычитать 2 встречи',body:'Решения ждут подтверждения после созвона.',due:'сегодня',action:'Вычитать',progress:'2 в очереди'},
  {id:'digest',kind:'task',label:'Команде',title:'Заполнить недельный дайджест',body:'Собрать итоги и риски по своим странам.',due:'до 16 ноября',action:'Открыть',progress:'3 из 5 выполнили'},
  {id:'okr',kind:'task',label:'Для вас',title:'Обновить OKR на декабрь',body:'Проверить цели перед месячным планированием.',due:'до 17 ноября',action:'Открыть',progress:'ожидает вас'},
  {id:'schedule',kind:'notice',label:'Команда качества',title:'График проверок обновлён',body:'Добавлены даты выездов на следующую неделю.',due:'14 ноября',action:'Прочитать',progress:'объявление'},
];
function actionBoard(compact=false) {
  const pending=STICKERS.filter(item=>!state.acknowledged.has(item.id));
  const finished=STICKERS.filter(item=>state.acknowledged.has(item.id));
  const row=item=>`<button class="action-note ${item.kind}" data-sticker="${item.id}" aria-haspopup="dialog"><span class="action-note-meta"><span class="note-kind">${item.kind==='notice'?'Объявление':item.kind==='reminder'?'Напоминание':'Задание'}</span><span>${item.label}</span><time>${item.due}</time></span><strong>${item.title}</strong><span class="action-note-body">${item.body}</span><span class="action-note-footer"><span>${state.acknowledged.has(item.id)?'✓ Завершено':item.progress}</span><span class="action-note-link">${item.action} →</span></span></button>`;
  if(compact) {
    const compactRow=item=>`<button class="action-note ${item.kind}" data-sticker="${item.id}" aria-haspopup="dialog" title="${item.body}"><span class="action-note-meta"><span class="note-kind">${item.kind==='notice'?'Объявление':item.kind==='reminder'?'Напоминание':'Задание'}</span><time>${item.due}</time></span><strong>${item.title}</strong><span class="action-note-footer"><span>${item.label}</span><span class="action-note-link">${item.action} →</span></span></button>`;
    return `<section class="card action-board compact-board" aria-label="Напоминания и объявления" tabindex="-1"><div class="card-heading"><span>Напоминания и объявления <small>· ${pending.length} новых</small></span><span class="compact-board-hint">Действия и сообщения команды</span></div><div class="compact-note-grid">${pending.map(compactRow).join('')}</div>${finished.length?`<details class="completed-notes"><summary>Выполнено и прочитано · ${finished.length}</summary><div class="compact-note-grid">${finished.map(compactRow).join('')}</div></details>`:''}${!pending.length?'<p class="board-clear">Всё разобрано. Новых напоминаний нет.</p>':''}</section>`;
  }
  const group=(title,items)=>items.length?`<div class="action-note-group"><h3>${title}<span>${items.length}</span></h3>${items.map(row).join('')}</div>`:'';
  return `<section class="card action-board" aria-label="Напоминания и объявления" tabindex="-1"><div class="card-heading"><span>Напоминания и объявления</span><small>${pending.length} новых</small></div>${group('Требует действия',pending.filter(item=>item.kind!=='notice'))}${group('Объявления команды',pending.filter(item=>item.kind==='notice'))}${finished.length?`<details class="completed-notes"><summary>Выполнено и прочитано · ${finished.length}</summary>${finished.map(row).join('')}</details>`:''}${!pending.length?'<p class="board-clear">Всё разобрано. Новых напоминаний нет.</p>':''}</section>`;
}
function countrySettingsHTML() {
  return `<div class="country-setting-heading"><span>Выберите от 1 до 8 стран</span><strong data-country-counter aria-live="polite">${marketDraft.size}/8</strong></div><div class="country-setting-grid" role="group" aria-label="Подборка стран">${Object.entries(COUNTRY_NAMES).map(([code,name])=>`<button type="button" class="country-setting-chip" data-market-toggle="${code}" aria-label="${code} — ${name}" title="${name}" aria-pressed="${marketDraft.has(code)}">${code}</button>`).join('')}</div><div class="country-setting-inputs">${[...marketDraft].map(code=>`<input type="hidden" name="market" value="${code}">`).join('')}</div><p class="country-selection-error" role="alert" aria-live="polite"></p>`;
}
function toggleMarketDraft(button) {
  if(!marketDraft) return;
  const code=button.dataset.marketToggle,error=dialog.querySelector('.country-selection-error');
  if(!COUNTRY_NAMES[code]) return;
  if(!marketDraft.has(code)&&marketDraft.size>=MAX_COUNTRIES) {
    error.textContent='Можно выбрать не больше 8 стран. Снимите одну, чтобы добавить другую.';
    return;
  }
  marketDraft.has(code)?marketDraft.delete(code):marketDraft.add(code);
  button.setAttribute('aria-pressed',String(marketDraft.has(code)));
  dialog.querySelector('[data-country-counter]').textContent=`${marketDraft.size}/8`;
  dialog.querySelector('.country-setting-inputs').innerHTML=[...marketDraft].map(item=>`<input type="hidden" name="market" value="${item}">`).join('');
  error.textContent='';
}
function openCustomize() {
  marketDraft=new Set(state.countries);
  openDialog('Настроить главную',`<p>Выберите свои страны и блоки рабочего дня. Показатели выбранной страны остаются в центре пульта.</p><form id="customize-form"><fieldset class="customize-section"><legend>Мои страны</legend>${countrySettingsHTML()}</fieldset><fieldset class="customize-section"><legend>Блоки главной</legend><div class="home-block-options">${HOME_BLOCKS.map(([key,title,hint])=>`<label class="home-block-option"><input type="checkbox" name="block" value="${key}" ${state.home[key]?'checked':''}><span><strong>${title}</strong><small>${hint}</small></span></label>`).join('')}</div></fieldset><div class="dialog-error" id="customize-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-close-dialog="true">Отмена</button><button type="submit" class="button primary">Сохранить настройки</button></div></form>`);
}
function openSticker(id) {
  const item=STICKERS.find(row=>row.id===id);
  if(!item) return;
  const done=state.acknowledged.has(id);
  const description=item.kind==='notice'?'Объявление команды — достаточно ознакомиться.':item.kind==='reminder'?'Вычитайте решения после созвонов. Напоминание исчезает после обработки очереди.':'Задание со сроком и ответственными; статус связан с выполнением работы.';
  const action=item.kind==='notice'?'Понятно':item.kind==='reminder'?'Встречи вычитаны':'Отметить выполненным';
  openDialog(item.title,`<span class="pill demo">Пример ${item.kind==='notice'?'объявления':'задания'}</span><div class="dialog-data">${item.label} · ${item.due} · ${done?'Завершено':item.progress}</div><p>${item.body}</p><p>${description}</p><p class="muted small">Действие в макете сохраняется только в этом браузере.</p>`,done?'<p class="board-clear">✓ Выполнено или прочитано</p>':`<div class="dialog-actions"><button class="button" data-close-dialog="true">Закрыть</button><button class="button primary" data-finish-sticker="${id}">${action}</button></div>`);
}

function openMarkets() {
  marketDraft=new Set(state.countries);
  openDialog('Мои страны',`<p>Подборка общая для пяти вариантов. Меняет охват аналитики, рейтингов и проверок. В прототипе сохраняется только в этом браузере.</p><form id="markets-form">${countrySettingsHTML()}<div class="dialog-error" id="markets-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-close-dialog="true">Отмена</button><button type="submit" class="button primary">Сохранить подборку</button></div></form>`);
}
document.addEventListener('submit',e=>{
  if(e.target.id==='customize-form') {
    e.preventDefault();
    const form=new FormData(e.target);
    const selected=form.getAll('market').filter(code=>COUNTRY_INFO[code]);
    if(!selected.length) {document.getElementById('customize-error').textContent='Выберите хотя бы одну страну.';return;}
    if(selected.length>MAX_COUNTRIES) {document.getElementById('customize-error').textContent='Можно выбрать не больше 8 стран.';return;}
    state.countries=selected;
    state.home=Object.fromEntries(HOME_BLOCKS.map(([key])=>[key,form.getAll('block').includes(key)]));
    if(!selected.includes(state.country)) state.country=selected[0];
    state.unit=null;persistHome();closeDialog();render();
    document.querySelector('[data-customize]')?.focus();announce('Настройки главной сохранены');return;
  }
  if(e.target.id!=='markets-form') return;
  e.preventDefault();
  const selected=[...new FormData(e.target).getAll('market')];
  if(!selected.length) {document.getElementById('markets-error').textContent='Выберите хотя бы одну страну.';return;}
  if(selected.length>MAX_COUNTRIES) {document.getElementById('markets-error').textContent='Можно выбрать не больше 8 стран.';return;}
  state.countries=selected;
  if(!selected.includes(state.country)) state.country=selected[0];
  state.unit=null;persistHome();closeDialog();render();
  document.querySelector('[data-markets]')?.focus();announce('Подборка стран сохранена');
});
document.addEventListener('click',e=>{
  const el=e.target.closest('button');if(!el) return;
  if(el.dataset.closeDialog) return closeDialog();
  if(el.dataset.marketToggle) return toggleMarketDraft(el);
  if(el.dataset.customize) return openCustomize();
  if(el.dataset.sticker) return openSticker(el.dataset.sticker);
  if(el.dataset.finishSticker) {
    state.acknowledged.add(el.dataset.finishSticker);persistHome();closeDialog();render();
    document.querySelector('.action-board')?.focus();announce('Стикер перемещён в выполненные');return;
  }
  if(el.dataset.markets) return openMarkets();
  if(el.dataset.themeToggle) {state.dark=!state.dark;persistHome();render();document.querySelector('[data-theme-toggle]')?.focus();return;}
  if(el.dataset.mode) {state.mode=el.dataset.mode;render();document.querySelector(`[data-mode="${state.mode}"]`)?.focus();announce(`Сравнение: ${state.mode==='MoM'?'прошлый месяц':state.mode==='YoY'?'прошлый год':'те же пиццерии'}`);return;}
  if(el.dataset.metric || el.dataset.returnRevenue) {
    const key=el.dataset.returnRevenue?'revenue':el.dataset.metric;
    if(!METRICS.some(metric=>metric.key===key)) return;
    state.metric=key;render();
    document.querySelector(el.dataset.returnRevenue?'[data-return-revenue]':`[data-metric="${key}"]`)?.focus({preventScroll:true});
    announce(`На большом графике: ${METRICS.find(metric=>metric.key===key).label}`);return;
  }
  if(el.dataset.country) return selectCountry(el.dataset.country);
  if(el.dataset.openCountry) return selectCountry(el.dataset.openCountry,true);
  if(el.dataset.unit) {state.country=el.dataset.unitCountry;state.unit=el.dataset.unit;render();document.getElementById('unit-focus')?.focus({preventScroll:true});document.getElementById('unit-focus')?.scrollIntoView({block:'start',behavior:'instant'});return;}
  if(el.dataset.closeUnit) {const id=state.unit;state.unit=null;render();document.querySelector(`[data-unit="${id}"]`)?.focus();return;}
  if(el.dataset.task!==undefined) {const i=Number(el.dataset.task);state.tasks.has(i)?state.tasks.delete(i):state.tasks.add(i);render();document.querySelector(`[data-task="${i}"]`)?.focus();announce('Статус примерной задачи изменён в макете');return;}
  if(el.dataset.taskDetail!==undefined) {const i=Number(el.dataset.taskDetail);return openDialog(TASKS[i][0],`<span class="pill demo">Пример задачи</span><div class="dialog-data">Ответственный: ${TASKS[i][1]} · срок: ${TASKS[i][2]}</div><p>Карточка показывает переход от ближайших задач к рабочему контексту. Изменение статуса галочкой сохраняется в текущем сеансе макета.</p>`);}
  if(el.dataset.joinMeeting!==undefined) {
    const title=el.dataset.joinMeeting==='0'?'Операционный синк':'Качество и клиентский опыт';
    return openDialog(`Подключиться · ${title}`,'<span class="pill demo">Демонстрация подключения</span><div class="dialog-data">Google Meet · рабочий аккаунт</div><p>В рабочем Swarm кнопка сразу открывает ссылку выбранной встречи. Здесь показан макет перехода.</p>');
  }
  if(el.dataset.meeting!==undefined) return openDialog(el.dataset.meeting==='0'?'Операционный синк':'Качество и клиентский опыт','<span class="pill demo">Пример созвона</span><div class="dialog-data">15 ноября 2026 · CET · пример участников</div><p>В рабочем Swarm здесь открывается карточка встречи со ссылкой подключения, участниками и материалами. В макете внешняя встреча не создаётся.</p>');
  if(el.dataset.note!==undefined) {const i=Number(el.dataset.note);return openDialog(['Обновить OKR','Недельный дайджест','Решения созвонов'][i],'<span class="pill demo">Пример стикера</span><p style="margin-top:14px">Напоминание остаётся частью рабочего дня рядом с задачами и созвонами. В рабочем Swarm стикер ведёт к соответствующему действию.</p>');}
  if(el.dataset.inspection) {const code=el.dataset.inspection,c=COUNTRY_INFO[code];return openDialog(`Выездные проверки · ${c.name}`,`<span class="pill demo">Пример данных</span><div class="inspection-detail"><div><small>Выполнено по плану ноября</small><strong>${c.inspections[0]} / ${c.inspections[1]}</strong></div><div><small>Последняя проверка</small><strong>${c.inspections[3].split(' ')[0]} ноя</strong></div></div><p><strong>${c.inspections[2]}</strong></p><p>Пример замечания: проверить выполнение плана по времени приготовления. В рабочем Swarm отсюда можно открыть материалы проверки и подготовить задачу.</p>`);}
  if(el.dataset.work) return openDialog('Ближайшие задачи','<span class="pill demo">Пример рабочего раздела</span><p style="margin-top:14px">Все пять ближайших задач видны на главной. Откройте название задачи для просмотра карточки или отметьте её галочкой.</p>');
  if(el.dataset.section) return openDialog(el.dataset.section,'<p>Это самостоятельный макет главной. Рабочие разделы проекта сохранены в навигации; содержание этих разделов в пять вариантов не входит.</p>');
  if(el.dataset.view) {state.unit=null;render();window.scrollTo(0,0);}
});
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) closeDialog();}});
dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
window.addEventListener('hashchange',()=>{readHash();render();window.scrollTo(0,0);});
readHash();render();
