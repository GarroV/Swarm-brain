// Перехват права транскрибации по измеренной длине выгрузки (T160). Ядро прав, чистые функции.
//
// Зачем. Правило полноты (meeting-claim/arbiter.ts) сравнивает секунды записи, а их присылает
// клиент. Потолок по часам сервера (meeting-claim/claim-clock.ts) ограничивает заявку сверху, но
// растёт с часами: заявка, поданная много позже встречи (досылка из карантина рекордера), получает
// потолок около суток. Конец встречи сервер надёжно не знает: держатель мог уйти со встречи рано,
// а она шла дальше (#23: держатель остановил запись на 3-й минуте, другой участник записал 2.5 часа),
// — отсечка по концу записи держателя запретила бы ровно тот перехват, ради которого правило есть.
//
// Поэтому заявка ДРУГОГО человека на занятую встречу в claim ничего не перехватывает: она
// записывается претендентом (`recorders`, роль `challenger`), клиент выгружает аудио как обычно, а
// здесь, в meeting-ingest, сервер меряет выгрузку сам (audio-length.ts) и прогоняет тот же
// арбитраж по измеренному. Полнее — право переходит той же условной UPDATE, что раньше делал
// claim; нет — выгрузка отклоняется, строка встречи не тронута.
//
// Вторая половина — секунды держателя. У новой строки потолка нет (первый заявитель сам присылает
// и начало, и секунды), и завышенная заявка закрывала бы встречу от перехвата. Первая выгрузка
// держателя, измеренная короче его заявки, опускает секунды встречи до измеренного.

import { CLAIM_LEASE_TTL_SEC } from "../_shared/claim-lease.ts";
import { decideHeld, type HeldRow } from "../meeting-claim/arbiter.ts";
import { boundClaimSeconds, type MeetingClock } from "../meeting-claim/claim-clock.ts";

/** Роль в `meetings.recorders`: заявка другого человека ждёт сверки по выгрузке. */
export const CHALLENGER_ROLE = "challenger";

export type ChallengeRow = HeldRow & MeetingClock & { summary_status?: string | null };

export interface RecorderEntry {
  telegram_id: number;
  claimed_at: string;
  role: string;
  recorded_seconds?: number;
  mic_start_offset?: number;
}

function entries(recorders: unknown): RecorderEntry[] {
  return Array.isArray(recorders) ? recorders.filter((r) => typeof r?.telegram_id === "number") : [];
}

/**
 * Свежая заявка-претендент этого человека: выгрузку принимаем к сверке, только если claim был не
 * раньше срока лиза назад, — старая заявка не открывает встречу для выгрузки сколь угодно позже.
 */
export function freshChallenge(
  recorders: unknown,
  uploader: number,
  nowIso: string,
): { micStartOffset: number | null } | null {
  const mine = entries(recorders).find((r) => r.telegram_id === uploader);
  if (!mine || mine.role !== CHALLENGER_ROLE) return null;
  const ageSec = (Date.parse(nowIso) - Date.parse(mine.claimed_at)) / 1000;
  if (!Number.isFinite(ageSec) || ageSec < 0 || ageSec > CLAIM_LEASE_TTL_SEC) return null;
  const offset = mine.mic_start_offset;
  return { micStartOffset: typeof offset === "number" && Number.isFinite(offset) ? offset : null };
}

export type ChallengeVerdict =
  /** Встреча брошена (лиз истёк или держателя нет, стенограммы нет) — занять, как занял бы claim. */
  | { kind: "occupy"; seconds: number | null }
  /** Измеренная выгрузка заметно полнее — право переходит. */
  | { kind: "takeover"; seconds: number }
  | { kind: "refuse"; reason: string };

/**
 * Есть ли у держателя своя версия встречи: готовая стенограмма или запись, которая ещё
 * обрабатывается. Тогда более длинная выгрузка претендента право сразу не забирает — обе версии
 * сравниваются по объёму распознанного (meeting-processor, `challenge`), и владелец встречи
 * переходит вместе со стенограммой, а не раньше неё.
 */
export function holderHasVersion(row: Pick<ChallengeRow, "transcript" | "summary_status">): boolean {
  return row.transcript !== null || row.summary_status === "processing";
}

function isFree(row: ChallengeRow, nowIso: string): boolean {
  if (holderHasVersion(row)) return false;
  return row.claim_owner === null ||
    (row.lease_expires_at !== null && Date.parse(row.lease_expires_at) < Date.parse(nowIso));
}

/**
 * Судьба выгрузки претендента. Измеренное урезается потолком по часам сервера (запись не может
 * быть длиннее, чем шла встреча) и идёт в то же правило, что в claim: правленое и опубликованное
 * не трогается, у пишущего бота не перехватывается, иначе — только заметно более полная.
 */
export function decideChallenge(
  row: ChallengeRow,
  measuredSec: number | null,
  uploader: number,
  nowIso: string,
): ChallengeVerdict {
  const seconds = measuredSec === null ? undefined : boundClaimSeconds(row, measuredSec, nowIso);
  if (isFree(row, nowIso)) return { kind: "occupy", seconds: seconds ?? null };
  if (seconds === undefined) return { kind: "refuse", reason: "recording length could not be measured" };
  if (decideHeld(row, seconds, uploader, nowIso) !== "takeover") {
    return { kind: "refuse", reason: "recording is not substantially longer than the one already held" };
  }
  return { kind: "takeover", seconds };
}

/**
 * `recorders` после сверки: претендент становится transcribe (с измеренными секундами) или defer
 * (секунды заявки остаются как были), прежний держатель при переходе права — superseded.
 */
export function settleRecorders(
  recorders: unknown,
  uploader: number,
  outcome: "transcribe" | "defer",
  seconds: number | null,
  supersede: number | null,
): RecorderEntry[] {
  return entries(recorders).map((r) => {
    if (r.telegram_id === uploader) {
      return { ...r, role: outcome, ...(seconds !== null ? { recorded_seconds: seconds } : {}) };
    }
    if (supersede !== null && r.telegram_id === supersede && r.role === "transcribe") {
      return { ...r, role: "superseded" };
    }
    return r;
  });
}

/**
 * Секунды встречи после первой выгрузки держателя: заявленное больше измеренного — опускаем до
 * измеренного. Только первая выгрузка (у второй записи того же человека свои секунды, и строка
 * хранит самую полную) и только без бота на встрече: секунды бота уже ограничены ударами
 * (meeting-heartbeat), а его выгрузка и запасная запись рекордера меряют разное. null — не трогать.
 */
export interface HolderSecondsRow {
  claim_owner: number | null;
  recorded_seconds: number | null;
  agent_last_seen_at: string | null;
}

/** Стоит ли вообще мерить выгрузку ради поправки (замер — копия каждой части в памяти). */
export function mayCorrectHolderSeconds(
  row: HolderSecondsRow,
  uploader: number,
  priorSources: readonly string[] | null,
): boolean {
  if (row.claim_owner !== uploader || row.agent_last_seen_at !== null) return false;
  if (priorSources !== null && priorSources.length > 0) return false;
  return row.recorded_seconds !== null;
}

export function holderSecondsCorrection(
  row: HolderSecondsRow,
  uploader: number,
  priorSources: readonly string[] | null,
  measuredSec: number | null,
): number | null {
  if (!mayCorrectHolderSeconds(row, uploader, priorSources) || measuredSec === null) return null;
  return row.recorded_seconds !== null && row.recorded_seconds > measuredSec ? measuredSec : null;
}
