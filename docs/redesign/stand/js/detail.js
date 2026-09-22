/* Правая панель. Всё, что в ней нажимается, меняет состояние — заглушек нет. */

function dtabs(items, cur) {
  const on = cur || S.dtab;
  return `<div class="dtabs">${items.map(([id, n, k]) =>
    `<button class="dtab${on === id ? " on" : ""}" ${act("dtab", id)}>${esc(n)}${k ? `<span class="c">${k}</span>` : ""}</button>`).join("")}</div>`;
}
/* Кнопка переименования стоит У НАЗВАНИЯ, а не в общем ряду значков: значок «Aa»
   среди кнопок про генерацию не говорит, ЧТО он переименует (просьба владельца 21.09). */
const dhead = (crumb, title, acts, titleBtn) =>
  `<div class="d-head"><div class="d-crumb">${esc(crumb)}</div>
   <div class="d-title">${esc(title)}${titleBtn || ""}</div>
   <span class="d-close">${btn("✕", "close", undefined, undefined, "sm")}</span>
   <div class="d-acts">${acts}</div></div>`;

/* ── задача ──────────────────────────────────────────────────── */
/* Свойства задачи — сетка чипов, а не столбик полей: подписи и значения выровнены
   по колонкам, значение нажимается, варианты приходят меню. Столбик из девяти строк
   владелец назвал деревом настроек — и был прав: он читался как форма, а не как задача. */
function taskProps(t) {
  const users = [["— не назначен", "set-who", t.id, "", !t.who.length],
    ...S.users.map((u) => [`${av(u.id, false)}${esc(u.n)}`, "set-who", t.id, String(u.id), t.who[0] === u.id])];
  /* Главные свойства — те, без которых задача не задача: кто, в каком состоянии,
     к какому сроку и в каком проекте. Они стоят всегда. */
  /* Статуса в панели НЕТ: он меняется кнопкой «Готово» в шапке, как в проде, и чип
     дублировал её третьим способом сделать одно и то же (владелец, 22.09.2026 —
     «статус надо скрыть, как в проде»).
     Ряд 1 — «кто и по какому фронту»: исполнитель, рынок, роль стоят рядом, потому что
     читаются вместе («исполнитель, рынок, роль явно можно поставить рядом»).
     Ряд 2 — «кому видно и к какому дню»: приватность строго под исполнителем, как
     просил владелец, рядом с ней срок. Срок больше не wide: поле на всю ширину панели
     под одну дату — самая широкая кнопка экрана ни за что. */
  const mk = pchip("Рынок", t.mk ? `<span class="cc">${t.mk}</span>${esc(cname(t.mk))}` : `<span class="muted">не указан</span>`,
    [["— без рынка", "set-mk", t.id, "", !t.mk], ...COUNTRIES.map((c) => [`<span class="cc">${c.c}</span>${esc(c.n)}`, "set-mk", t.id, c.c, t.mk === c.c])]);
  const role = pchip("Роль", t.role ? esc(roleName(t.role)) : `<span class="muted">без роли</span>`,
    [["— без роли", "set-role", t.id, "", !t.role], ...S.roles.map((r) => [esc(r.n), "set-role", t.id, r.id, t.role === r.id])]);
  const main = `<div class="props">
    ${pchip("Исполнитель", t.who.length ? `${av(t.who[0], false)}${esc(user(t.who[0]).n)}` : `<span class="muted">не назначен</span>`, users)}
    ${mk}${role}
  </div>
  <div class="props">
    ${pchip("Приватность", t.priv ? "личная" : "общая",
      [["общая", "set-priv", t.id, "", !t.priv], ["личная", "set-priv", t.id, "1", t.priv]])}
    <span class="pchip"><span class="k">Срок</span><span class="v">
      <input type="date" class="dv" value="${t.due || ""}" ${act("set-due", t.id)}>${t.due && dueKind(t.due) === "now" ? '<span class="over">просрочено</span>' : ""}</span></span>
  </div>
  <div class="props">${pflat("Проект", esc(projPath(t.pr)), "wide")}</div>`;
  /* Остальное — по одному чипу, и ПУСТОЕ по умолчанию спрятано: поле «Рынок: не указан»
     занимает строку и ничего не сообщает, а панель из-за таких строк читалась как анкета.
     «Все поля» достаёт спрятанное, не открывая форму. */
  const opt = [
    [t.priv || t.labels.length, pchip("Списки", lbls(t.labels),
      [["— личные списки: задача станет личной", "noop"],
        ...S.labels.map((l) => [esc(l.n), "tgl-label", t.id, l.id, t.labels.includes(l.id)])], "wide")],
    [!!t.ping, `<span class="pchip wide"><span class="k">Напомнить</span><span class="v">
      <input type="date" class="dv" value="${t.ping || ""}" ${act("set-ping", t.id)}>${
      t.ping && t.pinged ? '<span class="over" title="пинг одноразовый: выберите новый день, чтобы напомнить снова">уже напомнили</span>' : ""}${
      t.ping ? btn("убрать", "drop-ping", t.id, undefined, "sm") : ""}</span></span>`],
    [!!t.recur, pchip("Повтор", t.recur ? RECUR_LABEL[t.recur] : `<span class="muted">нет</span>`,
      ["", "weekly", "monthly"].map((r) => [r ? RECUR_LABEL[r] : "нет", "set-recur", t.id, r, (t.recur || "") === r]))],
    /* Рынок и роль переехали в главный ряд — они читаются вместе с исполнителем.
       Приватность переехала под исполнителя: «кто это увидит» — не редкое поле.
       Приоритета в панели нет: такого поля у продукта нет (владелец, 22.09.2026 —
       «приоритет выбрасываем, нет такого у нас»). */
  ];
  const hidden = opt.filter(([on]) => !on).length;
  const shown = opt.filter(([on]) => on || S.allProps).map(([, html]) => html).join("");
  const more = S.allProps
    ? btn("Только заполненные", "tgl", "allProps", undefined, "sm on")
    : (hidden ? btn(`Все поля · ещё ${hidden}`, "tgl", "allProps", undefined, "sm") : "");
  return main + `<div class="props opt">${shown}${more}</div>`;
}

