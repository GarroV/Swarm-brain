/* База знаний: записи по типам, страны, приватность, реестр файлов. */

const TY_LABEL = { meeting: "Встреча", document: "Документ", note: "Заметка", transcript: "Транскрипт", summary: "Сводка", link: "Ссылка" };
/* шесть типов на три цвета — цвет ничего не различал и только шумел; тип читается словом */
const TY_KIND = { meeting: "l", document: "l", note: "l", transcript: "l", summary: "l", link: "l" };

function baseBar() {
  /* счётчик обязан описывать ТО, ЧТО НА ЭКРАНЕ: раньше здесь стояло «Записей 14» —
     всего в базе, — а на вкладке «Документы» под ним лежали четыре строки */
  const onFiles = S.tab === "files";
  const shown = onFiles ? visibleFiles() : visibleEntries(S.tab);
  const total = onFiles ? S.files.length : S.entries.length;
  const noun = onFiles ? "Файлов" : "Записей";
  return `<div class="bar">
    <span class="drop">${btn(`Страна: ${S.bcc ? cname(S.bcc) : "все"}`, "noop", undefined, undefined, "sm")}
      <div class="dmenu"><button class="mi" ${act("b-cc", undefined, "")}>все</button>
      ${COUNTRIES.map((c) => `<button class="mi${S.bcc === c.c ? " on" : ""}" ${act("b-cc", undefined, c.c)}>${c.c} · ${c.n}</button>`).join("")}</div></span>
    ${chip("Только мои", S.bmine, "b-mine")}
    <input class="qin" placeholder="Поиск по базе" value="${esc(S.bq)}" data-qin="base">
    <div class="right"><span>${noun} <b>${shown.length}</b> из ${total}</span>
      ${onFiles ? `<span>Объём <b>${fsz(shown.reduce((n, f) => n + f.kb, 0))}</b></span>` : ""}
      ${btn("＋ Запись", "new-entry", undefined, undefined, "pri sm")}</div></div>`;
}

function screenBase() {
  if (S.tab === "files") return baseBar() + screenFiles();
  const list = visibleEntries(S.tab);
  if (!list.length) return baseBar() + empty("Записей нет", "Смените тип, страну или поиск");
  /* однородные записи — таблицей, как задачи и встречи: карточками четырнадцать записей
     занимали четыре ряда по 118px, рвали заголовки многоточием и читались хуже столбцов.
     Карточка остаётся там, где содержимое разнородное (дайджест, аналитика). */
  return baseBar() + table(
    [{ t: "Запись" }, { t: "Тип", w: "108px" }, { t: "Рынок", w: "92px", opt: true },
     { t: "Автор", w: "150px", opt: true }, { t: "Файлов", r: true, w: "88px", short: "Файл", opt: true },
     { t: "Добавлена", r: true, w: "106px", short: "Когда" }],
    list.map((e) => {
      const files = S.files.filter((f) => f.rec === e.id).length;
      return `<tr class="row${S.sel === e.id && S.selKind === "entry" ? " sel" : ""}" ${act("open-entry", e.id)} tabindex="0">
        ${cell(`${esc(e.h)}${e.priv ? ' <span class="lock" title="личная">🔒</span>' : ""}<span class="sub">${esc(clip(e.p, 78))}</span>`, "t")}
        ${cell(tag(TY_LABEL[e.ty], TY_KIND[e.ty]))}
        ${cell(e.cc.length ? cc(e.cc) : `<span class="muted">—</span>`, "opt")}
        ${cell(avShort(e.who), "opt")}
        ${cell(files ? `<span class="due">${files}</span>` : `<span class="muted">—</span>`, "r opt")}
        ${cell(dt(e.at), "r")}</tr>`;
    }).join(""));
}

function screenFiles() {
  if (!S.files.length) return empty("Файлов пока нет", "Файл попадает сюда вместе с записью, к которой его приложили");
  const list = visibleFiles();
  if (!list.length) return empty("Под фильтры не попал ни один файл", "Снимите страну, «только мои» или поиск");
  return table([{ t: "Файл", w: "30%" }, { t: "Запись", w: "24%" }, { t: "Загрузил", w: "17%" }, { t: "Индекс", w: "15%", opt: true }, { t: "Размер", r: true, w: "84px" }, { t: "Когда", r: true, w: "84px" }],
    list.map((f) => `<tr class="row${S.sel === f.id && S.selKind === "file" ? " sel" : ""}" ${act("open-file", f.id)} tabindex="0">
      ${cell(`<span class="ft ft-${f.ty}">${f.ty}</span>${esc(f.n)}`, "t")}
      ${cell(esc((S.entries.find((e) => e.id === f.rec) || {}).h || "—"))}
      ${cell(avShort(f.who))}
      ${cell(state(f.ix, f.ix.includes("фрагмент") || f.ix === "переиндексирован"), "opt")}
      ${cell(`<span class="due">${fsz(f.kb)}</span>`, "r")}
      ${cell(dt(f.at), "r")}</tr>`).join(""));
}

