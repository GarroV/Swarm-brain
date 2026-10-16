// Чистая логика записи: считается без браузера, поэтому проверяется тестами (logic.test.ts).
import type { RecorderErrorCode, RecordingRec } from "./types";

export interface ClockInput {
  startedMs: number;
  endedMs: number;
  /** Уже завершившиеся паузы (заглушённый трек, прерывания), мс. */
  gapMs: number;
  /** Пауза, которая идёт прямо сейчас (трек ended, «Продолжить» не нажали): её начало, мс. */
  ongoingGapStartMs?: number;
}

/** Сколько секунд звука реально записано: время по часам минус все паузы, включая текущую. */
export function recordedSeconds(c: ClockInput): number {
  const ongoing = c.ongoingGapStartMs ? Math.max(0, c.endedMs - c.ongoingGapStartMs) : 0;
  return Math.max(0, (c.endedMs - c.startedMs - c.gapMs - ongoing) / 1000);
}

/** Записи, принадлежащие этому пользователю. Без владельца (или чужие) — не наши: не предлагаем и не шлём. */
export function ownedRecordings(records: RecordingRec[], ownerId: number | null): RecordingRec[] {
  if (ownerId === null) return [];
  return records.filter((r) => r.ownerId === ownerId);
}

const SEGMENT_REJECTED = new Set(["bad_segment", "bad_offset", "empty_segment", "unsupported_media"]);

/**
 * Что значит ответ API с ошибкой. Только точные коды из тела JSON считаются «фатальными для
 * записи»: голый 403/404 может прийти от прокси или с протухшей сессией, и из-за него нельзя
 * ни бросать запись, ни тем более стирать звук. null — сеть/5xx/заморозка/сессия: повторяем.
 */
export function classifyApiFailure(status: number, body: unknown): RecorderErrorCode | null {
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined;
  if (code === "demo_not_allowed") return "demo";
  if (code === "too_many_open") return "too-many-open";
  if (code === "already_finished") return "finished";
  if (code === "not_found" || code === "forbidden") return "not-found";
  if (code === "segment_too_large" || status === 413) return "too-large";
  if (typeof code === "string" && SEGMENT_REJECTED.has(code)) return "rejected";
  return null;
}
