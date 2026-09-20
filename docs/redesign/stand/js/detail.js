/* Правая панель. Всё, что в ней нажимается, меняет состояние — заглушек нет. */

function dtabs(items) {
  return `<div class="dtabs">${items.map(([id, n, k]) =>
    `<button class="dtab${S.dtab === id ? " on" : ""}" ${act("dtab", id)}>${esc(n)}${k ? `<span class="c">${k}</span>` : ""}</button>`).join("")}</div>`;
}
const dhead = (crumb, title, acts) =>
  `<div class="d-head"><div class="d-crumb">${esc(crumb)}</div><div class="d-title">${esc(title)}</div>
   <div class="d-acts">${acts}${btn("✕", "close")}</div></div>`;

/* ── задача ──────────────────────────────────────────────────── */
function detailTask(t) {
  const cm = S.comments[t.id] || [], hi = S.history[t.id] || [];
  const acts = t.arch
    ? btn("Вернуть из архива", "restore", t.id, undefined, "pri") + btn("Удалить навсегда", "del-task", t.id)
    : (t.st !== "in_progress" ? btn("Взять в работу", "take", t.id, undefined, "pri") : btn("Готово", "move", t.id, "done", "pri"))
      + btn("Архивировать", "archive", t.id);
  let body = "";
  if (S.dtab === "overview") {
    body = `<dl class="f">
      <dt>Статус</dt><dd>${STATUSES.map(([id, n]) => `<button class="mini${t.st === id ? " on" : ""}" ${act("move", t.id, id)}>${dot(id)}${n}</button>`).join("")}</dd>
      <dt>Исполнитель</dt><dd>${select("assignee", [["", "— не назначен"], ...S.users.map((u) => [String(u.id), u.n])], String(t.who[0] || ""))
        .replace("<select", `<select ${act("set-assignee", t.id)}`)}</dd>
      <dt>Срок</dt><dd><input class="inl" value="${t.due || ""}" placeholder="—" ${act("set-due", t.id)}>${t.due && dueKind(t.due) === "now" ? ' <span class="over">просрочено</span>' : ""}</dd>
      <dt>Приоритет</dt><dd>${["high", "med", "low"].map((p) => `<button class="mini${t.prio === p ? " on" : ""}" ${act("set-prio", t.id, p)}>${pri(p)}${PRIO_LABEL[p]}</button>`).join("")}</dd>
      <dt>Метки</dt><dd>${S.labels.map((l) => `<button class="mini${t.labels.includes(l.id) ? " on" : ""}" ${act("tgl-label", t.id, l.id)}>${esc(l.n)}</button>`).join("")}</dd>
      <dt>Рынок</dt><dd>${COUNTRIES.map((c) => `<button class="mini${t.mk === c.c ? " on" : ""}" ${act("set-mk", t.id, c.c)}>${c.c}</button>`).join("")}</dd>
      <dt>Повтор</dt><dd>${["", "weekly", "monthly"].map((r) => `<button class="mini${(t.recur || "") === r ? " on" : ""}" ${act("set-recur", t.id, r)}>${r ? RECUR_LABEL[r] : "нет"}</button>`).join("")}</dd>
      <dt>Приватность</dt><dd><button class="mini${t.priv ? " on" : ""}" ${act("tgl-priv", t.id)}>${t.priv ? "личная" : "общая"}</button></dd>
      <dt>Проект</dt><dd>${esc(projPath(t.pr))}</dd></dl>
      ${t.src && t.src !== "manual" ? lab("Откуда задача") + `<div class="src" ${act("open-meet", t.src)}>${esc((S.meetings.find((m) => m.id === t.src) || {}).t || t.src)}</div>` : ""}
      ${lab("Описание")}<div class="note">${t.note ? esc(t.note) : '<span class="muted">описания нет</span>'}</div>`;
  }
  if (S.dtab === "talk") {
    body = `<div class="cms">${cm.map((c) => `<div class="cm">${av(c.who, false)}<div class="b"><div class="w"><b>${esc(user(c.who).n)}</b> · ${esc(c.w)}</div>${esc(c.t)}</div></div>`).join("")
      || '<div class="muted">Комментариев нет</div>'}</div>
      <div class="cbox"><textarea data-cin="${t.id}" placeholder="Написать комментарий"></textarea>${btn("Отправить", "comment", t.id, undefined, "pri sm")}</div>`;
  }
  if (S.dtab === "hist") {
    body = `<div class="tl">${hi.map((h) => `<div class="e"><div class="p"></div><div><b>${esc(user(h.who).n)}</b> ${esc(h.t)}<div class="w">${esc(h.w)}</div></div></div>`).join("")
      || '<div class="muted">Движения не было</div>'}</div>`;
  }
  if (S.dtab === "links") {
    body = rows(t.links.length ? t.links.map(([kind, id], i) => {
      const o = S.tasks.find((x) => x.id === id);
      return [esc(kind), `<span class="lnk" ${act("open-task", id)}>${esc(o ? o.t : id)}</span>`,
        `<button class="btn sm" ${act("drop-link", t.id, String(i))}>Снять</button>`];
    }) : [["—", "связей нет", ""]]) + `<div class="mt">${btn("Добавить связь", "add-link", t.id)}</div>`;
  }
  if (S.dtab === "subs") {
    body = rows(S.users.slice(0, 8).map((u) => [av(u.id), t.subs.includes(u.id) ? "получает уведомления" : "не подписан",
      `<button class="btn sm" ${act("tgl-sub", t.id, u.id)}>${t.subs.includes(u.id) ? "Отписать" : "Подписать"}</button>`]));
  }
  return dhead(`${projPath(t.pr)} · Задача ${t.id}`, t.t, acts)
    + `<div class="d-body">${dtabs([["overview", "Обзор"], ["talk", "Обсуждение", cm.length], ["hist", "История", hi.length], ["links", "Связи", t.links.length], ["subs", "Подписчики", t.subs.length]])}${body}</div>`;
}

