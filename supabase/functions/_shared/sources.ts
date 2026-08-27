// Реестр источников встреч (транскрибаторов) — единое место вместо хардкода списков
// `["read_ai","granola","desktop-agent"]`, разбросанного по swarm-mcp/swarm-bot/swarm-api.
// Новый источник = одна запись здесь + адаптер, а не правки в 5 фильтрах.

export type SourceKind = "device" | "external";

// id источника (значение колонки `source`) → метка + как попадает в систему.
export const MEETING_SOURCES: Record<string, { label: string; kind: SourceKind }> = {
  "desktop-agent": { label: "bumblebee", kind: "device" }, // наш macOS-рекордер (durable в таблице meetings)
  granola: { label: "Granola", kind: "external" },           // per-user API (тезисы готовы)
  read_ai: { label: "Read.ai", kind: "external" },           // общий webhook (отключается)
};

// Все id источников встреч (рекордер + внешние). Для «показать любые встречи».
export const ALL_MEETING_SOURCES: string[] = Object.keys(MEETING_SOURCES);

// Внешние источники, которые СЕЙЧАС пишут встречи прямо в `entries` (в отличие от рекордера,
// держащего pending в таблице `meetings`). До унификации pending-фильтры entries используют
// именно этот список; статистика/«последняя встреча» — ALL_MEETING_SOURCES (опубликованные
// рекордерные встречи тоже лежат в entries, source `desktop-agent`).
export const ENTRY_MEETING_SOURCES: string[] = Object.entries(MEETING_SOURCES)
  .filter(([, v]) => v.kind === "external")
  .map(([k]) => k);

// Человекочитаемая метка источника (для карточек/уведомлений). Неизвестный → «Встреча».
export function sourceLabel(source: string): string {
  return MEETING_SOURCES[source]?.label ?? "Встреча";
}
