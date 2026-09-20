/* Поверхности, которых не хватало: сбор задач из встречи, вычитка подряд,
   чтение записи целиком, редактор меток, профиль в админке, команды рекордера, таймлайн. */

/* ── сбор задач из встречи (TasksHarvestSheet) ───────────────── */
const HARVEST = {
  m1: [["Свести смету по позициям к планёрке", 501, "2026-09-22"], ["Запросить у поставщика фиксацию цены", 503, "2026-09-21"]],
  m2: [["Подготовить договор к подписанию", 503, "2026-09-24"], ["Согласовать сроки поставки с франчайзи", 510, "2026-09-22"]],
  m3: [["Свести бюджет Q4 к финальной версии", 503, "2026-10-03"], ["Проверить расходы по Черногории", 509, "2026-09-28"]],
};
function harvestModal(id) {
  const m = S.meetings.find((x) => x.id === id);
  const items = HARVEST[id] || [["Уточнить договорённости по итогам встречи", m.who[0], "2026-09-30"]];
  modal(`Задачи из встречи «${m.t}»`, `
    <div class="hint">Модель предложила задачи по тезисам. Снимите галочку с лишнего, поправьте исполнителя и срок.</div>
    <div class="hrv">${items.map((it, i) => `<div class="hrow">
      <label class="hck"><input type="checkbox" data-f="on${i}" checked></label>
      <div class="hmain">${input(`t${i}`, it[0])}</div>
      <div class="hwho">${select(`w${i}`, S.users.map((u) => [String(u.id), u.n]), String(it[1]))}</div>
      <div class="hdue">${input(`d${i}`, it[2])}</div></div>`).join("")}</div>`,
    `${btn("Отмена", "mclose")}${btn("Создать выбранные", "do-harvest", id, String(items.length), "pri")}`, true);
}

/* ── вычитка подряд ──────────────────────────────────────────── */
function reviewNext(fromId) {
  const pend = S.meetings.filter((m) => m.st === "pending");
  const next = pend.find((m) => m.id !== fromId) || pend[0];
  if (!next) { A.close(); return A.toast("Вычитка закончена — невычитанных встреч нет"); }
  A.select("meeting", next.id);
}

/* ── чтение записи целиком ───────────────────────────────────── */
function readerModal(id) {
  const e = S.entries.find((x) => x.id === id);
  const full = e.full || `${e.p}\n\n${e.p}\n\nДалее по тексту: детали, ссылки на файлы и ответственных. Полный текст записи хранится в базе и попадает в поиск целиком.`;
  modal(e.h, `<div class="reader">${full.split("\n\n").map((x) => `<p>${esc(x)}</p>`).join("")}</div>`,
    `${btn("Закрыть", "mclose")}${btn("Править", "noop")}${btn("Скачать", "noop")}`, true);
}

/* ── редактор меток ──────────────────────────────────────────── */
function screenLabels() {
  return `<div class="panes"><div class="pane"><h3>Метки задач</h3>
    <div class="sub">Общие для воркспейса: ими помечают задачи и фильтруют списки</div>
    ${rows(S.labels.map((l) => [tag(l.n, "o"),
      `${S.tasks.filter((t) => t.labels.includes(l.id)).length} задач`,
      `<span class="ib">${btn("Переименовать", "rename-label", l.id, undefined, "sm")}${btn("Удалить", "del-label", l.id, undefined, "sm")}</span>`]))}
    <div class="mt">${btn("Добавить метку", "add-label", undefined, undefined, "pri")}</div></div></div>`;
}
function labelModal(id) {
  const l = id ? label(id) : null;
  modal(l ? "Переименовать метку" : "Новая метка", fld("Название", input("n", l ? l.n : "", "например, закупки")),
    `${btn("Отмена", "mclose")}${btn("Сохранить", "save-label", id || "", undefined, "pri")}`);
}

/* ── профиль пользователя в админке ──────────────────────────── */
function userModal(id) {
  const u = user(+id);
  modal(`Профиль · ${u.n}`, `
    <div class="two">${fld("Имя", input("n", u.n))}${fld("Роль", select("role", Object.entries(ROLE), u.role))}</div>
    <div class="two">${fld("Почта", input("em", u.em, "нужна для очереди вычитки"))}${fld("Telegram", input("tg", u.tg))}</div>
    ${fld("Рынки", pick("mk", COUNTRIES.map((c) => [c.c, c.n]), [u.mk]))}
    ${fld("Заметка админа", area("note", "", "Что важно знать про этого человека"))}
    <div class="hint">Почта связывает человека с участием во встречах: без неё он не увидит свою очередь вычитки.</div>`,
    `${btn("Отмена", "mclose")}${btn("Сохранить профиль", "save-user", id, undefined, "pri")}`);
}

/* ── команды установки рекордера ─────────────────────────────── */
function recorderModal(kind) {
  const cmd = kind === "update" ? "swarm-rec update --channel stable"
    : "curl -fsSL https://swarm-brain.pages.dev/rec/install.sh | sh -s -- --token smcp_••••••••";
  modal(kind === "update" ? "Обновить bumblebee" : "Установить bumblebee",
    `<div class="hint">Выполните команду в Терминале на ноутбуке, где будете записывать встречи.</div>
     <pre class="cmd">${esc(cmd)}</pre>
     ${rows([["Текущий билд", "24 · от 12 сен"], ["Токен рекордера", "привязан к вашему аккаунту"],
       ["Разрешения macOS", "микрофон и системный звук запросит сам"]])}`,
    `${btn("Закрыть", "mclose")}${btn("Скопировать команду", "copy", undefined, cmd, "pri")}`);
}

/* ── таймлайн задач ──────────────────────────────────────────── */
function screenTimeline() {
  const list = S.tasks.filter((t) => t.due && !t.arch && S.statuses.has(t.st) && inLens(t, S.lens))
    .sort((a, b) => a.due.localeCompare(b.due));
  const days = [...new Set(list.map((t) => t.due))];
  return cycleBar(`<span>Задач со сроком <b>${list.length}</b></span>`) + `<div class="tlv">${days.map((day) => {
    const items = list.filter((t) => t.due === day);
    const late = dueKind(day) === "now";
    return `<div class="tday${late ? " late" : ""}"><div class="tdh">${fmtDate(day)}<span class="n">${items.length}</span></div>
      <div class="tditems">${items.map((t) => `<div class="tdi" ${act("open-task", t.id)}>${dot(t.st)}${pri(t.prio)}${esc(t.t)}
        <span class="who">${t.who.length ? av(t.who[0], false) : ""}</span></div>`).join("")}</div></div>`;
  }).join("")}</div>`;
}
