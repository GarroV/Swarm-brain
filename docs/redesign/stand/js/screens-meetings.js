/* Встречи: шесть осей фильтра и один список с секциями — вычитка, черновики, остальное.
   Очередь агентских встреч живёт в «Админе»: это разбор чужой работы, а не свой список. */

const SOURCES = ["bumblebee", "Granola", "Read.ai", "agent"];
const PERIODS = [["all", "всё время"], ["week", "неделя"], ["month", "месяц"], ["quarter", "квартал"]];

function meetBar() {
  const f = S.mf;
  return `<div class="bar wrap">
    <input class="qin" placeholder="Поиск по встречам" value="${esc(f.q)}" data-qin="meet">
    <span class="drop">${btn(`Период: ${PERIODS.find(([v]) => v === f.period)[1]}`, "noop", undefined, undefined, "sm")}
      <div class="dmenu">${PERIODS.map(([v, n]) => `<button class="mi" ${act("mf-period", undefined, v)}>${n}</button>`).join("")}</div></span>
    <span class="drop">${btn(`Источник${f.src.length ? `: ${f.src.length}` : ""}`, "noop", undefined, undefined, "sm")}
      <div class="dmenu">${SOURCES.map((s) => `<button class="mi${f.src.includes(s) ? " on" : ""}" ${act("mf-src", undefined, s)}>${s}</button>`).join("")}</div></span>
    <span class="drop">${btn(`Страна${f.cc.length ? `: ${f.cc.join(",")}` : ""}`, "noop", undefined, undefined, "sm")}
      <div class="dmenu">${COUNTRIES.map((c) => `<button class="mi${f.cc.includes(c.c) ? " on" : ""}" ${act("mf-cc", undefined, c.c)}>${c.c} · ${c.n}</button>`).join("")}</div></span>
    <span class="drop">${btn(`Участник${f.people.length ? `: ${f.people.length}` : ""}`, "noop", undefined, undefined, "sm")}
      <div class="dmenu">${S.users.slice(0, 8).map((u) => `<button class="mi${f.people.includes(u.id) ? " on" : ""}" ${act("mf-people", undefined, u.id)}>${av(u.id)}</button>`).join("")}</div></span>
    ${chip("Общее", f.store === "shared", "mf-store", undefined, f.store === "shared" ? "any" : "shared")}
    ${chip("Личное", f.store === "personal", "mf-store", undefined, f.store === "personal" ? "any" : "personal")}
    ${mfActive() ? btn("Сбросить", "mf-clear", undefined, undefined, "sm") : ""}
    <div class="right"><span>Показано <b>${visibleMeetings("any").length}</b> из ${
      S.meetings.length}</span></div></div>`;
}

function meetRow(m) {
  /* класс говорит, в каком состоянии встреча: по нему видно, ушла ли она с вычитки,
     и его же читает проверка — раньше это была отдельная шапка экрана.
     Имена именно такие: «rv» столкнулось с .rv из очереди вычитки (там это flex-строка),
     и tr со строчным display рассыпал ячейки — встречи на вычитке шли без названия
     и колонкой уже остальных (замечено владельцем 21.09) */
  const kind = m.st === "pending" ? " pend" : m.st === "draft" ? " draft" : "";
  return `<tr class="row${kind}${S.sel === m.id && S.selKind === "meeting" ? " sel" : ""}" ${act("open-meet", m.id)} tabindex="0">
    ${cell(`${dot(m.st === "pending" ? "open" : m.st === "draft" ? "open" : "done")}${esc(m.t)}${m.store === "personal" ? ' <span class="lock" title="личное хранилище">🔒</span>' : ""}`, "t")}
    ${cell(esc(fmtDT(m.dt)))}
    ${cell(tag(m.src, "m") + cc(m.cc), "opt")}
    ${cell(`<span class="due">${m.dur}</span><span class="unit">мин</span>`, "r")}
    ${cell(m.tasks.length ? `<span class="due">${m.tasks.length}</span>` : `<span class="muted">—</span>`, "r")}</tr>`;
}

