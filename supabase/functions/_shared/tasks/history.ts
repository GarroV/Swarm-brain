// Журнал изменений задачи — что, когда, кем и с чего на что (issue #286).
//
// Зачем чистой функцией. До 09.09.2026 история задач была фикцией: `task_history` писал только
// бот и только на перекате регулярной задачи — на проде в таблице лежали ДВЕ строки на две
// задачи, при том что задачи двигают каждый день. Веб, где карточки тащат мышью, не писал
// историю никогда. Поэтому вопрос руководства «где, когда, куда передвинули» ответа не имел
// вовсе, и восстановить прошлое нечем: архива не существует, данные копятся только вперёд.
//
// Здесь живёт РЕШЕНИЕ, какие строки журнала породит патч, — отдельно от записи в базу, чтобы
// его можно было проверить тестами: молчаливо не записанное изменение неотличимо от «его не
// было», а заметно это станет через месяц, когда отчёт окажется пустым.
//
// ⚠️ Отмечаем ВСЁ, кроме явного списка исключений — решение владельца 09.09.2026: «по сути надо
// уметь всё что угодно отмечать у задач, чтобы потом вытащить можно было». Поэтому здесь
// blacklist, а не whitelist: новое поле задачи попадает в журнал само, без правки этого файла.
// Обратное (список отслеживаемых) означало бы, что каждое новое поле молча не пишется, и это
// выяснялось бы уже на отчёте.

/** Служебное и шумное — в журнал НЕ идёт. */
const SKIPPED_FIELDS = new Set([
  "id",
  "group_id",
  "created_at",
  "updated_at",
  // Производное от статуса: дата закрытия ставится автоматом, отдельной строкой не нужна.
  "completed_at",
  // Дубль assignees в виде id — писали бы два события на одну смену исполнителя.
  "assignee_telegram_ids",
  // Координаты карточки в дереве и позиция на таймлайне: меняются каждым перетаскиванием мышью,
  // смысла для статистики не несут, а журнал забили бы полностью.
  "tree_x",
  "tree_y",
  "timeline_position",
  // Служебная отметка «напоминание отправлено» — пишет крон, а не человек.
  "reminded_at",
]);

/** Человекочитаемые имена для полей, у которых имя колонки не говорит само за себя. */
const FIELD_ALIASES: Record<string, string> = {
  assignees: "assignee",
  project_id: "project",
  sprint_id: "sprint",
  parent_id: "parent",
  label_ids: "labels",
};

/** Значения журнала — не хранилище текстов: длинные поля (описание) обрезаем. */
export const MAX_VALUE_LEN = 200;

export type TaskSnapshot = Record<string, unknown>;

export type HistoryRow = {
  task_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  /** Никогда не null: колонка `text NOT NULL`, см. actorName (issue #287). */
  changed_by: string;
  changed_by_telegram_id: number | null;
  group_id: string | null;
  /** Совместимость: у field='status' дублируем в старые колонки, их читают прежние запросы. */
  old_status: string | null;
  new_status: string | null;
  note: string | null;
};

/** Имя поля в журнале: алиас, если есть, иначе имя колонки как есть. */
export function journalFieldName(column: string): string {
  return FIELD_ALIASES[column] ?? column;
}

/** Идёт ли изменение этой колонки в журнал. */
export function isJournaled(column: string): boolean {
  return !SKIPPED_FIELDS.has(column);
}

/** Значение поля в текстовый вид журнала. Массив — «Аня, Вася», пустое — null, длинное обрезаем. */
export function historyValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s: string;
  if (Array.isArray(v)) {
    const parts = v.map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
    if (!parts.length) return null;
    s = parts.join(", ");
  } else if (typeof v === "object") {
    s = JSON.stringify(v);
  } else {
    s = String(v).trim();
  }
  if (!s.length) return null;
  return s.length > MAX_VALUE_LEN ? `${s.slice(0, MAX_VALUE_LEN - 1)}…` : s;
}

/**
 * Какие строки журнала породит этот патч. Пишем ТОЛЬКО реально изменившиеся поля: патч часто
 * несёт весь объект формы, и без сравнения журнал забился бы строками «было X, стало X», в
 * которых настоящее перемещение не найти.
 *
 * `patch` — то, что уходит в базу (после переката и прочих подстановок), `snapshot` — что было.
 */
/**
 * Кто изменил — для legacy-колонки `changed_by` (`text NOT NULL` с первой версии таблицы: её
 * писал бот именем пользователя). Веб и MCP имени не знают, они передают только telegram_id,
 * и `null` тут ронял вставку на NOT NULL — а `updateTask` глотал ошибку в `console.error`,
 * поэтому журнал молча не писался вовсе (issue #287, поймано на проде 09.09.2026: 4 смены
 * статуса после раскатки и ноль строк в журнале). Никогда не возвращает null.
 */
export function actorName(actor?: string | null, telegramId?: number | null): string {
  const name = actor?.trim();
  if (name) return name;
  if (telegramId != null) return String(telegramId);
  return "system";
}

export function historyRowsFor(args: {
  taskId: string;
  snapshot: TaskSnapshot | null;
  patch: Record<string, unknown>;
  actor?: string | null;
  actorTelegramId?: number | null;
  groupId?: string | null;
  note?: string | null;
}): HistoryRow[] {
  const { taskId, snapshot, patch } = args;
  if (!snapshot) return [];

  const rows: HistoryRow[] = [];
  for (const column of Object.keys(patch)) {
    if (!isJournaled(column)) continue;
    const before = historyValue(snapshot[column]);
    const after = historyValue(patch[column]);
    if (before === after) continue;
    const field = journalFieldName(column);
    rows.push({
      task_id: taskId,
      field,
      old_value: before,
      new_value: after,
      changed_by: actorName(args.actor, args.actorTelegramId),
      changed_by_telegram_id: args.actorTelegramId ?? null,
      group_id: args.groupId ?? null,
      old_status: field === "status" ? before : null,
      new_status: field === "status" ? after : null,
      note: args.note ?? null,
    });
  }
  return rows;
}
