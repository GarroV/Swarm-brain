// Чья запись легла в стенограмму встречи: бота встреч (scriba) или рекордера на Mac (bumblebee).
//
// Бот ходит на встречу ЗА человека, и в meetings.recorders у него telegram_id этого человека —
// по нему запись бота и рекордера одного человека неотличимы (решение владельца 03.10.2026,
// docs/decisions/2026-10-03-no-empty-meetings-bumblebee-vs-scriba.md, #788). Поэтому отметку ставит
// обработчик в той же UPDATE, что пишет стенограмму, по источнику выгрузки (`agent:` | `person:`,
// meeting-ingest/second-recording.ts uploadSource): вторая запись, проигравшая сравнение, стенограмму
// не пишет и отметку не меняет.

export type RecordedBy = "scriba" | "bumblebee";

export function recordedByOf(source: string | undefined): RecordedBy | null {
  if (source === undefined) return null;
  if (source.startsWith("agent:")) return "scriba";
  if (source.startsWith("person:")) return "bumblebee";
  return null;
}