/* ── встреча ─────────────────────────────────────────────────── */
function detailMeeting(m) {
  const acts = (m.st === "pending" ? btn("Подтвердить тезисы", "confirm-meet", m.id, undefined, "pri") : "")
    + (m.st === "draft" ? btn("Опубликовать в базу", "publish-draft", m.id, undefined, "pri") : "")
    + btn("Сравнить с транскриптом", "compare", m.id)
    + btn("Задачи из встречи", "harvest", m.id)
    + (m.st === "pending" ? btn("Следующая", "review-next", m.id) : "")
    + btn("Править тезисы", "edit-tez", m.id);
  const tasks = S.tasks.filter((t) => m.tasks.includes(t.id));
  let body = "";
  if (S.dtab === "overview") {
    body = (m.claim ? `<div class="lease"><b>Запись рекордера</b>${rows([
        ["Устройство", esc(m.claim.dev)],
        ["Захват", `claim ${m.claim.at}, lease до ${m.claim.lease}`, state("завершён", true)],
        ["Отложенная загрузка", m.claim.defer ? `ждала сети ${m.claim.defer} мин` : "нет"],
        ["Вторая сторона", m.claim.other ? "системный звук пойман" : "не пойман", state(m.claim.other ? "ок" : "пропуск", m.claim.other)],
      ])}</div>` : "")
      + (m.st === "draft" ? `<div class="warn">Черновик рекордера: тезисов ещё нет, в базу не попал.</div>` : "")
      + `<dl class="f"><dt>Участники</dt><dd>${m.who.map((i) => esc(user(i).n)).join(", ")}</dd>
        <dt>Когда</dt><dd><span class="due">${esc(fmtDT(m.dt))}</span></dd>
        <dt>Длительность</dt><dd><span class="due">${m.dur}</span><span class="unit">мин</span></dd>
        <dt>Источник</dt><dd>${tag(m.src, "m")}</dd>
        <dt>Хранилище</dt><dd>${["shared", "personal"].map((s) => `<button class="mini${m.store === s ? " on" : ""}" ${act("set-store", m.id, s)}>${s === "shared" ? "Общее" : "Личное"}</button>`).join("")}</dd>
        <dt>Страны</dt><dd>${COUNTRIES.map((c) => `<button class="mini${m.cc.includes(c.c) ? " on" : ""}" ${act("tgl-mcc", m.id, c.c)}>${c.c}</button>`).join("")}</dd>
        <dt>Статус</dt><dd>${m.st === "pending" ? "ждёт вычитки" : m.st === "draft" ? "черновик записи" : "подтверждена"}</dd></dl>
        ${lab("Тезисы")}${m.st === "draft"
          ? `<div class="empty sm"><b>Тезисов ещё нет</b>Черновик не разобран моделью${btn("Составить тезисы", "publish-draft", m.id, undefined, "pri mt")}</div>`
          : `<div class="tez">${m.tez.map((s) => `<h5>${esc(s.h)}</h5>${s.li.map((x) => `<li>${esc(x)}</li>`).join("")}`).join("")}</div>`}
        ${lab(`Задачи из встречи · ${tasks.length}`)}
        ${tasks.length ? rows(tasks.map((t) => [String(t.id), `<span class="lnk" ${act("open-task", t.id)}>${esc(t.t)}</span>`, state(ST_LABEL[t.st], t.st === "done")]))
          : rows([["—", "задач нет", btn("Собрать из тезисов", "harvest", m.id, undefined, "sm")]])}`;
  }
  if (S.dtab === "tr") {
    body = `<div class="tr">${m.tr.map(([w, who, text]) =>
      `<div class="ln"><span class="w">${w}</span>${av(who, false)}<span>${esc(text)}</span></div>`).join("")}</div>`;
  }
  return dhead(`${m.src} · ${fmtDT(m.dt)}`, m.t, acts)
    + `<div class="d-body">${dtabs([["overview", "Обзор"], ["tr", "Транскрипт", m.tr.length]])}${body}</div>`;
}

