// Решение по серверной копии записи (#1314): что с ней делать, чтобы запись не терялась молча и
// разбирала её система, а не человек. Чистая функция — вся проверка по дешёвым признакам (держатель
// права, источник, длительность, время, статус), без распознавания и без токенов.
//
// Копия появляется, когда сервер запись не взял в работу (meeting-ingest/backup.ts): `deferred` —
// встречу держал бот или другой человек, `rejected`/`exhausted` — отказ или исчерпанные попытки.
// Случаи (реальные — 09.11 и 11.11.2026):
//   • встреча получила полноценную запись того же человека, не короче копии → `covered`;
//   • тот же звук ушёл отдельной своей встречей («Это моя встреча», автодосылка) → `covered_elsewhere`;
//   • запись встречи короче копии, а копия того же человека, что держит встречу → `ingest`: копия
//     идёт второй записью и сравнивается по объёму распознанного (старая стенограмма не теряется,
//     если полнее она);
//   • копия человека, который встречу НЕ держит (мог быть другой звонок — прод 11.11), → `own_meeting`:
//     отдельная встреча этого человека. В чужую встречу не вливается никогда, чужую не трогаем
//     (решение владельца 12.11.2026: записи на параллельных встречах самостоятельны);
//   • файлов уже нет, держателя нет, встреча того же человека заморожена → `review`: видно в базе и
//     в журнале, не вычищается;
//   • встреча ещё обрабатывается или копия слишком свежая → `wait`.
// Заморозка (правка человеком/публикация) проверяется ПОСЛЕ покрытия: полная опубликованная запись
// копию покрывает, а вот вливать в замороженную встречу автоматика не может.

/** Копия моложе этого не разбирается: рекордер сам досылает и спрашивает владельца (решение 11.11.2026). */
export const RESOLVE_GRACE_MS = 45 * 60_000;
/** Дольше ожидание не тянем: встреча, которая так и не освободилась, — на разбор. */
export const WAIT_LIMIT_MS = 48 * 3600_000;
/** Запись встречи считается покрывающей копию, если короче неё не более чем на столько секунд. */
export const COVER_TOLERANCE_SEC = 5;
/** Тот же звук в другой встрече узнаётся по длительности, совпавшей с точностью до секунд. */
export const SAME_AUDIO_TOLERANCE_SEC = 2;

export interface BackupFacts {
  id: string;
  meetingId: string;
  uploader: number;
  source: string;
  recordedSeconds: number | null;
  createdAt: string;
  /** Файлы копии уже убраны из хранилища (влить нечего). */
  filesPurged: boolean;
  /** Почему копия появилась: deferred | rejected | exhausted | other (meeting-ingest/backup.ts). */
  reason: string;
}

export interface BackupMeetingFacts {
  id: string;
  claimOwner: number | null;
  summaryStatus: string | null;
  /** Правлена человеком или опубликована (_shared/meeting-frozen.ts). */
  frozen: boolean;
  hasTranscript: boolean;
  recordedSeconds: number | null;
  /** `process_state.sources`; null — состояния нет или оно старой формы. */
  sources: readonly string[] | null;
}

/** Другая встреча того же человека, созданная после копии. */
export interface OwnMeetingFacts {
  id: string;
  summaryStatus: string | null;
  recordedSeconds: number | null;
  createdAt: string;
}

export type BackupVerdict =
  | { action: "covered"; note: string }
  | { action: "covered_elsewhere"; note: string; meetingId: string }
  | { action: "ingest"; note: string; mode: "challenge" | "process" }
  | { action: "own_meeting"; note: string }
  | { action: "wait"; note: string }
  | { action: "review"; note: string };

export interface DecideInput {
  backup: BackupFacts;
  meeting: BackupMeetingFacts;
  ownMeetings: readonly OwnMeetingFacts[];
  nowMs: number;
  /** Загрузивший и сейчас допущен к записи (mayRecordNow): проверяется заново при разборе. */
  uploaderMayRecord: boolean;
}

const sec = (n: number) => `${Math.round(n)} с`;

/** Единственная причина копии, при которой она может стать своей встречей: сервер сказал «встречу держит другой». */
export const OWN_MEETING_REASON = "deferred";

export interface RecorderAdmissionRow {
  group_id: string | null;
  recorder_token_hash: string | null;
  recorder_token_expires_at: string | null;
  recorder_token_prev_hash: string | null;
  recorder_token_prev_expires_at: string | null;
}

const alive = (hash: string | null, expiresAt: string | null, nowMs: number) =>
  hash !== null && (expiresAt === null || Date.parse(expiresAt) > nowMs);

/**
 * Допуск человека к записи сейчас — то же, чего требует дверь `agent-auth` (строка в allowed_users,
 * действующий токен рекордера, в том числе предыдущий на время перекрытия) плюс пространство копии:
 * перенесённый в другое пространство своей встречи в старом не заводит.
 */
