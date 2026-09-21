/* Правая панель. Всё, что в ней нажимается, меняет состояние — заглушек нет. */

function dtabs(items, cur) {
  const on = cur || S.dtab;
  return `<div class="dtabs">${items.map(([id, n, k]) =>
    `<button class="dtab${on === id ? " on" : ""}" ${act("dtab", id)}>${esc(n)}${k ? `<span class="c">${k}</span>` : ""}</button>`).join("")}</div>`;
}
const dhead = (crumb, title, acts) =>
  `<div class="d-head"><div class="d-crumb">${esc(crumb)}</div><div class="d-title">${esc(title)}</div>
   <span class="d-close">${btn("✕", "close", undefined, undefined, "sm")}</span>
   <div class="d-acts">${acts}</div></div>`;

/* ── задача ──────────────────────────────────────────────────── */
/* Свойства задачи — сетка чипов, а не столбик полей: подписи и значения выровнены
   по колонкам, значение нажимается, варианты приходят меню. Столбик из девяти строк
   владелец назвал деревом настроек — и был прав: он читался как форма, а не как задача. */
function taskProps(t) {
  const users = [["— не назначен", "set-who", t.id, "", !t.who.length],
    ...S.users.map((u) => [`${av(u.id, false)}${esc(u.n)}`, "set-who", t.id, String(u.id), t.who[0] === u.id])];
  return `<div class="props">
    ${pchip("Статус", `${dot(t.st)}${ST_LABEL[t.st]}`, STATUSES.map(([id, n]) => [`${dot(id)}${n}`, "move", t.id, id, t.st === id]))}
    ${pchip("Исполнитель", t.who.length ? `${av(t.who[0], false)}${esc(user(t.who[0]).n)}` : `<span class="muted">не назначен</span>`, users)}
    <span class="pchip wide"><span class="k">Срок</span><span class="v">
      <input type="date" class="dv" value="${t.due || ""}" ${act("set-due", t.id)}>${t.due && dueKind(t.due) === "now" ? '<span class="over">просрочено</span>' : ""}</span></span>
    ${pchip("Приоритет", `${pri(t.prio)}${PRIO_LABEL[t.prio]}`, ["high", "med", "low"].map((p) => [`${pri(p)}${PRIO_LABEL[p]}`, "set-prio", t.id, p, t.prio === p]))}
    ${pchip("Рынок", t.mk ? `<span class="cc">${t.mk}</span>${esc(cname(t.mk))}` : `<span class="muted">не указан</span>`, COUNTRIES.map((c) => [`<span class="cc">${c.c}</span>${esc(c.n)}`, "set-mk", t.id, c.c, t.mk === c.c]))}
    ${pchip("Повтор", t.recur ? RECUR_LABEL[t.recur] : "нет", ["", "weekly", "monthly"].map((r) => [r ? RECUR_LABEL[r] : "нет", "set-recur", t.id, r, (t.recur || "") === r]))}
    ${pchip("Приватность", t.priv ? "личная" : "общая", [["общая", "set-priv", t.id, "", !t.priv], ["личная", "set-priv", t.id, "1", t.priv]])}
    ${pchip("Роль", t.role ? ROLE_LABEL[t.role] : `<span class="muted">без роли</span>`,
      [["без роли", "set-role", t.id, "", !t.role], ...Object.keys(ROLE_LABEL).map((r) => [ROLE_LABEL[r], "set-role", t.id, r, t.role === r])])}
    <span class="pchip wide"><span class="k">Напомнить</span><span class="v">
      <input type="date" class="dv" value="${t.ping || ""}" ${act("set-ping", t.id)}>${
      t.ping && t.pinged ? '<span class="over" title="пинг одноразовый: выберите новый день, чтобы напомнить снова">уже напомнили</span>' : ""}${
      t.ping ? btn("убрать", "drop-ping", t.id, undefined, "sm") : ""}</span></span>
    ${pchip("Метки", lbls(t.labels), S.labels.map((l) => [esc(l.n), "tgl-label", t.id, l.id, t.labels.includes(l.id)]), "wide")}
    ${pflat("Проект", esc(projPath(t.pr)), "wide")}
  </div>`;
}

