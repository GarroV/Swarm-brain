// Раскладка главной из виджетов (docs/decisions/2026-10-07-home-dashboard-direction.md).
// Каждый человек собирает главную сам: порядок, ширина (½ строки или вся), скрытые и
// добавленные из каталога. Здесь только чистые функции над раскладкой; хранение —
// loadLayout/saveLayout (пока localStorage устройства, в продукте — профиль пользователя).

export const WIDGET_IDS = [
  "calls", "top5", "board", "ratings", "pz", "countries", "viol",
  "sales", "insp", "myTasks", "teamTasks", "news", "latest",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export type WidgetWidth = "half" | "full";
export type LayoutItem = { id: WidgetId; w: WidgetWidth };

export const DEFAULT_WIDTH: Record<WidgetId, WidgetWidth> = {
  calls: "half", top5: "half", board: "full", ratings: "half", pz: "half",
  countries: "full", viol: "half", sales: "half", insp: "half",
  myTasks: "full", teamTasks: "half", news: "half", latest: "half",
};

// Доска — первой (владелец 08.10.2026: «доску давай выше сделаем»). Под ней две колонки: слева
// «Рейтинги» (вкладки РС · РКО · Карты · Агрегаторы вместо прежних отдельных РС и РКО, 19.10.2026),
// справа встречи, под ними задачи. Половинки идут парами «левая, правая» — см. layoutRows.
// «Топ-5 нарушений» — образец без источника: в каталоге есть, по умолчанию на главную не ставим.
const DEFAULT_ORDER: WidgetId[] = ["board", "ratings", "calls", "top5", "pz", "countries"];
export const DEFAULT_LAYOUT: LayoutItem[] = DEFAULT_ORDER.map((id) => ({ id, w: DEFAULT_WIDTH[id] }));

export type LayoutCell = { item: LayoutItem; index: number };
/** Строка главной: одна клетка — на всю ширину, две — пара половинок. */
export type LayoutRow = LayoutCell[];

/** Разбить раскладку на строки (docs/decisions/2026-10-23-home-fixed-blocks.md): виджет «вся строка» —
 *  строка сам по себе; половинки идут парами по порядку раскладки (левая, правая) и в паре равны по
 *  высоте. Половинка без пары — последняя в прогоне перед «целым» виджетом или в конце — занимает всю
 *  строку, дыры рядом не остаётся. `index` — место в раскладке (для ↑↓ и порядка на узком экране). */
export function layoutRows(layout: LayoutItem[]): LayoutRow[] {
  const rows: LayoutRow[] = [];
  let open: LayoutCell[] | null = null;
  layout.forEach((item, index) => {
    if (item.w === "full") { open = null; rows.push([{ item, index }]); return; }
    if (open) { open.push({ item, index }); open = null; return; }
    open = [{ item, index }];
    rows.push(open);
  });
  return rows;
}

const isWidgetId = (v: unknown): v is WidgetId => typeof v === "string" && (WIDGET_IDS as readonly string[]).includes(v);

// Виджеты, слитые в один (19.10.2026): отдельные «РС» и «РКО» стали вкладками «Рейтингов».
const LEGACY_IDS: Record<string, WidgetId> = { rs: "ratings", rko: "ratings" };

/** Старые id в сохранённой раскладке → нынешние. Дубль, возникший от слияния, потом отбросит
 *  parseLayout: остаётся первый, то есть «Рейтинги» встают на место первого из РС/РКО. */
export function migrateLayoutIds(raw: unknown[]): unknown[] {
  return raw.map((it) => {
    const id = (it as { id?: unknown })?.id;
    const next = typeof id === "string" ? LEGACY_IDS[id] : undefined;
    return next ? { ...(it as object), id: next } : it;
  });
}

/** Разбор сохранённой раскладки. Прежние id мигрируют, неизвестные виджеты и дубли отбрасываются; мусор — null. */
export function parseLayout(raw: unknown): LayoutItem[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<WidgetId>();
  const out: LayoutItem[] = [];
  for (const it of migrateLayoutIds(raw)) {
    const id = (it as { id?: unknown })?.id;
    const w = (it as { w?: unknown })?.w;
    if (!isWidgetId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, w: w === "full" || w === "half" ? w : DEFAULT_WIDTH[id] });
  }
  return out;
}

/** Переставить виджет `id` на место виджета `beforeId` (перетаскивание). */
export function moveBefore(layout: LayoutItem[], id: WidgetId, beforeId: WidgetId): LayoutItem[] {
  if (id === beforeId) return layout;
  const item = layout.find((x) => x.id === id);
  if (!item) return layout;
  const rest = layout.filter((x) => x.id !== id);
  const at = rest.findIndex((x) => x.id === beforeId);
  if (at < 0) return layout;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** Сдвинуть на шаг вверх (-1) или вниз (+1) — для клавиатуры и телефона, где нет перетаскивания. */
export function moveBy(layout: LayoutItem[], id: WidgetId, step: -1 | 1): LayoutItem[] {
  const i = layout.findIndex((x) => x.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const next = [...layout];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function toggleWidth(layout: LayoutItem[], id: WidgetId): LayoutItem[] {
  return layout.map((x) => (x.id === id ? { ...x, w: x.w === "full" ? "half" : "full" } : x));
}

export function hideWidget(layout: LayoutItem[], id: WidgetId): LayoutItem[] {
  return layout.filter((x) => x.id !== id);
}

export function addWidget(layout: LayoutItem[], id: WidgetId): LayoutItem[] {
  if (layout.some((x) => x.id === id)) return layout;
  return [...layout, { id, w: DEFAULT_WIDTH[id] }];
}

// v3 — колонки РКО/РС и встречи/задачи (13.10.2026); v2 — подъём доски наверх. Сохранённая прежняя
// версия держала бы старый порядок, и смена умолчания не была бы видна.
const LS_KEY = "roy_home_layout_v3";

export function loadLayout(): LayoutItem[] {
  try {
    const parsed = parseLayout(JSON.parse(localStorage.getItem(LS_KEY) ?? "null"));
    if (parsed) return parsed;
  } catch { /* приватное окно или битое значение — раскладка по умолчанию */ }
  return DEFAULT_LAYOUT;
}

export function saveLayout(layout: LayoutItem[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(layout)); } catch { /* хранилище недоступно — раскладка живёт до перезагрузки */ }
}
