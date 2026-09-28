// Журнал изменений проекта — что, когда, кем и с чего на что (issue #426).
//
// Владелец 21.09.2026: «у проекта надо добавить функционал переноса в другое пространство +
// логирование всего что происходит». Второе — не украшение к первому: когда раздел «Проекты»
// опустел, восстанавливать раскладку пришлось по косвенному следу (`created_by`), потому что о
// переездах проектов между пространствами не сохранилось ни строки.
//
// Как и у задач, РЕШЕНИЕ «какие строки породит патч» живёт отдельно от записи в базу, чтобы его
// можно было проверить тестами: молчаливо не записанное изменение неотличимо от «его не было»,
// и выясняется это через месяц, на пустом отчёте.
//
// Сравнение полей общее с журналом задач (`diffFields` в history.ts) — намеренно: правило «это
// поле не пишем» должно править одно место, а не два.
import { actorName, diffFields, historyValue } from "./history.ts";

/** Служебное — в журнал НЕ идёт. */
const SKIPPED_COLUMNS = new Set([
  "id",
  "group_id",
  "created_at",
  "created_by",
  // Архивация и возврат пишутся СОБЫТИЕМ (`archived`/`restored`): человеку нужна строка
  // «убран в архив», а не «archived_at: null → 2026-09-21T18:03:11.984Z».
  "archived_at",
  "archived_by",
]);

/** Имена, у которых колонка не говорит сама за себя. `sprint_id` — это пространство доски. */
const FIELD_ALIASES: Record<string, string> = {
  sprint_id: "space",
  parent_id: "parent",
  owner_telegram_id: "owner",
  is_private: "private",
};

/** События жизненного цикла — отдельно от изменений полей. */
export type ProjectEvent = "created" | "archived" | "restored";

export type ProjectHistoryRow = {
  project_id: string;
  group_id: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
  /** Никогда не null: колонка `text NOT NULL` (та же мина, что в task_history — issue #287). */
  changed_by: string;
  changed_by_telegram_id: number | null;
  note: string | null;
};

type Actor = {
  actor?: string | null;
  actorTelegramId?: number | null;
  groupId?: string | null;
  note?: string | null;
};

function base(args: Actor): Omit<ProjectHistoryRow, "project_id" | "field"> & {
  old_value: null;
  new_value: null;
} {
  return {
    group_id: args.groupId ?? null,
    old_value: null,
    new_value: null,
    changed_by: actorName(args.actor, args.actorTelegramId),
    changed_by_telegram_id: args.actorTelegramId ?? null,
    note: args.note ?? null,
  };
}

/** Строки журнала для патча: по одной на РЕАЛЬНО изменившееся поле. */
export function projectHistoryRowsFor(
  args: {
    projectId: string;
    snapshot: Record<string, unknown> | null;
    patch: Record<string, unknown>;
  } & Actor,
): ProjectHistoryRow[] {
  if (!args.snapshot) return [];
  const common = base(args);
  return diffFields({
    snapshot: args.snapshot,
    patch: args.patch,
    skip: (c) => SKIPPED_COLUMNS.has(c),
    rename: (c) => FIELD_ALIASES[c] ?? c,
  }).map((d) => ({ ...common, ...d, project_id: args.projectId }));
}

/**
 * Строка события жизненного цикла. `value` — что осмысленно показать рядом: имя проекта при
 * создании, число уехавших в архив подпроектов и т.п.
 */
export function projectEventRow(
  args: { projectId: string; event: ProjectEvent; value?: unknown } & Actor,
): ProjectHistoryRow {
  return {
    ...base(args),
    project_id: args.projectId,
    field: args.event,
    new_value: args.value === undefined ? null : historyValue(args.value),
  };
}