function detailTask(t) {
  const cm = S.comments[t.id] || [], hi = [...(S.history[t.id] || [])].sort((a, b) => a.m - b.m);
  const acts = t.arch
    ? btn("Вернуть из архива", "restore", t.id, undefined, "pri") + btn("Удалить навсегда", "del-task", t.id)
    : (t.st !== "in_progress" ? btn("Взять в работу", "take", t.id, undefined, "pri") : btn("Готово", "move", t.id, "done", "pri"))
      + btn("Архивировать", "archive", t.id);
  let body = "";
  if (S.dtab === "overview") {
    body = taskProps(t)
      + (t.src && t.src !== "manual" ? lab("Откуда задача") + `<div class="src" ${act("open-meet", t.src)}>${esc((S.meetings.find((m) => m.id === t.src) || {}).t || t.src)}</div>` : "")
      + lab("Описание") + `<div class="note lg">${t.note ? esc(t.note) : '<span class="muted">описания нет</span>'}</div>`;
  }
  if (S.dtab === "talk") {
    body = `<div class="cms">${cm.map((c) => `<div class="cm">${av(c.who, false)}<div class="b"><div class="w"><b>${esc(user(c.who).n)}</b> · ${esc(c.w)}</div>${esc(c.t)}</div></div>`).join("")
      || '<div class="muted">Комментариев нет</div>'}</div>
      <div class="cbox"><textarea data-cin="${t.id}" placeholder="Написать комментарий"></textarea>${btn("Отправить", "comment", t.id, undefined, "pri sm")}</div>`;
  }
  if (S.dtab === "hist") {
    body = `<div class="tl">${hi.map((h) => `<div class="e"><div class="p"></div><div><b>${esc(user(h.who).n)}</b>
      <span class="ev">${esc(h.k)}${h.v ? `: <b>${esc(h.v)}</b>` : ""}</span><div class="w">${esc(ago(h.m))}</div></div></div>`).join("")
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
    + `<div class="d-body">${dtabs([["overview", "Обзор"], ["talk", "Комментарии", cm.length], ["hist", "История", hi.length], ["links", "Связи", t.links.length], ["subs", "Подписчики", t.subs.length]])}${body}</div>`;
}

/* ── встреча ─────────────────────────────────────────────────── */
function detailMeeting(m) {
  const tasks = S.tasks.filter((t) => m.tasks.includes(t.id));
  const isReview = m.st === "pending";
  const nTez = m.tez.reduce((n, sec) => n + sec.li.length, 0);
  /* Транскрипт нужен на вычитке — там его сверяют с тезисами. У разобранной встречи он
     лежит в базе отдельной записью, и вторая копия вкладкой только занимает место. */
  const trEntry = S.entries.find((e) => e.meet === m.id && e.ty === "transcript");
  const items = [["overview", "Обзор"], ["tez", "Тезисы", nTez]]
    .concat(isReview ? [["tr", "Транскрипт", m.tr.length]] : []);
  const cur = items.some(([id]) => id === S.dtab) ? S.dtab : "overview";
  const acts = (isReview ? btn("Подтвердить тезисы", "confirm-meet", m.id, undefined, "pri") : "")
    + (m.st === "draft" ? btn("Опубликовать в базу", "publish-draft", m.id, undefined, "pri") : "")
    + (isReview ? btn("Сравнить с транскриптом", "compare", m.id) : "")
    + btn("Собрать задачи", "harvest", m.id)
    + (isReview ? btn("Следующая", "review-next", m.id) : "")
    + btn("Править тезисы", "edit-tez", m.id)
    /* «Переобработать» в продукте спрашивает ЧТО поменять: четыре готовых пожелания и своё.
       Кнопка «пересобрать» без выбора возвращала тот же текст, и человек жал её second раз. */
    + (m.st !== "draft" ? `<span class="drop">${btn("Переобработать", "noop", undefined, undefined, "")}
      ${fmenu([["короче", "regen", m.id, "short"], ["подробнее", "regen", m.id, "long"],
        ["акцент на решениях", "regen", m.id, "decisions"], ["просто пересобрать", "regen", m.id, "plain"],
        ["своё пожелание…", "regen-own", m.id]])}</span>` : "")
    + `<span class="drop">${btn("Ещё", "noop", undefined, undefined, "")}
      ${fmenu([["Копировать тезисы", "copy-tez", m.id], ["Изменить название", "rename-meet", m.id],
        ["Удалить встречу", "del-meet", m.id]])}</span>`;
  let body = "";
  if (cur === "overview") {
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
        <dt>Хранилище</dt><dd>${pickf(m.store === "shared" ? "Общее" : "Личное", ["shared", "personal"].map((x) => [x === "shared" ? "Общее" : "Личное", "set-store", m.id, x, m.store === x]))}</dd>
        <dt>Страны</dt><dd>${pickm(m.cc.length ? cc(m.cc) : `<span class="muted">—</span>`, COUNTRIES.map((c) => [`<span class="cc">${c.c}</span>${esc(c.n)}`, "tgl-mcc", m.id, c.c, m.cc.includes(c.c)]))}</dd>
        <dt>Статус</dt><dd>${state(MEET_ST[m.st], m.st === "confirmed")}</dd></dl>
        ${lab(`Задачи из встречи · ${tasks.length}`)}
        ${tasks.length ? rows(tasks.map((t) => [String(t.id), `<span class="lnk" ${act("open-task", t.id)}>${esc(t.t)}</span>`, state(ST_LABEL[t.st], t.st === "done")]))
          : `<div class="empty sm"><b>Задач из встречи ещё нет</b>Тезисы разбираются на задачи по одному нажатию</div>`}
        <div class="mt">${btn("Собрать задачи", "harvest", m.id, undefined, "pri")}</div>
        ${m.notes.length ? lab(`Пометки на полях · ${m.notes.length}`)
          + `<div class="mnotes">${m.notes.map((n) => `<div class="mn">${av(n.who, false)}<div class="b">
            <div class="w"><b>${esc(user(n.who).n)}</b> · ${esc(n.at)}</div>${esc(n.t)}</div></div>`).join("")}</div>` : ""}
        ${!isReview && trEntry ? lab("Транскрипт") + `<div class="src" ${act("open-entry", trEntry.id)}>${esc(trEntry.h)}</div>` : ""}`;
  }
  if (cur === "tez") {
    body = m.st === "draft"
      ? `<div class="empty sm"><b>Тезисов ещё нет</b>Черновик не разобран моделью${btn("Составить тезисы", "publish-draft", m.id, undefined, "pri mt")}</div>`
      : `<div class="tez">${m.tez.map((sec) => `<h5>${esc(sec.h)}</h5>${sec.li.map((x) => `<li>${esc(x)}</li>`).join("")}`).join("")}</div>`;
  }
  if (cur === "tr") {
    body = `<div class="tr">${m.tr.map(([w, who, text]) =>
      `<div class="ln"><span class="w">${w}</span>${av(who, false)}<span>${esc(text)}</span></div>`).join("")}</div>`;
  }
  return dhead(`${m.src} · ${fmtDT(m.dt)}`, m.t, acts)
    + `<div class="d-body">${dtabs(items, cur)}${body}</div>`;
}

