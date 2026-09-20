/* База знаний: записи по типам, страны, приватность, реестр файлов. */

const TY_LABEL = { meeting: "Встреча", document: "Документ", note: "Заметка", transcript: "Транскрипт", summary: "Сводка", link: "Ссылка" };
const TY_KIND = { meeting: "m", document: "p", note: "o", transcript: "p", summary: "o", link: "p" };

function baseBar() {
  return `<div class="bar">
    ${btn("＋ Запись", "new-entry", undefined, undefined, "pri sm")}
    <span class="drop">${btn(`Страна: ${S.bcc ? cname(S.bcc) : "все"}`, "noop", undefined, undefined, "sm")}
      <div class="dmenu"><button class="mi" ${act("b-cc", undefined, "")}>все</button>
      ${COUNTRIES.map((c) => `<button class="mi${S.bcc === c.c ? " on" : ""}" ${act("b-cc", undefined, c.c)}>${c.c} · ${c.n}</button>`).join("")}</div></span>
    ${chip("Только мои", S.bmine, "b-mine")}
    <input class="qin" placeholder="Поиск по базе" value="${esc(S.bq)}" data-qin="base">
    <div class="right"><span>Записей <b>${S.entries.length}</b></span><span>Файлов <b>${S.files.length}</b></span>
      <span>Объём <b>${(S.files.length * 0.55).toFixed(1)} МБ</b></span></div></div>`;
}

function screenBase() {
  if (S.tab === "files") return baseBar() + screenFiles();
  const list = visibleEntries(S.tab);
  if (!list.length) return baseBar() + empty("Записей нет", "Смените тип, страну или поиск");
  return baseBar() + `<div class="grid">${list.map((e) => `<div class="rec${S.sel === e.id && S.selKind === "entry" ? " sel" : ""}" ${act("open-entry", e.id)} tabindex="0">
    <h4>${esc(e.h)}${e.priv ? ' <span class="lock">🔒</span>' : ""}</h4><p>${esc(e.p)}</p>
    <div class="m">${tag(TY_LABEL[e.ty], TY_KIND[e.ty])}${cc(e.cc)}<span class="dt">${fmtDate(e.at)}</span>
      <span class="who">${av(e.who, false)}</span></div></div>`).join("")}</div>`;
}

function screenFiles() {
  if (!S.files.length) return empty("Файлов пока нет", "Файл попадает сюда вместе с записью, к которой его приложили");
  return table([{ t: "Файл", w: "36%" }, { t: "Запись" }, { t: "Загрузил" }, { t: "Индекс" }, { t: "Размер", r: true }, { t: "Когда", r: true }],
    S.files.map((f) => `<tr class="row${S.sel === f.id && S.selKind === "file" ? " sel" : ""}" ${act("open-file", f.id)} tabindex="0">
      ${cell(`<span class="ft ft-${f.ty}">${f.ty}</span>${esc(f.n)}`, "t")}
      ${cell(esc((S.entries.find((e) => e.id === f.rec) || {}).h || "—"))}
      ${cell(av(f.who))}
      ${cell(state(f.ix, f.ix.includes("фрагмент") || f.ix === "переиндексирован"))}
      ${cell(`<span class="due">${esc(f.sz)}</span>`, "r")}
      ${cell(due(f.at), "r")}</tr>`).join(""));
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
function screenAnswer() {
  const q = S.aq || "";
  const r = searchAll(q);
  return `<div class="answer"><div class="q">${esc(q)}</div>
    <div class="a">По базе: смета по оборудованию пришла выше бюджета на 14%<sup>1</sup>, поставщик держит цену до конца недели<sup>2</sup>,
    поэтому решение нужно принять на ближайшей планёрке. Санитарные требования по площадке уточняются<sup>3</sup>.</div>
    ${lab("Источники")}
    ${rows([
      ["1 · Встреча", `<span class="lnk" ${act("open-meet", "m1")}>Планёрка по открытию, 15 сен</span>`],
      ["2 · Комментарий", `<span class="lnk" ${act("open-task", 128)}>Задача 128, М. Дамьянович</span>`],
      ["3 · Запись", `<span class="lnk" ${act("open-entry", "r7")}>Санитарные требования — выписка</span>`],
    ])}
    ${lab(`Найдено по запросу · ${r.tasks.length + r.entries.length + r.meetings.length}`)}
    ${rows([...r.tasks.map((t) => ["Задача", `<span class="lnk" ${act("open-task", t.id)}>${esc(t.t)}</span>`]),
      ...r.meetings.map((m) => ["Встреча", `<span class="lnk" ${act("open-meet", m.id)}>${esc(m.t)}</span>`]),
      ...r.entries.map((e) => ["База", `<span class="lnk" ${act("open-entry", e.id)}>${esc(e.h)}</span>`])])}
    <div class="mt">${btn("Сохранить ответ в базу", "new-entry")}${btn("Задать другой вопрос", "search")}</div></div>`;
}