/* ── запись базы ─────────────────────────────────────────────── */
function detailEntry(e) {
  const files = S.files.filter((f) => f.rec === e.id);
  return dhead(`Запись · ${e.ty}`, e.h,
    btn("Открыть полностью", "reader", e.id, undefined, "pri") + btn("Переиндексировать", "reindex-entry", e.id)
    + btn("Править", "edit-entry", e.id) + btn("Удалить", "del-entry", e.id))
    + `<div class="d-body"><dl class="f">
      <dt>Тип</dt><dd>${tag(e.ty, "p")}</dd><dt>Автор</dt><dd>${av(e.who)}</dd>
      <dt>Добавлена</dt><dd>${due(e.at)}</dd>
      <dt>Приватность</dt><dd><button class="mini${e.priv ? " on" : ""}" ${act("tgl-epriv", e.id)}>${e.priv ? "личная" : "общая"}</button></dd>
      <dt>Страны</dt><dd>${COUNTRIES.map((c) => `<button class="mini${e.cc.includes(c.c) ? " on" : ""}" ${act("tgl-ecc", e.id, c.c)}>${c.c}</button>`).join("")}</dd>
      <dt>Индекс</dt><dd>${state(e.ix.n ? `${nFrag(e.ix.n)} · ${e.ix.at}` : "не индексируется", !!e.ix.n)}</dd></dl>
      ${lab("Фрагмент")}<div class="note">${esc(e.p)}</div>
      ${e.meet ? lab("Из встречи") + `<div class="src" ${act("open-meet", e.meet)}>${esc((S.meetings.find((m) => m.id === e.meet) || {}).t || "")}</div>` : ""}
      ${lab(`Файлы · ${files.length}`)}
      ${files.length ? rows(files.map((f) => [`<span class="ft ft-${f.ty}">${f.ty}</span>`, esc(f.n), btn("Открыть", "open-file", f.id, undefined, "sm")]))
        : rows([["—", "файлов нет", ""]])}</div>`;
}