/* ── запись базы ─────────────────────────────────────────────── */
/* «Кратко от ИИ» — то, что в продукте показывает RecordDetail: одно-два предложения
   по записи. В стенде модели нет, поэтому пересказ собирается из самой записи, и у
   записи без текста его не появляется: выдуманная сводка хуже её отсутствия. */
function aiSum(e) {
  if (!e.p) return "Пересказывать нечего: у записи нет текста.";
  const first = e.p.split(/(?<=[.!?])\s/)[0] || e.p;
  return `${first} Источник — ${TY_LABEL[e.ty] || e.ty}${e.meet ? " со встречи" : ""}, ${e.ix.n ? `в индексе ${nFrag(e.ix.n)}` : "вне индекса"}.`;
}

function detailEntry(e) {
  const files = S.files.filter((f) => f.rec === e.id);
  return dhead(`Запись · ${e.ty}`, e.h,
    btn("Открыть полностью", "reader", e.id, undefined, "pri") + btn("В задачу", "task-from-entry", e.id)
    + btn("Переиндексировать", "reindex-entry", e.id)
    + btn("Править", "edit-entry", e.id) + btn("Удалить", "del-entry", e.id))
    + `<div class="d-body"><dl class="f">
      <dt>Тип</dt><dd>${tag(TY_LABEL[e.ty] || e.ty, "l")}</dd><dt>Автор</dt><dd>${av(e.who)}</dd>
      <dt>Добавлена</dt><dd>${dt(e.at)}</dd>
      <dt>Приватность</dt><dd><button class="fv" ${act("tgl-epriv", e.id)}>${e.priv ? "личная" : "общая"}</button></dd>
      <dt>Страны</dt><dd>${pickm(e.cc.length ? cc(e.cc) : `<span class="muted">—</span>`, COUNTRIES.map((c) => [`<span class="cc">${c.c}</span>${esc(c.n)}`, "tgl-ecc", e.id, c.c, e.cc.includes(c.c)]))}</dd>
      <dt>Индекс</dt><dd>${state(e.ix.n ? `${nFrag(e.ix.n)} · ${e.ix.at}` : "не индексируется", !!e.ix.n)}</dd></dl>
      ${lab("Кратко от ИИ")}<div class="note ai">${esc(aiSum(e))}</div>
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
    btn("Скачать файл", "download-file", f.id, undefined, "pri")
    + btn("Скопировать ссылку", "copy", undefined, `https://swarm-brain.pages.dev/drive/${f.id}/${f.n}`)
    + btn("Переиндексировать", "reindex-file", f.id) + btn("Заменить файл", "replace-file", f.id))
    + `<div class="d-body"><div class="prev"><span class="ft ft-${f.ty}">${f.ty}</span>Предпросмотр доступен после открытия</div>
      <dl class="f"><dt>Размер</dt><dd><span class="due">${fsz(f.kb)}</span></dd>
      <dt>Загрузил</dt><dd>${av(f.who)}</dd><dt>Когда</dt><dd>${dt(f.at)}</dd>
      <dt>Индекс</dt><dd>${state(f.ix, f.ix.includes("фрагмент") || f.ix === "переиндексирован")}</dd>
      <dt>Доступ</dt><dd>Воркспейс IMF BD</dd></dl>
      ${lab("Привязан к записи")}<div class="src" ${act("open-entry", f.rec)}>${esc(e.h || "—")}</div></div>`;
}

