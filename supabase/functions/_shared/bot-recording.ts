// Пишет ли бот встречу прямо сейчас — одно правило для арбитра записей (meeting-claim/arbiter.ts)
// и для «комната уже занята ботом» (_shared/manual-rooms.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { baseIdentityKey } from "./meeting-roster.ts";

export interface BotRecordingRow {
  lease_expires_at: string | null;
  agent_last_recording: boolean | null;
}

/**
 * Бот ещё пишет встречу: флаг записи взведён ударом recording:true И лиз действует. Лиз продлевают
 * только удары recording:true (meeting-heartbeat), так что умерший бот с оставшимся флагом
 * перестаёт считаться пишущим не позже, чем через срок лиза.
 */
export function botStillRecording(row: BotRecordingRow, nowIso: string): boolean {
  return row.agent_last_recording === true && row.lease_expires_at !== null &&
    Date.parse(row.lease_expires_at) > Date.parse(nowIso);
}

/** Строка встречи для «её уже пишут»: ключ календаря и признаки живой записи. */
export interface RecordedNowRow extends BotRecordingRow {
  identity_key: string | null;
}

/**
 * Ключи встреч, которые прямо сейчас пишет бот (или чужой рекордер) — для рекордера человека,
 * чтобы он не предлагал «Записать» звонок, который уже пишется (issue #821). Отбор по человеку
 * делает запрос (`loadRecordedNow`), здесь — только «пишет ли сейчас».
 */
export function recordedNowKeys(rows: readonly RecordedNowRow[], nowIso: string): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    // Без метки пространства: календарь человека знает встречу под общим ключом.
    if (r.identity_key && botStillRecording(r, nowIso)) keys.add(baseIdentityKey(r.identity_key));
  }
  return [...keys];
}

/** Отбор «встреча с участием человека»: записывал, совладелец или участник по e-mail приглашения. */
function whoFilter(telegramId: number, email: string | null): string {
  const id = Math.trunc(telegramId);
  const who = [`recorders.cs.[{"telegram_id":${id}}]`, `co_owners.cs.{${id}}`];
  const mail = (email ?? "").trim().toLowerCase();
  if (/^[^\s",(){}\[\]]+@[^\s",(){}\[\]]+$/.test(mail)) who.push(`attendees.cs.[{"email":"${mail}"}]`);
  return who.join(",");
}

/**
 * Встречи с участием человека (записывал, совладелец или участник по e-mail приглашения), которые
 * сейчас пишутся. Ошибка базы — пустой список: лишняя плашка «Записать» безопаснее, чем пропавшая.
 */
export async function loadRecordedNow(
  client: SupabaseClient,
  telegramId: number,
  email: string | null,
  nowIso: string,
): Promise<string[]> {
  const { data, error } = await client.from("meetings")
    .select("identity_key, lease_expires_at, agent_last_recording")
    .eq("agent_last_recording", true)
    .gt("lease_expires_at", nowIso)
    .or(whoFilter(telegramId, email));
  if (error) {
    console.error("recorded-now: не прочитать встречи", error.message);
    return [];
  }
  return recordedNowKeys((data ?? []) as RecordedNowRow[], nowIso);
}

/** Строка встречи для «бот приходил»: признаки касания ботом и время встречи. */
export interface BotTouchedRow extends RecordedNowRow {
  started_at: string | null;
  ended_at: string | null;
  agent_last_seen_at: string | null;
  /** Пропуски бота, привязанные заявкой к этой встрече (meeting_agent_grants). */
  meeting_agent_grants: ReadonlyArray<{ created_at: string }> | null;
}

/** Запас до начала и после конца: бот приходит раньше слота, а у двери стоит до конца встречи. */
const BOT_TOUCHED_LEAD_MS = 15 * 60_000;
const BOT_TOUCHED_TAIL_MS = 10 * 60_000;
/** Нет конца события — считаем встречу идущей столько. */
const BOT_TOUCHED_DEFAULT_LENGTH_MS = 3 * 3_600_000;

/**
 * Ключи встреч, на которые бот ПРИХОДИЛ или приходит сейчас — пишет он или нет (issue #1278).
 * `recorded_now` знает только пишущего бота; бот у двери (комната ожидания, закрытая комната,
 * отказ в допуске) или уже ушедший ни с чем в него не попадал, и рекордер молча привязывал звонок
 * человека к этой встрече. «Бот трогал» = пропуск бота привязан заявкой к встрече (заявка идёт до
 * захода в звонок, поэтому дверь видна) ИЛИ есть удар агента ИЛИ он пишет сейчас. Время встречи
 * пересекает «сейчас» с запасом `BOT_TOUCHED_*`. Прошедшая встреча и встреча без бота не попадают.
 */
export function botTouchedKeys(rows: readonly BotTouchedRow[], nowIso: string): string[] {
  const now = Date.parse(nowIso);
  const keys = new Set<string>();
  for (const r of rows) {
    if (!r.identity_key) continue;
    const touched = (r.meeting_agent_grants ?? []).length > 0 || r.agent_last_seen_at !== null ||
      botStillRecording(r, nowIso);
    if (!touched) continue;
    const grantStarts = (r.meeting_agent_grants ?? []).map((g) => Date.parse(g.created_at));
    const startMs = [r.started_at ? Date.parse(r.started_at) : NaN, ...grantStarts].filter(Number.isFinite);
    if (startMs.length === 0) continue;
    const start = Math.min(...startMs);
    const end = r.ended_at && Number.isFinite(Date.parse(r.ended_at))
      ? Date.parse(r.ended_at)
      : start + BOT_TOUCHED_DEFAULT_LENGTH_MS;
    if (now >= start - BOT_TOUCHED_LEAD_MS && now <= end + BOT_TOUCHED_TAIL_MS) {
      keys.add(baseIdentityKey(r.identity_key));
    }
  }
  return [...keys];
}

/** Встречи с участием человека (тот же отбор «кто», что у `loadRecordedNow`), на которые бот приходил. */
export async function loadBotTouched(
  client: SupabaseClient,
  telegramId: number,
  email: string | null,
  nowIso: string,
): Promise<string[]> {
  const sinceIso = new Date(Date.parse(nowIso) - 24 * 3_600_000).toISOString();
  const { data, error } = await client.from("meetings")
    .select(
      "identity_key, lease_expires_at, agent_last_recording, started_at, ended_at, agent_last_seen_at, meeting_agent_grants(created_at)",
    )
    .gte("created_at", sinceIso)
    .or(whoFilter(telegramId, email));
  if (error) {
    console.error("bot-touched: не прочитать встречи", error.message);
    return [];
  }
  return botTouchedKeys((data ?? []) as BotTouchedRow[], nowIso);
}