/* ── файл ────────────────────────────────────────────────────── */
function detailFile(f) {
  const e = S.entries.find((x) => x.id === f.rec) || {};
  return dhead(`Файл · ${f.ty.toUpperCase()}`, f.n,
    btn("Скопировать ссылку", "copy", undefined, `https://swarm-brain.pages.dev/drive/${f.id}/${f.n}`, "pri") + btn("Переиндексировать", "reindex-file", f.id) + btn("Заменить файл", "replace-file", f.id))
    + `<div class="d-body"><div class="prev"><span class="ft ft-${f.ty}">${f.ty}</span>Предпросмотр доступен после открытия</div>
      <dl class="f"><dt>Размер</dt><dd><span class="due">${esc(f.sz)}</span></dd>
      <dt>Загрузил</dt><dd>${av(f.who)}</dd><dt>Когда</dt><dd>${due(f.at)}</dd>
      <dt>Индекс</dt><dd>${state(f.ix, f.ix.includes("фрагмент") || f.ix === "переиндексирован")}</dd>
      <dt>Доступ</dt><dd>Воркспейс IMF BD</dd></dl>
      ${lab("Привязан к записи")}<div class="src" ${act("open-entry", f.rec)}>${esc(e.h || "—")}</div></div>`;
}

/* ── проект ──────────────────────────────────────────────────── */
function detailProject(p) {
  const subs = S.projects.filter((x) => x.parent === p.id);
  const tasks = S.tasks.filter((t) => t.pr === p.id || subs.some((s) => s.id === t.pr));
  const open = tasks.filter((t) => t.st !== "done" && !t.arch).length;
  return dhead(`Проект · ${p.st === "paused" ? "пауза" : "идёт"}`, p.n,
    btn("Открыть задачи", "proj-tasks", p.id, undefined, "pri") + btn("Создать подпроект", "new-subproject", p.id) + btn(p.st === "paused" ? "Возобновить" : "Поставить на паузу", "toggle-proj", p.id))
    + `<div class="d-body"><dl class="f">
      <dt>Владелец</dt><dd>${av(p.own)}</dd>
      <dt>Срок</dt><dd>${due(p.due)}</dd>
      <dt>Задачи</dt><dd><span class="pdot p-med"></span>${open} открыто из ${tasks.length}</dd>
      <dt>Подпроекты</dt><dd>${subs.length || "—"}</dd></dl>
      ${lab("Описание")}<div class="note">${esc(p.d)}</div>
      ${lab("Подпроекты")}${subs.length ? rows(subs.map((s) => [esc(s.n),
        nTasks(S.tasks.filter((t) => t.pr === s.id && !t.arch).length), btn("Открыть", "open-proj", s.id, undefined, "sm")]))
        : rows([["—", "подпроектов нет", ""]])}
      ${lab("Последние задачи")}${rows(tasks.slice(0, 5).map((t) => [dot(t.st), `<span class="lnk" ${act("open-task", t.id)}>${esc(t.t)}</span>`, due(t.due)]))}</div>`;
}

function renderDetail() {
  const app = $(".app"), d = $(".detail");
  const map = {
    task: () => { const t = S.tasks.find((x) => x.id === S.sel); return t && detailTask(t); },
    meeting: () => { const m = S.meetings.find((x) => x.id === S.sel); return m && detailMeeting(m); },
    entry: () => { const e = S.entries.find((x) => x.id === S.sel); return e && detailEntry(e); },
    file: () => { const f = S.files.find((x) => x.id === S.sel); return f && detailFile(f); },
    project: () => { const p = proj(S.sel); return p && detailProject(p); },
  };
  const html = S.selKind && map[S.selKind] ? map[S.selKind]() : null;
  if (!html) { app.classList.remove("with-detail"); d.innerHTML = ""; return; }
  app.classList.add("with-detail"); d.innerHTML = html;
}