/* ── проект ──────────────────────────────────────────────────── */
function detailProject(p) {
  const subs = S.projects.filter((x) => x.parent === p.id);
  const tasks = projectTasks(p.id);
  const open = tasks.filter((t) => t.st !== "done").length;
  return dhead(`Проект · ${p.st === "paused" ? "пауза" : "идёт"}`, p.n,
    btn("Открыть задачи", "proj-tasks", p.id, undefined, "pri") + btn("Создать подпроект", "new-subproject", p.id) + btn(p.st === "paused" ? "Возобновить" : "Поставить на паузу", "toggle-proj", p.id))
    + `<div class="d-body"><dl class="f">
      <dt>Владелец</dt><dd>${av(p.own)}</dd>
      <dt>Срок</dt><dd>${due(p.due)}</dd>
      <dt>Задачи</dt><dd>${open} открыто из ${tasks.length}</dd>
      <dt>Подпроекты</dt><dd>${subs.length || "—"}</dd></dl>
      ${lab("Описание")}<div class="note">${esc(p.d)}</div>
      ${lab("Подпроекты")}${subs.length ? rows(subs.map((s) => { const st = S.tasks.filter((t) => t.pr === s.id && !t.arch);
        const so = st.filter((t) => t.st !== "done").length;
        /* «11 задач» не говорит, сколько из них живых — а решает именно это */
        return [esc(s.n), `${nTasks(st.length)} · ${so} открыто`, btn("Открыть", "open-proj", s.id, undefined, "sm")]; }))
        : rows([["—", "подпроектов нет", ""]])}
      ${lab("Последние задачи")}${rows(tasks.slice(0, 5).map((t) => [dot(t.st), `<span class="lnk" ${act("open-task", t.id)}>${esc(t.t)}</span>`, due(t.due, t.st === "done")]))}</div>`;
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
