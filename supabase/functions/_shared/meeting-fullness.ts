// Арбитраж версий одной встречи по ПОЛНОТЕ — «в базу по дефолту идёт самая полная встреча»
// (решение владельца 2026-08-28, docs/decisions/2026-08-28-one-meeting-one-record.md).
//
// Почему не «кто первый»: это правило проект уже проходил в meeting-claim и заплатил за него
// потерей записи на 2ч26м (issues #23/#24) — claim подаётся на стопе, поэтому «первый» = тот,
// кто раньше нажал стоп, то есть владелец САМОЙ КОРОТКОЙ записи. На публикации очередь решала
// точно так же произвольно (issue #176).
//
// Почему метрика — объём РАСПОЗНАННОГО, а не длительность записи: на живом случае 26.08 две
// версии одной встречи имели почти равную длительность (1920 с против 1980 с — порог claim ×1.5
// не берётся), но распознано было вдвое разное: 469 сегментов против 1097, тезисы 3325 против
// 7068 символов. Разошлись они не длиной звонка, а тем, сколько речи вообще попало в транскрипт
// (у одного рекордера потерян звук собеседника — issue #10). Длительность к этому слепа.

/** Порог «существенно полнее»: как в арбитраже claim — близкие версии не гоняют перезапись. */
export const FULLNESS_MIN_RATIO = 1.5;

export type TranscriptLike = { segments?: Array<{ text?: string | null }> | null } | null;

/** Объём распознанного: суммарная длина текста сегментов. 0 — транскрипта нет или он пуст. */
export function transcriptVolume(t: TranscriptLike): number {
  const segs = t?.segments ?? [];
  let sum = 0;
  for (const s of segs) sum += (s?.text ?? "").trim().length;
  return sum;
}

export type VersionFullness = {
  /** Транскрипт версии (у внешних источников вроде Granola его нет вовсе). */
  transcript: TranscriptLike;
  /** Правил ли тезисы человек (meetings.notes_edited_at) — такую версию не перезаписываем. */
  notesEditedAt?: string | null;
};

export type ArbitrationResult = {
  /** Заменить содержимое опубликованной записи на входящую версию. */
  replace: boolean;
  /** Почему — для лога и для честного текста пользователю. */
  reason:
    | "incoming_richer"        // входящая существенно полнее
    | "incoming_has_transcript" // у входящей транскрипт есть, у опубликованной нет
    | "published_edited"      // опубликованную правил человек — не трогаем
    | "incoming_edited"       // входящую правил человек — решать ему, а не автоматике
    | "not_richer";           // входящая не полнее (или разница в пределах порога)
};

/**
 * Нужно ли заменить опубликованную версию входящей.
 *
 * Замена — только когда выигрыш очевиден И никто не правил тезисы руками:
 *   • правил человек ту, что в базе → не трогаем (та же защита, что у перехвата в claim);
 *   • правил человек входящую → это его текст, автоматика его судьбу не решает: пользователю
 *     показывается, что он правит общую запись, лежащую в базе;
 *   • у входящей есть транскрипт, а у опубликованной нет → входящая полнее по определению
 *     (сравнивать объёмы нечем, но проверяемая сторона одна);
 *   • иначе сравниваем объём распознанного с порогом FULLNESS_MIN_RATIO.
 */
export function arbitrateFullness(
  incoming: VersionFullness,
  published: VersionFullness,
): ArbitrationResult {
  if (published.notesEditedAt) return { replace: false, reason: "published_edited" };
  if (incoming.notesEditedAt) return { replace: false, reason: "incoming_edited" };

  const inc = transcriptVolume(incoming.transcript);
  const pub = transcriptVolume(published.transcript);

  if (inc > 0 && pub === 0) return { replace: true, reason: "incoming_has_transcript" };
  if (inc >= pub * FULLNESS_MIN_RATIO && inc > pub) {
    return { replace: true, reason: "incoming_richer" };
  }
  return { replace: false, reason: "not_richer" };
}