/* Ссылки — отдельное поле задачи, как в продукте: они переживают правку описания, и по
   ним видно, куда идти, не читая текст. Добавляются и снимаются прямо в панели. */
function taskUrls(t) {
  const urls = t.urls || [];
  return lab(`Ссылки · ${urls.length}`)
    + `<div class="ulist">${urls.map((u, i) => `<div class="urow">
        <a class="lnk" href="${esc(u)}" target="_blank" rel="noreferrer">${esc(u)}</a>
        ${ibtn("×", "Убрать ссылку", "drop-url", t.id, String(i))}</div>`).join("")
      || '<div class="muted">Ссылок пока нет</div>'}</div>
      <div class="uadd"><input data-uin="${t.id}" placeholder="https://…">${btn("Добавить", "add-url", t.id, undefined, "sm")}</div>`;
}

/* Комментарии живут на основном окне задачи, внизу под остальным: во вкладке их не
   видно, пока не вспомнишь туда зайти, — а разговор по задаче и есть её половина. */
function taskTalk(t) {
  const cm = S.comments[t.id] || [];
  return lab(`Комментарии · ${cm.length}`)
    + `<div class="cms">${cm.map((c) => `<div class="cm">${av(c.who, false)}<div class="b"><div class="w"><b>${esc(user(c.who).n)}</b> · ${esc(c.w)}</div>${esc(c.t)}</div></div>`).join("")
      || '<div class="muted">Комментариев пока нет</div>'}</div>
      <div class="cbox"><textarea data-cin="${t.id}" placeholder="Написать комментарий"></textarea>${btn("Отправить", "comment", t.id, undefined, "pri sm")}</div>`;
}

