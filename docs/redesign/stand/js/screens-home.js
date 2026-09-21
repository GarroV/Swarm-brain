/* Главная — дом. Здесь человек начинает день и не ходит по вкладкам:
   встречи дня, ближайшие задачи, что ждёт лично его, топ новостей, последнее в базе.
   Это не новый функционал: то же, что сейчас разложено панелями по дашборду прода. */

function homeNews() {
  const over = S.tasks.filter((t) => !t.arch && t.st !== "done" && dueKind(t.due) === "now" && t.who.includes(ME));
  const pending = S.meetings.filter((m) => m.st === "pending").length;
  const closed = S.tasks.filter((t) => t.st === "done" && !t.arch).length;
  const fresh = S.entries.length;
  /* ровно пять строк: новость без числа — не новость, поэтому у каждой своё */
  return [
    [over.length ? `Просрочено задач: ${over.length}` : "Просроченного нет", over.length ? "bad" : "ok", "sec", "tasks"],
    [`Ждут вычитки встреч: ${pending}`, pending ? "warn" : "ok", "sec", "meetings"],
    [`Встреч сегодня: ${CALENDAR.length}`, "ok", "sec", "meetings"],
    [`Предложений агента: ${S.queue.length}`, S.queue.length ? "warn" : "ok", "sec", "meetings"],
    [`Закрыто задач за неделю: ${closed} · записей в базе: ${fresh}`, "ok", "sec", "base"],
  ];
}

/* ширина правого столбца — та же, что в .home в app.css: проценты колонок считаются
   от ЛЕВОГО столбца, иначе срок схлопывается в «17 …» */
const HOME_SIDE = 344;

function screenHome() {
  const mine = S.tasks.filter((t) => !t.arch && t.st !== "done" && t.who.includes(ME));
  const grp = (name, list) => list.length
    ? `<tr class="sect"><td colspan="4">${esc(name)} · ${list.length}</td></tr>` + list.map(homeRow).join("")
    : "";
  const over = mine.filter((t) => dueKind(t.due) === "now");
  const today = mine.filter((t) => t.due === TODAY && dueKind(t.due) !== "now");
  const week = mine.filter((t) => t.due && t.due > TODAY).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6);
  const rest = mine.filter((t) => !t.due).slice(0, 4);
  const body = grp("Просрочено", over) + grp("Сегодня", today) + grp("Дальше", week) + grp("Без срока", rest);
  /* «Задачи команды» — панель дашборда продукта: общие задачи, которые никто не взял.
     Без неё главная показывает только свою работу, и ничьи задачи остаются незамеченными. */
  const team = S.tasks.filter((t) => !t.arch && t.st !== "done" && !t.priv && !t.who.length)
    .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
  const pending = S.meetings.filter((m) => m.st === "pending");
  const recent = [...S.entries].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 4);
  return `<div class="home">
    <div class="hcol">
      <div class="lab">Мои задачи · ${mine.length}</div>
      ${body
        ? table([{ t: "Задача" }, { t: "Проект", w: "26%" }, { t: "Метки", w: "18%", opt: true }, { t: "Срок", r: true, w: "96px" }],
            body, Math.max(320, workW() - HOME_SIDE))
        : empty("Задач на вас нет", "Свободно — можно взять из общего списка")}
      <div class="lab">Задачи команды · ${team.length}${team.length ? ` <span class="labr" ${act("team-tasks")} tabindex="0">все задачи команды</span>` : ""}</div>
      ${team.length
        ? table([{ t: "Задача" }, { t: "Проект", w: "26%" }, { t: "Срок", r: true, w: "96px" }],
            team.slice(0, 5).map((t) => `<tr class="row${S.sel === t.id && S.selKind === "task" ? " sel" : ""}" ${act("open-task", t.id)} tabindex="0">
              ${cell(`${dot(t.st)}${priMark(t.prio)}${esc(t.t)}`, "t")}${cell(esc(projPath(t.pr)))}${cell(due(t.due, false), "r")}</tr>`).join(""),
            Math.max(320, workW() - HOME_SIDE))
        : empty("Ничьих задач нет", "Всё, что общее, кто-то уже взял")}
    </div>
    <div class="hcol side">
      <div class="lab">Встречи сегодня · ${CALENDAR.length}</div>
      ${calendarList()}

      <div class="lab">Топ 5 новостей</div>
      <div class="news">${homeNews().map(([t, kind, a, id]) =>
        `<div class="nw ${kind}" ${act(a, id)} tabindex="0"><i></i>${esc(t)}</div>`).join("")}</div>

      <div class="lab">Ждут вас</div>
      ${pending.length
        ? `<div class="news">${pending.slice(0, 4).map((m) =>
            `<div class="nw warn" ${act("open-meet", m.id)} tabindex="0"><i></i>${esc(clip(m.t, 40))}<span class="r">вычитка</span></div>`).join("")}</div>`
        : `<div class="news"><div class="nw ok"><i></i>Вычитка разобрана</div></div>`}

      <div class="lab">Последнее в базе</div>
      <div class="news">${recent.map((e) =>
        `<div class="nw" ${act("open-entry", e.id)} tabindex="0"><i></i>${esc(clip(e.h, 40))}<span class="r">${fmtDate(e.at)}</span></div>`).join("")}</div>
    </div>
  </div>`;
}

function homeRow(t) {
  return `<tr class="row${S.sel === t.id && S.selKind === "task" ? " sel" : ""}" ${act("open-task", t.id)} tabindex="0">
    ${cell(`${dot(t.st)}${priMark(t.prio)}${esc(t.t)}`, "t")}
    ${cell(esc(projPath(t.pr)))}
    ${cell(lbls(t.labels), "opt")}
    ${cell(due(t.due, false), "r")}</tr>`;
}