function screenMeetings() {
  /* Один список с секциями вместо вкладок и шапки: «На вычитке» и так секция, а вкладки
     сверху заставляли искать встречу по трём экранам (просьба владельца 21.09).
     Вычитка стоит первой — это то, что ждёт человека. */
  const all = visibleMeetings("any");
  const pend = all.filter((m) => m.st === "pending");
  const drafts = all.filter((m) => m.st === "draft");
  const rest = all.filter((m) => m.st !== "pending" && m.st !== "draft");
  const head = meetBar();
  if (!all.length) return head + empty("Встреч в этом срезе нет",
    mfActive() ? "Сбросьте фильтры" : "Записи появятся после bumblebee, Granola или Read.ai");
  const cols = 5;
  const sect = (n, k, sub) => `<tr class="sect"><td colspan="${cols}">${esc(n)} · ${k}${
    sub ? `<span class="sub">${esc(sub)}</span>` : ""}</td></tr>`;
  const block = (title, list, sub) => list.length
    ? sect(title, list.length, sub) + list.map(meetRow).join("") : "";
  /* Участников в списке нет: в узкой колонке ряд лиц обрезался посередине («МДИПДП»
     вместо трёх), а сами лица ничего не решают при выборе встречи — кто там был, видно
     в панели. Список остался про «что, когда, откуда и сколько задач». */
  return head + table([{ t: "Встреча", w: "38%" }, { t: "Когда" }, { t: "Источник", opt: true },
    { t: "Длит.", r: true }, { t: "Задач", r: true }],
    block("На вычитке", pend, "тезисы готовы, ждут подтверждения")
    + block("Черновики bumblebee", drafts, "запись есть, тезисов ещё нет")
    + block("Все встречи", rest));
}

/* очередь вычитки агентских встреч — самый большой экран продукта */
function screenQueue() {
  if (!S.queue.length) return empty("Очередь пуста", "Агентские встречи разобраны");
  return `<div class="bar"><span>Ждут решения <b>${S.queue.length}</b></span>
    <div class="right"><span>Публикация создаёт встречу и задачи разом</span></div></div>
    <div class="qlist">${S.queue.map((q) => `<div class="qcard">
      <div class="qh"><b>${esc(q.t)}</b><span class="muted">${esc(fmtDT(q.dt))} · ${avs(q.who)} ${cc(q.cc)}</span></div>
      ${q.dup ? `<div class="warn">Похоже на дубль встречи «${esc((S.meetings.find((m) => m.id === q.dup) || {}).t || "")}»
        <span class="wacts">${btn("Открыть ту встречу", "open-meet", q.dup, undefined, "sm")}${btn("Не дубль", "not-dup", q.id, undefined, "sm")}</span></div>` : ""}
      <div class="qcols">
        <div><div class="lab">Предложенные тезисы</div><div class="tez">${q.tez.map((s) =>
          `<h5>${esc(s.h)}</h5>${s.li.map((x) => `<li>${esc(x)}</li>`).join("")}`).join("")}</div></div>
        <div><div class="lab">Предложенные задачи · ${q.tasks.filter((t) => t.off !== true).length} из ${q.tasks.length}</div>
          ${rows(q.tasks.map((t, i) => [
            `<span class="${t.off ? "dropped" : ""}">${esc(t.t)}</span>`,
            `<span class="${t.off ? "dropped" : ""}">${user(t.who).n} · ${fmtDate(t.due)}</span>`,
            btn(t.off ? "Вернуть" : "Убрать", "q-task-off", q.id, String(i), "sm")]))}</div>
      </div>
      <div class="qacts">${btn(`Опубликовать в общее${q.tasks.filter((t) => !t.off).length ? ` · задач ${q.tasks.filter((t) => !t.off).length}` : " без задач"}`, "q-accept", q.id, "shared", "pri")}
        ${btn("В личное хранилище", "q-accept", q.id, "personal")}
        ${btn("Отклонить", "q-reject", q.id)}</div></div>`).join("")}</div>`;
}