function detailTask(t) {
  const cm = S.comments[t.id] || [], hi = [...(S.history[t.id] || [])].sort((a, b) => a.m - b.m);
  /* вкладка «Комментарии» снята — разговор переехал в тело обзора; на старом значении
     состояния панель иначе показала бы пустоту */
  const tab = S.dtab === "talk" ? "overview" : S.dtab;
  const acts = t.arch
    ? btn("Вернуть из архива", "restore", t.id, undefined, "pri") + btn("Удалить навсегда", "del-task", t.id)
    : (t.st !== "in_progress" ? btn("Взять в работу", "take", t.id, undefined, "pri") : btn("Готово", "move", t.id, "done", "pri"))
      + btn("Архивировать", "archive", t.id);
  let body = "";
  if (tab === "overview") {
    body = taskProps(t)
      + (t.src && t.src !== "manual" ? lab("Откуда задача") + `<div class="src" ${act("open-meet", t.src)}>${esc((S.meetings.find((m) => m.id === t.src) || {}).t || t.src)}</div>` : "")
      + taskUrls(t)
      + lab("Описание") + `<div class="note lg">${t.note ? esc(t.note) : '<span class="muted">описания нет</span>'}</div>`
      + taskTalk(t);
  }
  if (tab === "hist") {
    body = `<div class="tl">${hi.map((h) => `<div class="e"><div class="p"></div><div><b>${esc(user(h.who).n)}</b>
      <span class="ev">${esc(h.k)}${h.v ? `: <b>${esc(h.v)}</b>` : ""}</span><div class="w">${esc(ago(h.m))}</div></div></div>`).join("")
      || '<div class="muted">Движения не было</div>'}</div>`;
  }
  if (tab === "links") {
    body = rows(t.links.length ? t.links.map(([kind, id], i) => {
      const o = S.tasks.find((x) => x.id === id);
      return [esc(kind), `<span class="lnk" ${act("open-task", id)}>${esc(o ? o.t : id)}</span>`,
        `<button class="btn sm" ${act("drop-link", t.id, String(i))}>Снять</button>`];
    }) : [["—", "связей нет", ""]]) + `<div class="mt">${btn("Добавить связь", "add-link", t.id)}</div>`;
  }
  if (tab === "subs") {
    body = rows(S.users.slice(0, 8).map((u) => [av(u.id), t.subs.includes(u.id) ? "получает уведомления" : "не подписан",
      `<button class="btn sm" ${act("tgl-sub", t.id, u.id)}>${t.subs.includes(u.id) ? "Отписать" : "Подписать"}</button>`]));
  }
  return dhead(`${projPath(t.pr)} · Задача ${t.id}`, t.t, acts)
    + `<div class="d-body">${dtabs([["overview", "Обзор", cm.length], ["hist", "История", hi.length], ["links", "Связи", t.links.length], ["subs", "Подписчики", t.subs.length]])}${body}</div>`;
}

/* ── встреча ─────────────────────────────────────────────────── */
/* Тезисы хранятся оформленным текстом: владелец правит их с жирностью, списками и
   ссылками, и это же оформление уезжает в буфер обмена. Пока правки не было, текст
   собирается из разобранных моделью секций. */
