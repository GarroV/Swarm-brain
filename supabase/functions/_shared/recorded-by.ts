// Чья запись легла в стенограмму встречи: бота встреч (`bot`) или рекордера на Mac (`recorder`).
//
// Бот ходит на встречу ЗА человека, и в meetings.recorders у него telegram_id этого человека —
// по нему запись бота и рекордера одного человека неотличимы (решение владельца 03.10.2026, #788).
// Поэтому отметку ставит обработчик в той же UPDATE, что пишет стенограмму, по источнику выгрузки
// (`agent:` | `person:`, meeting-ingest/second-recording.ts uploadSource): вторая запись, проигравшая
// сравнение, стенограмму не пишет и отметку не меняет. Значения нейтральные — имена бота и рекордера
// подставляет интерфейс, ядро их не знает (docs/furca/bot-boundary.md).

export type RecordedBy = "bot" | "recorder";

export function recordedByOf(source: string | undefined): RecordedBy | null {
  if (source === undefined) return null;
  if (source.startsWith("agent:")) return "bot";
  if (source.startsWith("person:")) return "recorder";
  return null;
}
