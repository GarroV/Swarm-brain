// Раскладка главной из виджетов (docs/decisions/2026-10-07-home-dashboard-direction.md).
// Каждый человек собирает главную сам: порядок, ширина (½ строки или вся), скрытые и
// добавленные из каталога. Здесь только чистые функции над раскладкой; хранение —
// loadLayout/saveLayout (пока localStorage устройства, в продукте — профиль пользователя).

export const WIDGET_IDS = [
  "calls", "top5", "board", "rs", "rko", "pz", "att", "countries", "viol",
  "sales", "maps", "myTasks", "teamTasks", "news", "latest",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export type WidgetWidth = "half" | "full";
export type LayoutItem = { id: WidgetId; w: WidgetWidth };

export const DEFAULT_WIDTH: Record<WidgetId, WidgetWidth> = {
  calls: "half", top5: "half", board: "full", rs: "half", rko: "half", pz: "full",
  att: "half", countries: "half", viol: "half", sales: "half", maps: "half",
  myTasks: "full", teamTasks: "half", news: "half", latest: "half",
};

// Доска — первой (владелец 08.10.2026: «доску давай выше сделаем»).
const DEFAULT_ORDER: WidgetId[] = ["board", "calls", "top5", "rs", "rko", "pz", "att", "countries", "viol", "maps"];
export const DEFAULT_LAYOUT: LayoutItem[] = DEFAULT_ORDER.map((id) => ({ id, w: DEFAULT_WIDTH[id] }));

const isWidgetId = (v: unknown): v is WidgetId => typeof v === "string" && (WIDGET_IDS as readonly string[]).includes(v);

/** Разбор сохранённой раскладки. Неизвестные виджеты и дубли отбрасываются; мусор — null. */
export function parseLayout(raw: unknown): LayoutItem[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<WidgetId>();
  const out: LayoutItem[] = [];
  for (const it of raw) {
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

// v2 — с подъёмом доски наверх: сохранённая v1 держала бы старый порядок, и смена умолчания не была бы видна.
const LS_KEY = "roy_home_layout_v2";

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
