// Арбитраж занятой встречи: у встречи уже есть claim_owner, и приходит ещё одна запись. Кто получает
// право транскрибации — и какими условиями UPDATE решение защищено от того, что строка изменилась,
// пока claim считал. Вынесено из index.ts чистыми функциями: здесь решается, чья запись станет
// стенограммой, которую команда читает как факт, и держать это должны тесты, а не глаз.
//
// Правило полноты (с 17.08.2026): право у заметно более полной записи, а не у того, кто раньше нажал
// стоп. Поправка D020 (T157): пока бот scriba ещё пишет встречу (лиз действует, флаг записи взведён),
// «сколько записано сейчас» несправедливо к боту — он допишет встречу до конца. Поэтому:
//   • запись ДРУГОГО человека встречу у пишущего бота не перехватывает (defer): бот иначе получил бы
//     403 и ушёл со звонка;
//   • запись ТОГО ЖЕ человека (его рекордер рядом с его ботом) — запасная (reserve): право ей даётся
//     без перехвата, строка встречи не трогается, аудио выгружается и обрабатывается сразу. Бот,
//     дописав, выгружает своё, и meeting-ingest оставляет более полную по объёму распознанного
//     (second-recording.ts, T156). Умер бот — запасная уже в базе.
// Бот не пишет (остановился или умер: лиз истёк) — прежнее правило полноты.

import { MAX_RECORDED_SECONDS } from "../_shared/claim-lease.ts";

// Перехват права более полной записью. Оба порога должны выполниться разом — чтобы почти
// одинаковые записи (штатный случай: все стопнули в пределах минуты) не гоняли перетранскрибацию
// туда-сюда, но провал вроде «3 минуты против 2.5 часов» закрывался гарантированно.
const TAKEOVER_MIN_RATIO = 1.5; // новая запись длиннее текущей минимум в полтора раза
const TAKEOVER_MIN_EXTRA_SEC = 300; // …и минимум на 5 минут в абсолюте

/** Что arbiter читает из строки встречи. */
export interface HeldRow {
  claim_owner: number | null;
  recorded_seconds: number | null;
  transcript: { segments?: Array<{ end?: number }> } | null;
  notes_edited_at: string | null;
  status: string | null;
  lease_expires_at: string | null;
  agent_last_recording: boolean | null;
}

/**
 * Чем кончается claim на занятую встречу:
 *   defer    — отказ, право остаётся у держателя;
 *   reserve  — тот же человек при пишущем боте: выгружай, строку встречи не перехватываем;
 *   refresh  — тот же человек, бот не пишет, запись заметно полнее: лиз и секунды — ему, маркеры
 *              обработки не сбрасываются (вторую запись того же владельца сравнит meeting-ingest);
 *   takeover — другой человек, бот не пишет, запись заметно полнее: право переходит к нему.
 */
export type HeldDecision = "defer" | "reserve" | "refresh" | "takeover";

/** Секунды claim: мусор и ноль — «секунд нет», как было всегда; сверх суток — отказ (400). */
export function readClaimSeconds(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  if (raw > MAX_RECORDED_SECONDS) {
    throw new Error(`recorded_seconds must not exceed ${MAX_RECORDED_SECONDS}`);
  }
  return raw;
}

/**
 * Бот ещё пишет встречу: флаг записи взведён ударом recording:true И лиз действует. Лиз продлевают
 * только удары recording:true (meeting-heartbeat), так что умерший бот с оставшимся флагом
 * перестаёт считаться пишущим не позже, чем через срок лиза.
 */
export function botStillRecording(row: HeldRow, nowIso: string): boolean {
  return row.agent_last_recording === true && row.lease_expires_at !== null &&
    Date.parse(row.lease_expires_at) > Date.parse(nowIso);
}

/**
 * Длительность записи, которая СЕЙЧАС лежит за встречей (сек). Для строк, заведённых старым
 * клиентом, recorded_seconds пуст — оцениваем по последнему таймстампу сохранённого транскрипта.
 * Это позволяет перехватить право у записи старой сборки, не дожидаясь обновления всей команды.
 */
export function heldSeconds(row: Pick<HeldRow, "recorded_seconds" | "transcript">): number {
  if (typeof row.recorded_seconds === "number" && Number.isFinite(row.recorded_seconds)) {
    return row.recorded_seconds;
  }
  let max = 0;
  for (const s of row.transcript?.segments ?? []) {
    const e = typeof s?.end === "number" && Number.isFinite(s.end) ? s.end : 0;
    if (e > max) max = e;
  }
  return max;
}

function isSubstantiallyLonger(candidate: number, held: number): boolean {
  return candidate >= held * TAKEOVER_MIN_RATIO && candidate >= held + TAKEOVER_MIN_EXTRA_SEC;
}

export function decideHeld(row: HeldRow, candidate: number, ownerId: number, nowIso: string): HeldDecision {
  // Правленное человеком или опубликованное команде не трогает никто.
  if (row.notes_edited_at !== null || row.status === "in_base") return "defer";
  const sameOwner = row.claim_owner === ownerId;
  if (botStillRecording(row, nowIso)) return sameOwner ? "reserve" : "defer";
  if (!(candidate > 0 && isSubstantiallyLonger(candidate, heldSeconds(row)))) return "defer";
  return sameOwner ? "refresh" : "takeover";
}

/** Условие UPDATE — описанием, чтобы тест проверял его на строке, а index.ts переводил в PostgREST. */
export type Guard =
  | { kind: "eq"; column: string; value: string | number }
  | { kind: "isNull"; column: string }
  | { kind: "notTrue"; column: string }
  | { kind: "before"; column: string; value: string }
  | { kind: "anyOf"; clauses: Guard[] };

/**
 * Условия перехвата (refresh/takeover), которые UPDATE сверяет сам (разбор прав T155, MEDIUM):
 *   • claim_owner прежний — никто не перехватил, пока мы считали;
 *   • recorded_seconds тот же, что прочитан, — иначе удар бота успел записать больше, и решение
 *     «заметно полнее» принято по устаревшей цифре;
 *   • бот не начал писать: флаг не взведён или лиз истёк.
 */
export function heldGuards(row: HeldRow, nowIso: string): Guard[] {
  return [
    row.claim_owner === null
      ? { kind: "isNull", column: "claim_owner" }
      : { kind: "eq", column: "claim_owner", value: row.claim_owner },
    row.recorded_seconds === null
      ? { kind: "isNull", column: "recorded_seconds" }
      : { kind: "eq", column: "recorded_seconds", value: row.recorded_seconds },
    {
      kind: "anyOf",
      clauses: [
        { kind: "notTrue", column: "agent_last_recording" },
        { kind: "isNull", column: "lease_expires_at" },
        { kind: "before", column: "lease_expires_at", value: nowIso },
      ],
    },
  ];
}
