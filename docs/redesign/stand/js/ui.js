/* Атомы разметки. Ни один экран не собирает HTML руками мимо этих функций. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]));
const act = (a, id, v) => `data-act="${a}"${id !== undefined ? ` data-id="${id}"` : ""}${v !== undefined ? ` data-v="${esc(v)}"` : ""}`;

const av = (id, withName) => { const u = user(id); if (!u) return `<span class="muted">— не назначен</span>`;
  return `<span class="av" style="background:${u.c}" title="${esc(u.n)}">${u.i}</span>${withName === false ? "" : `<span class="nm">${esc(u.n)}</span>`}`; };
const avs = (ids) => ids.length ? ids.map((i) => av(i, false)).join("") : `<span class="muted">—</span>`;
/* плотные таблицы: «Никола Й.» вместо обрезанного «Никола Йована…».
   Полное имя остаётся в подсказке, в панели детали и в «Команде». */
const avShort = (id) => { const u = user(id); if (!u) return `<span class="muted">— не назначен</span>`;
  const [f, l] = u.n.split(" ");
  return `<span class="av" style="background:${u.c}" title="${esc(u.n)}">${u.i}</span><span class="nm">${esc(l ? `${f} ${l[0]}.` : f)}</span>`; };
const dot = (st) => `<span class="dot d-${st}"></span>`;
const pri = (p) => `<span class="pdot p-${p}" title="приоритет: ${PRIO_LABEL[p]}"></span>`;
const due = (iso) => iso ? `<span class="due ${dueKind(iso)}">${fmtDate(iso)}</span>` : `<span class="muted">—</span>`;
const tag = (text, kind) => `<span class="tag tag-${kind || "o"}">${esc(text)}</span>`;
const lbls = (ids) => ids.map((id) => { const l = label(id); return l ? tag(l.n, "l") : ""; }).join("");
/* в списке рядом с точкой статуса вторая точка нечитаема: показываем только высокий приоритет */
const priMark = (p) => `<span class="pri-hi"${p === "high" ? ' title="высокий приоритет">!' : ">"}</span>`;
const cc = (codes) => codes.length ? codes.map((c) => `<span class="cc" title="${esc(cname(c))}">${c}</span>`).join("") : "";
const wsChip = () => {
  const cur = S.workspaces.find((w) => w.active) || S.workspaces[0];
  return `<span class="drop">${btn(`Воркспейс: ${cur.name}`, "noop", undefined, undefined, "sm")}
    <div class="dmenu">${S.workspaces.map((w) => `<button class="mi${w.active ? " on" : ""}" ${act("switch-ws", w.id)}>${esc(w.name)} · ${nPeople(w.users)}</button>`).join("")}
    <button class="mi" ${act("new-ws")}>＋ Новый воркспейс</button></div></span>`;
};
/* русские числительные: «1 задача», «2 задачи», «5 задач».
   Интерфейс двуязычный, и в EN подставится простая форма из второго аргумента. */
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  const word = a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  return `${n} ${word}`;
};
const nTasks = (n) => plural(n, "задача", "задачи", "задач");
const nFrag = (n) => plural(n, "фрагмент", "фрагмента", "фрагментов");
const nPeople = (n) => plural(n, "человек", "человека", "человек");
const nMeet = (n) => plural(n, "встреча", "встречи", "встреч");
const chip = (text, on, a, id, v) => `<button class="chip${on ? " on" : ""}" ${act(a, id, v)}>${esc(text)}</button>`;
const btn = (text, a, id, v, cls) => `<button class="btn${cls ? " " + cls : ""}" ${act(a, id, v)}>${esc(text)}</button>`;
const empty = (title, sub) => `<div class="empty"><b>${esc(title)}</b>${sub ? esc(sub) : ""}</div>`;
const lab = (t) => `<div class="lab">${esc(t)}</div>`;
const rows = (list) => `<div class="rowset">${list.map(([k, v, a]) =>
  `<div><span class="k">${k}</span><span class="v">${v}</span>${a ? `<span class="a">${a}</span>` : ""}</div>`).join("")}</div>`;
const state = (text, ok) => `<span class="state ${ok ? "on" : "off"}">${esc(text)}</span>`;
/* просрочка — не нейтральное состояние: серый значок её прячет */
const alert_ = (text) => `<span class="state bad">${esc(text)}</span>`;

/* c.opt — колонка второго ряда важности: в узком окне она уходит,
   вместо того чтобы сжимать всё до обрезанных заголовков и имён. */
function table(cols, body) {
  return `<div class="list"><table><thead><tr>${cols.map((c) =>
    `<th class="${c.r ? "r " : ""}${c.opt ? "opt" : ""}"${c.w ? ` style="width:${c.w}"` : ""}>${
      c.short ? `<span class="hfull">${esc(c.t)}</span><span class="hshort">${esc(c.short)}</span>` : esc(c.t)
    }</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}
const cell = (v, cls) => `<td${cls ? ` class="${cls}"` : ""}>${v}</td>`;

/* ── модалка ─────────────────────────────────────────────────── */
function modal(title, body, foot, wide) {
  $(".mscrim").classList.add("open");
  const m = $(".modal");
  m.classList.add("open"); m.classList.toggle("wide", !!wide);
  m.innerHTML = `<header><h3>${esc(title)}</h3><button class="btn" ${act("mclose")}>✕</button></header>
    <div class="mbody">${body}</div><footer>${foot}</footer>`;
}
function closeModal() { $(".mscrim").classList.remove("open"); const m = $(".modal"); m.classList.remove("open", "wide"); }
const fld = (label_, inner) => `<div class="fld"><label>${esc(label_)}</label>${inner}</div>`;
const input = (name, value, ph, type) => `<input data-f="${name}"${type ? ` type="${type}"` : ""} value="${esc(value || "")}" placeholder="${esc(ph || "")}">`;
const dateInput = (name, value) => input(name, value, "", "date");
const area = (name, value, ph) => `<textarea data-f="${name}" placeholder="${esc(ph || "")}">${esc(value || "")}</textarea>`;
const select = (name, opts, sel) => `<select data-f="${name}">${opts.map(([v, t]) =>
  `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
const pick = (name, opts, selected) => `<div class="pick" data-pick="${name}">${opts.map(([v, t]) =>
  `<span class="chip${selected.includes(v) ? " on" : ""}" data-v="${esc(v)}">${esc(t)}</span>`).join("")}</div>`;
const sw = (name, on, text) => `<div class="sw${on ? " on" : ""}" data-sw="${name}"><i></i>${esc(text)}</div>`;
const formData = () => {
  const o = {};
  $$(".modal [data-f]").forEach((e) => { o[e.dataset.f] = e.type === "checkbox" ? e.checked : e.value; });
  $$(".modal [data-pick]").forEach((p) => { o[p.dataset.pick] = [...p.querySelectorAll(".chip.on")].map((c) => c.dataset.v); });
  $$(".modal [data-sw]").forEach((s) => { o[s.dataset.sw] = s.classList.contains("on"); });
  return o;
};