function tezHtml(m) {
  if (m.tezHtml) return m.tezHtml;
  return m.tez.map((sec) => `<h5>${esc(sec.h)}</h5><ul>${sec.li.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("");
}

function detailMeeting(m) {
  const tasks = S.tasks.filter((t) => m.tasks.includes(t.id));
  const isReview = m.st === "pending";
  const nTez = m.tez.reduce((n, sec) => n + sec.li.length, 0);
  /* Транскрипт нужен на вычитке — там его сверяют с тезисами. У разобранной встречи он
     лежит в базе отдельной записью, и вторая копия вкладкой только занимает место. */
  const trEntry = S.entries.find((e) => e.meet === m.id && e.ty === "transcript");
  /* Главное окно встречи — ГОТОВЫЕ ТЕЗИСЫ: ради разобранного текста встречу и
     открывают (просьба владельца 21.09). Транскрипт стоит отдельной вкладкой и у
     подтверждённой встречи тоже: сверять его приходится и после вычитки. */
  /* Порядок: карточка встречи — тезисы — задачи — транскрипт (просьба владельца 21.09).
     Открывается встреча всё равно на тезисах: ради них сюда и приходят. Вкладка «Задачи»
     стоит всегда, но задачи НЕ генерируются сами — только по кнопке внутри неё. */
  const items = [["overview", "О встрече"], ["tez", "Тезисы", nTez],
    ["gen", "Задачи", S.genFor === m.id ? S.gen.length : tasks.length], ["tr", "Транскрипт", m.tr.length]];
  const cur = items.some(([id]) => id === S.dtab) ? S.dtab : "tez";
  /* Управление встречей: словами — три действия, ради которых сюда приходят; редкое —
     значками с подписью (просьба владельца 21.09). Семь одинаковых кнопок в два ряда
     не давали понять, что здесь главное. */
  const storeName = m.store === "shared" ? "общая" : "личная";
  const baseMenu = fmenu([
    ["в общую базу — видит команда", "add-base", m.id, "shared", m.st === "confirmed" && m.store === "shared"],
    ["в личное хранилище — только я", "add-base", m.id, "personal", m.st === "confirmed" && m.store === "personal"]]);
  const acts = (m.st === "draft"
      /* у черновика тезисов ещё нет: добавлять в базу нечего, сперва разбор */
      ? btn("Составить тезисы", "publish-draft", m.id, undefined, "pri")
      : `<span class="drop">${btn(m.st === "confirmed" ? `В базе · ${storeName}` : "Добавить в базу",
          "noop", undefined, undefined, m.st === "confirmed" ? "" : "pri")}${baseMenu}</span>`)
    + btn("Сгенерировать задачи", "gen-tasks", m.id)
    /* пересборка тезисов спрашивает ЧТО поменять: кнопка без выбора возвращала тот же
       текст, и человек жал её второй раз */
    + (m.st !== "draft" ? `<span class="drop">${btn("Сгенерировать тезисы заново", "noop", undefined, undefined, "")}
      ${fmenu([["короче", "regen", m.id, "short"], ["подробнее", "regen", m.id, "long"],
        ["акцент на решениях", "regen", m.id, "decisions"], ["просто пересобрать", "regen", m.id, "plain"],
        ["своё пожелание…", "regen-own", m.id]])}</span>` : "")
    + (isReview ? btn("Сравнить с транскриптом", "compare", m.id) : "")
    /* удаление стоит в том же ряду, что и остальные действия над встречей, но с краю:
       отдельная полка значков заставляла гадать, к чему они относятся */
    + `<span class="iacts">${ibtn("🗑", "Удалить встречу", "del-meet", m.id)}</span>`;
  let body = "";
  if (cur === "overview") {
    /* Телеметрия рекордера (устройство, claim/lease, отложенная загрузка) убрана:
       человеку она ничего не говорит — «нахуя? обычному пользователю не надо»
       (владелец 21.09). Остаётся то, что меняет доверие к записи, и только когда
       что-то пошло не так: молчать об этом нельзя, иначе он поверит неполной записи. */
    const flaws = m.claim ? [
      m.claim.other ? "" : "Записан только ваш микрофон — собеседника в записи нет, тезисы могут быть неполными.",
      m.claim.defer ? `Запись ждала сети ${m.claim.defer} мин — в базу она приехала позже встречи.` : "",
    ].filter(Boolean) : [];
    body = flaws.map((x) => `<div class="warn">${esc(x)}</div>`).join("")
      + (m.st === "draft" ? `<div class="warn">Черновик рекордера: тезисов ещё нет, в базу не попал.</div>` : "")
      + `<dl class="f"><dt>Участники</dt><dd>${m.who.map((i) => esc(user(i).n)).join(", ")}</dd>
        <dt>Когда</dt><dd><span class="due">${esc(fmtDT(m.dt))}</span></dd>
        <dt>Длительность</dt><dd><span class="due">${m.dur}</span><span class="unit">мин</span></dd>
        <dt>Источник</dt><dd>${tag(m.src, "m")}</dd>
        <dt>Хранилище</dt><dd>${state(m.store === "shared" ? "общая база" : "личное хранилище", m.store === "shared")}
          <span class="unit">меняется кнопкой «${m.st === "confirmed" ? "В базе" : "Добавить в базу"}»</span></dd>
        <dt>Страны</dt><dd>${pickm(m.cc.length ? cc(m.cc) : `<span class="muted">—</span>`, COUNTRIES.map((c) => [`<span class="cc">${c.c}</span>${esc(c.n)}`, "tgl-mcc", m.id, c.c, m.cc.includes(c.c)]))}</dd>
        <dt>Статус</dt><dd>${state(MEET_ST[m.st], m.st === "confirmed")}</dd></dl>

        ${m.notes.length ? lab(`Пометки на полях · ${m.notes.length}`)
          + `<div class="mnotes">${m.notes.map((n) => `<div class="mn">${av(n.who, false)}<div class="b">
            <div class="w"><b>${esc(user(n.who).n)}</b> · ${esc(n.at)}</div>${esc(n.t)}</div></div>`).join("")}</div>` : ""}
        ${!isReview && trEntry ? lab("Транскрипт") + `<div class="src" ${act("open-entry", trEntry.id)}>${esc(trEntry.h)}</div>` : ""}`;
  }
  if (cur === "tez") {
    /* Править и копировать тезисы можно ТАМ, ГДЕ ОНИ ЛЕЖАТ (просьба владельца 21.09):
       значок в общей полке наверху не говорил, что именно он правит. Правка идёт в этом
       же окне, а не в выпрыгивающей форме — текст остаётся на месте, где его читали. */
    const editing = S.tezEdit === m.id;
    body = m.st === "draft"
      ? `<div class="empty sm"><b>Тезисов ещё нет</b>Черновик не разобран моделью${btn("Составить тезисы", "publish-draft", m.id, undefined, "pri mt")}</div>`
      : editing
        ? `<div class="tezbar">${[["b", "Ж", "Жирный"], ["i", "К", "Курсив"], ["u", "Ч", "Подчёркнутый"],
            ["s", "З", "Зачёркнутый"], ["ul", "•", "Список"], ["a", "⛓", "Ссылка"], ["x", "✕", "Снять оформление"]]
            .map(([k, g, t]) => `<button class="fb" title="${esc(t)}" ${act("fmt", m.id, k)}>${g}</button>`).join("")}
          <span class="right">${btn("Отмена", "tez-cancel", m.id, undefined, "sm")}${btn("Сохранить", "tez-save", m.id, undefined, "sm pri")}</span></div>
          <div class="tez edit" contenteditable="true" data-tezbox="${m.id}">${tezHtml(m)}</div>
          <div class="hint">Оформление сохранится и в тексте, и при копировании.
            Ручная правка отключает авто-перезапись тезисов моделью.</div>`
        : `<div class="tezacts">${btn("✎ Править", "tez-edit", m.id, undefined, "sm")}
            ${btn("⧉ Копировать", "copy-tez", m.id, undefined, "sm")}
            ${m.edited ? state("правлено вручную", false) : ""}</div>
          <div class="tez">${tezHtml(m)}</div>`;
  }
  if (cur === "gen" && S.genFor !== m.id) {
    /* Задачи по встрече генерируются ТОЛЬКО по кнопке (владелец 21.09): модель не должна
       предлагать их сама при каждом открытии — это и деньги, и мусор в списке. */
    body = (tasks.length
      ? lab(`Задачи из встречи · ${tasks.length}`) + rows(tasks.map((t) => [String(t.id),
          `<span class="lnk" ${act("open-task", t.id)}>${esc(t.t)}</span>`, state(ST_LABEL[t.st], t.st === "done")]))
      : `<div class="empty sm"><b>Задач из встречи ещё нет</b>Модель разберёт тезисы на задачи, когда вы нажмёте кнопку</div>`)
      + `<div class="mt">${btn("Сгенерировать задачи", "gen-tasks", m.id, undefined, "pri")}</div>`;
  }
  if (cur === "gen" && S.genFor === m.id) {
    /* «Сгенерировать задачи» переключает ЭТО ЖЕ окно на список предложенного, а не
       выбрасывает окно поверх встречи: человек остаётся там, где читал тезисы. */
    const made = S.gen.filter((g) => g.made).length;
    body = `<div class="hint">Модель предложила задачи по тезисам. Нажмите на задачу — откроется обычная форма:
      там правится текст, проект и исполнитель и прикладываются ссылки.</div>
      <div class="glist">${S.gen.map((g) => `<div class="grow${g.made ? " made" : ""}">
        <button class="gt" ${act("gen-open", String(g.i))}>${esc(g.t)}</button>
        <span class="gm">${g.who ? av(g.who) : ""}${g.due ? `<span class="due">${fmtDate(g.due)}</span>` : ""}</span>
        ${g.made ? `<span class="lnk" ${act("open-task", g.made)}>задача ${g.made}</span>`
          : btn("Оформить", "gen-open", String(g.i), undefined, "sm")}</div>`).join("")}</div>
      <div class="mt">${btn(`Создать все · ${S.gen.length - made}`, "gen-all", m.id, undefined, "pri", made === S.gen.length)}
        ${btn("Закрыть список", "gen-close", m.id)}</div>`;
  }
  if (cur === "tr") {
    body = `<div class="tr">${m.tr.map(([w, who, text]) =>
      `<div class="ln"><span class="w">${w}</span>${av(who, false)}<span>${esc(text)}</span></div>`).join("")}</div>`;
  }
  return dhead(`${m.src} · ${fmtDT(m.dt)}`, m.t, acts, ibtn("✎", "Переименовать встречу", "rename-meet", m.id))
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

/* Инструкция по интеграции: что она даёт, что нажать по шагам и чем придётся
   заплатить (ключ в открытом виде, доступ по токену). Без последнего пункта человек
   узнаёт про цену после подключения. */
function detailIntegr(i) {
  const on = i.st === "on";
  return dhead(i.soon ? "Интеграция · в разработке" : `Интеграция · ${on ? "подключена" : "выключена"}`, i.n,
    (i.soon ? btn("Подключить", "integr", i.id, undefined, "dis")
      : btn(on ? "Отключить" : "Подключить", "integr", i.id, undefined, on ? "" : "pri"))
    + (i.id === "granola" && on ? btn("Импорт заметок", "granola-import") : ""))
    + `<div class="d-body">
      ${i.soon ? `<div class="soon">Пункт в разработке: экран показывает, как это будет устроено.
        Подключить пока нечего — кнопка не работает.</div>` : ""}
      ${lab("Зачем это")}<div class="note">${esc(i.what)}</div>
      ${lab("Как подключить")}<ol class="steps">${i.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      ${lab("Что важно знать")}<div class="note">${esc(i.note)}</div>
      ${lab("Состояние")}<dl class="f"><dt>Сейчас</dt><dd>${i.soon ? state("в разработке", false) : state(on ? "подключено" : "выключено", on)}</dd>
        <dt>Подробности</dt><dd>${esc(i.d)}</dd></dl></div>`;
}

function renderDetail() {
  const app = $(".app"), d = $(".detail");
  const map = {
    task: () => { const t = S.tasks.find((x) => x.id === S.sel); return t && detailTask(t); },
    meeting: () => { const m = S.meetings.find((x) => x.id === S.sel); return m && detailMeeting(m); },
    entry: () => { const e = S.entries.find((x) => x.id === S.sel); return e && detailEntry(e); },
    file: () => { const f = S.files.find((x) => x.id === S.sel); return f && detailFile(f); },
    project: () => { const p = proj(S.sel); return p && detailProject(p); },
    integr: () => { const i = S.integrations.find((x) => x.id === S.sel); return i && detailIntegr(i); },
  };
  const html = S.selKind && map[S.selKind] ? map[S.selKind]() : null;
  if (!html) { app.classList.remove("with-detail"); d.innerHTML = ""; return; }
  app.classList.add("with-detail"); d.innerHTML = html;
}