/* ── модалки встреч ──────────────────────────────────────────── */
/* подтверждение тезиса в расшифровке: совпадение по основам значимых слов */
function tezConfirmed(m, line) {
  const words = line.toLowerCase().match(/[а-яёa-z]{5,}/g) || [];
  if (!words.length) return true;
  const text = m.tr.map(([, , t]) => t).join(" ").toLowerCase();
  const hits = words.filter((w) => text.includes(stem(w))).length;
  return hits / words.length >= 0.5;
}
function compareModal(id) {
  const m = S.meetings.find((x) => x.id === id);
  /* помечаем то, что требует действия, а не то, что в порядке: подсветка подтверждённых
     красила тревожным цветом как раз спокойные пункты, а придуманные оставляла незаметными */
  const unconfirmed = m.tez.reduce((n, s) => n + s.li.filter((x) => !tezConfirmed(m, x)).length, 0);
  modal("Тезисы против транскрипта", `
    <div class="hint">${unconfirmed
      ? `Не нашли подтверждения в расшифровке: ${unconfirmed}. Такой пункт модель могла додумать — проверьте или уберите его.`
      : "Каждому пункту нашлось подтверждение в расшифровке."}</div>
    <div class="cmp">
    <div>${lab("Тезисы")}<div class="tez">${m.tez.map((s) =>
      `<h5>${esc(s.h)}</h5>${s.li.map((x) => tezConfirmed(m, x)
        ? `<li>${esc(x)}</li>`
        : `<li class="hl" title="в расшифровке подтверждения нет">${esc(x)}</li>`).join("")}`).join("")}</div></div>
    <div>${lab(`Транскрипт · ${m.dur} мин`)}<div class="tr">${m.tr.map(([w, who, text]) =>
      `<div class="ln"><span class="w">${w}</span>${av(who, false)}<span>${esc(text)}</span></div>`).join("")}</div></div></div>`,
    `${btn("Закрыть", "mclose")}${btn("Тезисы верны", "confirm-meet", id, undefined, "pri")}`, true);
}
function tezisyModal(id) {
  const m = S.meetings.find((x) => x.id === id);
  const text = m.tez.map((s) => s.li.join("\n")).join("\n");
  modal("Править тезисы", `${fld("Тезисы — по строке на пункт", area("tez", text))}
    <div class="hint">Модель перепишет текст, если нажать «Переписать моделью». Ручная правка помечает встречу как отредактированную и отключает авто-перезапись.</div>`,
    `${btn("Отмена", "mclose")}${btn("Переписать моделью", "regen-tez", id)}${btn("Сохранить", "save-tez", id, undefined, "pri")}`);
}
function publishModal(id) {
  const m = S.meetings.find((x) => x.id === id);
  modal("Опубликовать черновик записи", `
    ${fld("Название встречи", input("title", m.t))}
    <div class="two">${fld("Дата и время", input("dt", m.dt.replace(" ", "T"), "", "datetime-local"))}${fld("Длительность, мин", input("dur", String(m.dur), "", "number"))}</div>
    ${fld("Участники", pick("who", S.users.slice(0, 8).map((u) => [String(u.id), u.n]), [String(ME)]))}
    ${fld("Страны", pick("cc", COUNTRIES.map((c) => [c.c, c.n]), []))}
    ${fld("Что сделать при публикации", sw("tez", true, "Составить тезисы моделью") + sw("tasks", true, "Предложить задачи") + sw("tg", false, "Отправить участникам в Telegram"))}
    ${fld("Хранилище", sw("priv", false, "Личное — видно только мне"))}`,
    `${btn("Отмена", "mclose")}${btn("Опубликовать", "do-publish", id, undefined, "pri")}`);
}
