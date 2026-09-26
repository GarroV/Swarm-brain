/**
 * Строка состояния в журнале контейнера — единственный канал «контейнер → оркестратор».
 *
 * Если контейнер умрёт, оркестратору нужен `meeting_id`, чтобы привязать к нему нотису
 * `container_died`. Общий каталог на запись для этого не заводится: журнал у контейнера
 * есть и так, и оркестратор всё равно его читает.
 *
 *   scriba-state {"meetingId":"…"}
 *   scriba-state {"outcome":"recorded"}
 */

const PREFIX = "scriba-state ";

export interface StateUpdate {
  readonly meetingId?: string;
  readonly outcome?: string;
}

export function formatStateLine(update: StateUpdate): string {
  return `${PREFIX}${JSON.stringify(update)}`;
}

/**
 * Разобрать одну строку журнала. Чужая строка или мусор — `null`: журнал общий с браузером
 * и ffmpeg, и падать на их выводе нельзя.
 */
export function parseStateLine(line: string): StateUpdate | null {
  const at = line.indexOf(PREFIX);
  if (at === -1) return null;
  try {
    const parsed: unknown = JSON.parse(line.slice(at + PREFIX.length));
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const update: { meetingId?: string; outcome?: string } = {};
    if (typeof record.meetingId === "string" && record.meetingId !== "") {
      update.meetingId = record.meetingId;
    }
    if (typeof record.outcome === "string" && record.outcome !== "") {
      update.outcome = record.outcome;
    }
    return Object.keys(update).length === 0 ? null : update;
  } catch {
    return null;
  }
}
