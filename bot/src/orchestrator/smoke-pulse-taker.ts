/**
 * Рекордер человека в смоуке пульса (D020, T160): заявка в настоящий `meeting-claim` и выгрузка в
 * настоящий `meeting-ingest`. Заявка встречу не забирает — право переходит по выгрузке, аудио
 * которой сервер измерил сам (по содержимому частей, не по заголовку).
 */
import { ingestFormOf } from "../../../scripts/smoke-m4a.ts";

/**
 * Сколько аудио записал рекордер человека: час против нуля записанного ботом.
 */
const TAKER_UPLOAD_SECONDS = 3600;

export interface TakerRecorder {
  readonly token: string;
  readonly claimPort: number;
  readonly ingestPort: number;
}

/**
 * Заявка bumblebee человека на календарную встречу `key`: запись на час.
 */
export async function claimAsTaker(
  taker: TakerRecorder,
  key: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${String(taker.claimPort)}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${taker.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      identity_kind: "calendar",
      identity_key: key,
      recorded_seconds: TAKER_UPLOAD_SECONDS,
    }),
  });
  return { status: response.status, ...((await response.json()) as Record<string, unknown>) };
}

/**
 * Выгрузка часа аудио по встрече `meetingId`.
 */
export async function uploadAsTaker(
  taker: TakerRecorder,
  meetingId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${String(taker.ingestPort)}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${taker.token}` },
    body: ingestFormOf(meetingId, TAKER_UPLOAD_SECONDS),
  });
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, ...body };
}