function newEntryModal() {
  modal("Новая запись в базу", `
    ${fld("Тип", select("ty", Object.entries(TY_LABEL).map(([v, n]) => [v, n]), "note"))}
    ${fld("Название", input("title", "", "Как коллега будет это искать"))}
    ${fld("Текст", area("text", "", "Вставьте документ, заметку или расшифровку целиком"))}
    ${fld("Файл", input("file", "", "Смета_v4.xlsx"))}
    ${fld("Страны", pick("cc", COUNTRIES.map((c) => [c.c, c.n]), []))}
    ${fld("Приватность", sw("priv", false, "Личная запись — видна только мне"))}
    <div class="hint">После сохранения запись уходит в индекс: её находит поиск и «Спросить базу».</div>`,
    `${btn("Отмена", "mclose")}${btn("Сохранить в базу", "create-entry", undefined, undefined, "pri")}`);
}

/* ответ по базе (RAG) */

/* Написанный от руки ответ живёт ровно для своей темы. На любом другом запросе
   он был бы выдумкой со ссылками на непричастные встречи — поэтому вне темы
   ответ собирается из того, что реально нашлось, вплоть до «ничего». */
const ANSWER_TOPIC = ["смет", "оборудован", "бюджет", "поставщ"];

function answerSources(q, r) {
  if (ANSWER_TOPIC.some((k) => q.toLowerCase().includes(k)))
    return [{ k: "Встреча", t: "Планёрка по открытию, 15 сен", a: "open-meet", v: "m1" },
      { k: "Комментарий", t: "Задача 128, М. Дамьянович", a: "open-task", v: 128 },
      { k: "Запись", t: "Санитарные требования — выписка", a: "open-entry", v: "r7" }];
  return [...r.tasks.slice(0, 1).map((t) => ({ k: "Задача", t: t.t, a: "open-task", v: t.id })),
    ...r.meetings.slice(0, 1).map((m) => ({ k: "Встреча", t: m.t, a: "open-meet", v: m.id })),
    ...r.entries.slice(0, 1).map((e) => ({ k: "Запись", t: e.h, a: "open-entry", v: e.id }))];
}

function screenAnswer() {
  const q = S.aq || "";
  const r = searchAll(q);
  const src = answerSources(q, r);
  const found = [...r.tasks, ...r.meetings, ...r.entries, ...r.files];
  /* сноска — не украшение: по ней открывается тот же источник, что и в списке */
  const fn = (i) => src[i] ? `<sup ${act(src[i].a, src[i].v)} title="${esc(src[i].k)}: ${esc(src[i].t)}">${i + 1}</sup>` : "";
  const named = (i) => src[i] ? `«${esc(src[i].t)}»${fn(i)}` : "";
  const body = ANSWER_TOPIC.some((k) => q.toLowerCase().includes(k))
    ? `По базе: смета по оборудованию пришла выше бюджета на 14%${fn(0)}, поставщик держит цену
       до конца недели${fn(1)}, поэтому решение нужно принять на ближайшей планёрке.
       Санитарные требования по площадке уточняются${fn(2)}.`
    : found.length
      ? `В базе нашлось ${found.length} ${plural(found.length, "упоминание", "упоминания", "упоминаний")}. Ближе всего — ${src.map((_, i) => named(i)).filter(Boolean).join(", ")}.
         Полный список ниже; если нужного нет, добавьте запись — она попадёт в индекс.`
      : `В базе нет ничего по этому запросу. Попробуйте другое слово или добавьте запись —
         поиск и «Спросить базу» увидят её сразу после сохранения.`;
  return `<div class="answer"><div class="q">${esc(q)}</div>
    <div class="a">${body}</div>
    ${src.length ? lab("Источники") + rows(src.map((s, i) =>
      [`${i + 1} · ${esc(s.k)}`, `<span class="lnk" ${act(s.a, s.v)}>${esc(s.t)}</span>`])) : ""}
    ${found.length ? lab(`Найдено по запросу · ${found.length}`) + rows([
      ...r.tasks.map((t) => ["Задача", `<span class="lnk" ${act("open-task", t.id)}>${esc(t.t)}</span>`]),
      ...r.meetings.map((m) => ["Встреча", `<span class="lnk" ${act("open-meet", m.id)}>${esc(m.t)}</span>`]),
      ...r.entries.map((e) => ["База", `<span class="lnk" ${act("open-entry", e.id)}>${esc(e.h)}</span>`]),
      ...r.files.map((f) => ["Файл", `<span class="lnk" ${act("open-file", f.id)}>${esc(f.n)}</span>`])]) : ""}
    <div class="mt">${btn("Сохранить ответ в базу", "new-entry")}${btn("Задать другой вопрос", "search")}</div></div>`;
}
