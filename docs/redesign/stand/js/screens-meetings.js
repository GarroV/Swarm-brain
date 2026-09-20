/* Встречи: шесть осей фильтра, вычитка, черновики рекордера, очередь агента. */

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
    <div class="right"><span>Невычитано <b>${S.meetings.filter((m) => m.st === "pending").length}</b></span>
      <span>Черновиков <b>${S.meetings.filter((m) => m.st === "draft").length}</b></span></div></div>`;
}

function meetRow(m) {
  return `<tr class="row${S.sel === m.id && S.selKind === "meeting" ? " sel" : ""}" ${act("open-meet", m.id)} tabindex="0">
    ${cell(`${dot(m.st === "pending" ? "open" : m.st === "draft" ? "open" : "done")}${esc(m.t)}${m.store === "personal" ? ' <span class="lock" title="личное хранилище">🔒</span>' : ""}`, "t")}
    ${cell(esc(fmtDT(m.dt)))}
    ${cell(avs(m.who))}
    ${cell(tag(m.src, "m") + cc(m.cc))}
    ${cell(`<span class="due">${m.dur} мин</span>`, "r")}
    ${cell(m.tasks.length ? `<span class="pdot p-med"></span>${m.tasks.length}` : `<span class="muted">—</span>`, "r")}</tr>`;
}

function dupStrip() {
  const dups = S.meetings.filter((m) => m.st === "draft" && !m.dupOk);
  if (!dups.length) return "";
  return `<div class="review dup">Похоже на дубли: ${dups.length}. Черновик рекордера совпадает с уже разобранной встречей.</div>`
    + table([{ t: "Черновик", w: "30%" }, { t: "Похож на", w: "30%" }, { t: "Когда" }, { t: "Совпадение" }, { t: "Что делать", r: true, w: "210px" }],
      dups.map((m, i) => `<tr class="row">${cell(dot("open") + esc(m.t), "t")}
        ${cell(esc((S.meetings.find((x) => x.st !== "draft") || {}).t || "—"))}${cell(esc(fmtDT(m.dt)))}
        ${cell(state(i === 0 ? "87%" : "71%", false))}
        ${cell(`<span class="ib">${btn("Объединить", "merge-dup", m.id, undefined, "sm")}${btn("Не дубль", "keep-dup", m.id, undefined, "sm")}</span>`, "r acts")}</tr>`).join(""));
}

function screenMeetings() {
  if (S.tab === "queue") return screenQueue();
  const list = visibleMeetings(S.tab);
  const strip = S.tab === "review" && list.length
    ? `<div class="review">Невычитанных встреч: ${list.length}. Тезисы готовы, ждут подтверждения.
       ${btn("Вычитать подряд", "review-next", "", undefined, "sm")}</div>` : "";
  const head = meetBar() + (S.tab === "draft" ? dupStrip() + lab("Черновики без разбора") : strip);
  if (!list.length) return head + empty("Встреч в этом срезе нет", mfActive() ? "Сбросьте фильтры" : "Записи появятся после bumblebee, Granola или Read.ai");
  return head + table([{ t: "Встреча", w: "36%" }, { t: "Когда" }, { t: "Участники" }, { t: "Источник" },
    { t: "Длит.", r: true }, { t: "Задач", r: true }], list.map(meetRow).join(""));
}

/* очередь вычитки агентских встреч — самый большой экран продукта */
function screenQueue() {
  if (!S.queue.length) return empty("Очередь пуста", "Агентские встречи разобраны");
  return `<div class="bar"><span class="chip on">Ждут решения: ${S.queue.length}</span>
    <div class="right"><span>Публикация создаёт встречу и задачи разом</span></div></div>
    <div class="qlist">${S.queue.map((q) => `<div class="qcard">
      <div class="qh"><b>${esc(q.t)}</b><span class="muted">${esc(fmtDT(q.dt))} · ${avs(q.who)} ${cc(q.cc)}</span></div>
      ${q.dup ? `<div class="warn">Похоже на дубль встречи «${esc((S.meetings.find((m) => m.id === q.dup) || {}).t || "")}»</div>` : ""}
      <div class="qcols">
        <div><div class="lab">Предложенные тезисы</div><div class="tez">${q.tez.map((s) =>
          `<h5>${esc(s.h)}</h5>${s.li.map((x) => `<li>${esc(x)}</li>`).join("")}`).join("")}</div></div>
        <div><div class="lab">Предложенные задачи · ${q.tasks.filter((t) => t.off !== true).length} из ${q.tasks.length}</div>
          ${rows(q.tasks.map((t, i) => [
            `<span class="${t.off ? "off" : ""}">${esc(t.t)}</span>`,
            `<span class="${t.off ? "off" : ""}">${user(t.who).n} · ${fmtDate(t.due)}</span>`,
            btn(t.off ? "Вернуть" : "Убрать", "q-task-off", q.id, String(i), "sm")]))}</div>
      </div>
      <div class="qacts">${btn(`Опубликовать в общее${q.tasks.filter((t) => !t.off).length ? ` · задач ${q.tasks.filter((t) => !t.off).length}` : " без задач"}`, "q-accept", q.id, "shared", "pri")}
        ${btn("В личное хранилище", "q-accept", q.id, "personal")}
        ${btn("Отклонить", "q-reject", q.id)}</div></div>`).join("")}</div>`;
}

/* ── модалки встреч ──────────────────────────────────────────── */
function compareModal(id) {
  const m = S.meetings.find((x) => x.id === id);
  modal("Тезисы против транскрипта", `<div class="cmp">
    <div>${lab("Тезисы")}<div class="tez">${m.tez.map((s) =>
      `<h5>${esc(s.h)}</h5>${s.li.map((x) => `<li class="hl">${esc(x)}</li>`).join("")}`).join("")}</div></div>
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
    <div class="two">${fld("Дата и время", input("dt", m.dt))}${fld("Длительность", input("dur", `${m.dur} мин`))}</div>
    ${fld("Участники", pick("who", S.users.slice(0, 8).map((u) => [String(u.id), u.n]), [String(ME)]))}
    ${fld("Страны", pick("cc", COUNTRIES.map((c) => [c.c, c.n]), []))}
    ${fld("Что сделать при публикации", sw("tez", true, "Составить тезисы моделью") + sw("tasks", true, "Предложить задачи") + sw("tg", false, "Отправить участникам в Telegram"))}
    ${fld("Хранилище", sw("priv", false, "Личное — видно только мне"))}`,
    `${btn("Отмена", "mclose")}${btn("Опубликовать", "do-publish", id, undefined, "pri")}`);
}