export function mayRecordNow(row: RecorderAdmissionRow | null, backupGroupId: string | null, nowMs: number): boolean {
  if (row === null || backupGroupId === null || row.group_id !== backupGroupId) return false;
  return alive(row.recorder_token_hash, row.recorder_token_expires_at, nowMs) ||
    alive(row.recorder_token_prev_hash, row.recorder_token_prev_expires_at, nowMs);
}

const OWN_MEETING_MARK = "отдельная запись / separate recording";
const MAX_TITLE_LEN = 200;

/** Название своей встречи для копии чужого человека: название встречи-источника + пометка на двух языках. */
export function separateRecordingTitle(sourceTitle: string | null | undefined): string {
  const base = (sourceTitle ?? "").trim();
  if (base === "") return "Отдельная запись / Separate recording";
  const suffix = ` — ${OWN_MEETING_MARK}`;
  return `${base.slice(0, MAX_TITLE_LEN - suffix.length)}${suffix}`;
}

function coveredByMeeting(b: BackupFacts, m: BackupMeetingFacts): boolean {
  const sameHuman = m.claimOwner === b.uploader || (m.sources?.includes(b.source) ?? false);
  return sameHuman && m.summaryStatus === "done" && m.hasTranscript &&
    b.recordedSeconds !== null && m.recordedSeconds !== null &&
    m.recordedSeconds + COVER_TOLERANCE_SEC >= b.recordedSeconds;
}

function sameAudioElsewhere(b: BackupFacts, own: readonly OwnMeetingFacts[]): OwnMeetingFacts | null {
  if (b.recordedSeconds === null) return null;
  const created = Date.parse(b.createdAt);
  return own.find((o) =>
    (o.summaryStatus === "done" || o.summaryStatus === "processing") &&
    o.recordedSeconds !== null &&
    Math.abs(o.recordedSeconds - b.recordedSeconds!) <= SAME_AUDIO_TOLERANCE_SEC &&
    Date.parse(o.createdAt) >= created
  ) ?? null;
}

export function decideBackup(
  { backup: b, meeting: m, ownMeetings, nowMs, uploaderMayRecord }: DecideInput,
): BackupVerdict {
  const age = nowMs - Date.parse(b.createdAt);
  if (age < RESOLVE_GRACE_MS) return { action: "wait", note: "копия свежая: рекордер ещё может досылать сам" };

  if (coveredByMeeting(b, m)) {
    return {
      action: "covered",
      note: `встреча получила запись этого человека ${sec(m.recordedSeconds!)}, копия ${sec(b.recordedSeconds!)}`,
    };
  }
  const elsewhere = sameAudioElsewhere(b, ownMeetings);
  if (elsewhere) {
    return {
      action: "covered_elsewhere",
      meetingId: elsewhere.id,
      note: `тот же звук (${sec(elsewhere.recordedSeconds!)}) уже ушёл отдельной встречей ${elsewhere.id}`,
    };
  }

  if (b.filesPurged) return { action: "review", note: "записи не нашлось, а файлы копии уже убраны" };
  if (m.claimOwner === null) return { action: "review", note: "у встречи нет держателя права" };
  if (m.claimOwner !== b.uploader) {
    // Источник копии уже принят этой встречей: запись человека лежит там (право перешло к другому
    // участнику), своя встреча стала бы дублем.
    if (m.sources?.includes(b.source)) {
      return { action: "review", note: `запись этого человека уже принята встречей, а держит её ${m.claimOwner}` };
    }
    // Отдельная встреча не должна обходить отказ, из-за которого копия появилась: только «отложено»
    // (встречу держал другой). Отказ по праву, исчерпанные попытки и неизвестное — на человека.
    if (b.reason !== OWN_MEETING_REASON) {
      return { action: "review", note: `причина копии «${b.reason}»: своей встречей автоматически не становится` };
    }
    if (!uploaderMayRecord) {
      return {
        action: "review",
        note: "загрузивший больше не допущен к записи: своей встречи автоматически не заводим",
      };
    }
    return {
      action: "own_meeting",
      note: `встречу держит другой человек (${m.claimOwner}): копия — отдельная встреча этого человека`,
    };
  }
  if (m.frozen) return { action: "review", note: "встречу правили или опубликовали: автоматика её не трогает" };

  if (m.summaryStatus === "processing") {
    return age >= WAIT_LIMIT_MS
      ? { action: "review", note: "встреча обрабатывалась дольше предела ожидания" }
      : { action: "wait", note: "встреча ещё обрабатывается" };
  }
  return {
    action: "ingest",
    mode: m.hasTranscript ? "challenge" : "process",
    note: m.hasTranscript
      ? `запись встречи ${
        m.recordedSeconds === null ? "без длины" : sec(m.recordedSeconds)
      } короче копии или не готова: вторая запись, остаётся полнее`
      : "у встречи нет стенограммы: копия обрабатывается как первая запись",
  };
}
