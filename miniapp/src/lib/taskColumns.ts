// Раскладка колонок таблицы задач: ширины (тянутся мышью за границу в шапке) и порядок
// (колонка перетаскивается за середину шапки). Макет владельца 28.09.2026: «я взял в учёт, что
// колонки можно будет сдвигать», затем «давай сделаем перетаскивание». Здесь только чистые
// правила — дефолты, пределы, перестановка, разбор сохранённого и сборка grid-template; хранение
// и жесты живут в components/tasks/table/useColumnLayout.ts.
//
// «Задача» всегда первая и резиновая: minmax(ширина, 1fr) — забирает свободное место, а её ширина
// здесь — нижняя граница. Потянуть её вправо — строка станет шире окна и таблица прокрутится.
// Колонка значков (срок/пинг/повтор/люди/рынок быстрыми действиями) переезжает целиком.

export type MovableColumn = "due" | "actions" | "market" | "project" | "assignee" | "lists";
export type TaskColumn = "task" | MovableColumn;
export type ResizableColumn = "task" | "project" | "assignee" | "lists";
export type ColumnWidths = Record<ResizableColumn, number>;
export type ColumnLayout = { widths: ColumnWidths; order: MovableColumn[] };

export const RESIZABLE_COLUMNS: readonly ResizableColumn[] = ["task", "project", "assignee", "lists"];
export const DEFAULT_ORDER: readonly MovableColumn[] = ["due", "actions", "market", "project", "assignee", "lists"];
// На узкой десктопной раскладке (< 1100px) эти колонки прячутся.
export const NARROW_HIDDEN_COLUMNS: readonly MovableColumn[] = ["project", "lists"];

// Колонки без ручки ширины — их содержимое фиксировано по размеру.
const FIXED_WIDTHS: Record<Exclude<MovableColumn, ResizableColumn>, number> = { due: 88, actions: 168, market: 64 };

// «Проект» и «Списки» вдвое уже прежних процентов (18% и 14% от ~1400px): там длинное режется
// многоточием, а место уходит названию задачи.
export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = { task: 260, project: 128, assignee: 160, lists: 104 };

export const COLUMN_LIMITS: Record<ResizableColumn, { min: number; max: number }> = {
  task: { min: 200, max: 900 },
  project: { min: 72, max: 420 },
  assignee: { min: 90, max: 360 },
  lists: { min: 64, max: 360 },
};

export const defaultLayout = (): ColumnLayout => ({ widths: { ...DEFAULT_COLUMN_WIDTHS }, order: [...DEFAULT_ORDER] });

export function clampColumn(col: ResizableColumn, px: number): number {
  const { min, max } = COLUMN_LIMITS[col];
  return Math.round(Math.min(max, Math.max(min, px)));
}

const isMovable = (v: unknown): v is MovableColumn => typeof v === "string" && (DEFAULT_ORDER as readonly string[]).includes(v);

// Сохранённое приходит из localStorage — чужая, старая или битая форма молча даёт дефолт.
// Неизвестные колонки (удалённые в новой версии) выбрасываются, дубли схлопываются, а колонки,
// которых сохранённый порядок ещё не знал, встают в конец.
export function resolveColumnLayout(saved: unknown): ColumnLayout {
  const src = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const w = src.widths && typeof src.widths === "object" ? (src.widths as Record<string, unknown>) : {};
  const widths = { ...DEFAULT_COLUMN_WIDTHS };
  for (const col of RESIZABLE_COLUMNS) {
    const v = w[col];
    if (typeof v === "number" && Number.isFinite(v)) widths[col] = clampColumn(col, v);
  }
  const known = Array.isArray(src.order) ? [...new Set(src.order.filter(isMovable))] : [];
  const order = [...known, ...DEFAULT_ORDER.filter((c) => !known.includes(c))];
  return { widths, order };
}

// Колонку `col` ставим на место `target` (сдвигая остальные). Новый массив, исходный не трогаем.
export function moveColumn(order: readonly MovableColumn[], col: MovableColumn, target: MovableColumn): MovableColumn[] {
  const from = order.indexOf(col);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...order];
  const rest = order.filter((c) => c !== col);
  return [...rest.slice(0, to), col, ...rest.slice(to)];
}

export const isDefaultLayout = (l: ColumnLayout) =>
  RESIZABLE_COLUMNS.every((c) => l.widths[c] === DEFAULT_COLUMN_WIDTHS[c]) &&
  l.order.length === DEFAULT_ORDER.length && l.order.every((c, i) => c === DEFAULT_ORDER[i]);

const widthOf = (l: ColumnLayout, c: MovableColumn) =>
  c in FIXED_WIDTHS ? FIXED_WIDTHS[c as keyof typeof FIXED_WIDTHS] : l.widths[c as ResizableColumn];

// grid-template-columns под текущий порядок; `narrow` — без колонок, скрытых на узкой раскладке
// (скрытая ячейка display:none места в сетке не занимает).
export function gridTemplate(l: ColumnLayout, narrow: boolean): string {
  const cols = l.order.filter((c) => !(narrow && NARROW_HIDDEN_COLUMNS.includes(c)));
  return [`minmax(${l.widths.task}px,1fr)`, ...cols.map((c) => `${widthOf(l, c)}px`)].join(" ");
}

// Минимальная ширина строки = сумма колонок: при широкой «Задаче» таблица прокручивается вбок.
export function gridMinWidth(l: ColumnLayout, narrow: boolean): number {
  const cols = l.order.filter((c) => !(narrow && NARROW_HIDDEN_COLUMNS.includes(c)));
  return cols.reduce((sum, c) => sum + widthOf(l, c), l.widths.task);
}

// Ключ на человека: на общем компьютере у каждого своя раскладка.
export const columnLayoutKey = (userId: number | null | undefined) => `roy_task_columns_v1:${userId ?? "anon"}`;
