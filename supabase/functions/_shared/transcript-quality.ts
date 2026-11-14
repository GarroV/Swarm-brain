// Честный сигнал качества распознавания (#75): по сырью, до тезисов, оценивается, можно ли ему верить.
// Чистая логика без сети. Результат кладётся в `meetings.transcript.quality` (jsonb, миграции нет)
// и уезжает в веб вместе с транскриптом (GET /agent-meetings/:id).

/** Версия эвристики: меняется вместе с порогами, старые оценки видно в данных. */
export const QUALITY_VERSION = 1;
// Сегмент короче этого числа слов в петлю не считается: «да», «угу», «ну да» повторяются в живой речи.
export const LOOP_MIN_WORDS = 3;
// Одна и та же фраза встретилась столько раз и больше — это петля Whisper, а не речь.
export const LOOP_MIN_COUNT = 3;
// Доля сегментов в петлях, с которой запись считается плохо распознанной.
export const POOR_REPEAT_SHARE = 0.15;
// Whisper сам считает сегмент сомнительным ниже avg_logprob −1 (порог из референсной реализации).
export const LOW_LOGPROB = -1;
// Доля сомнительных по уверенности сегментов, с которой запись считается плохо распознанной.
export const POOR_LOW_CONF_SHARE = 0.4;
// Мало сегментов — оценка шумит (проба на проде: 40 сегментов с десятком «Корректор А. Кулакова» давали 25%), вердикта нет.
export const MIN_SEGMENTS_FOR_VERDICT = 50;

export type QualityReason = "repeats" | "low_confidence";
export interface TranscriptQuality {
  version: number;
  segments: number;
  /** Доля сегментов, входящих в повторяющиеся (не обязательно подряд) фразы. */
  repeat_share: number;
  /** Доля сегментов с низкой уверенностью Whisper; null — данных нет (старая запись). */
  low_conf_share: number | null;
  flag: "ok" | "poor";
  reasons: QualityReason[];
}
/** Счётчики уверенности, собранные по частям при транскрибации (Part.conf). */
export interface ConfidenceCount {
  n: number;
  low: number;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const normalize = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** Доля сегментов, чья нормализованная фраза (≥ LOOP_MIN_WORDS слов) встречается ≥ LOOP_MIN_COUNT раз. */
export function repeatShare(texts: readonly string[]): number {
  if (texts.length === 0) return 0;
  const keys = texts.map(normalize);
  const counts = new Map<string, number>();
  for (const k of keys) if (k.split(" ").length >= LOOP_MIN_WORDS) counts.set(k, (counts.get(k) ?? 0) + 1);
  let looped = 0;
  for (const k of keys) if ((counts.get(k) ?? 0) >= LOOP_MIN_COUNT) looped++;
  return looped / texts.length;
}

/** Считает уверенность по сырым сегментам Whisper (avg_logprob может не прийти — тогда сегмент не в счёт). */
export function countConfidence(raw: ReadonlyArray<{ avg_logprob?: number }>): ConfidenceCount | undefined {
  const known = raw.filter((s) => typeof s.avg_logprob === "number");
  if (known.length === 0) return undefined;
  return { n: known.length, low: known.filter((s) => (s.avg_logprob as number) < LOW_LOGPROB).length };
}

export function assessTranscript(texts: readonly string[], conf: readonly ConfidenceCount[] = []): TranscriptQuality {
  const repeats = repeatShare(texts);
  const n = conf.reduce((a, c) => a + c.n, 0);
  const lowShare = n > 0 ? conf.reduce((a, c) => a + c.low, 0) / n : null;
  const reasons: QualityReason[] = [];
  if (texts.length >= MIN_SEGMENTS_FOR_VERDICT) {
    if (repeats >= POOR_REPEAT_SHARE) reasons.push("repeats");
    if (lowShare !== null && lowShare >= POOR_LOW_CONF_SHARE) reasons.push("low_confidence");
  }
  return {
    version: QUALITY_VERSION,
    segments: texts.length,
    repeat_share: round3(repeats),
    low_conf_share: lowShare === null ? null : round3(lowShare),
    flag: reasons.length > 0 ? "poor" : "ok",
    reasons,
  };
}

/** Оценка итоговой стенограммы по готовым частям; плохая запись — одна строка в логе (#75). */
export function qualityOfTranscript(
  meetingId: string,
  segments: ReadonlyArray<{ text: string }>,
  parts: ReadonlyArray<{ done: boolean; conf?: ConfidenceCount }>,
): TranscriptQuality {
  const q = assessTranscript(segments.map((s) => s.text), parts.flatMap((p) => (p.done && p.conf ? [p.conf] : [])));
  if (q.flag === "poor") {
    console.warn(
      `meeting-processor: ${meetingId} — запись распознана плохо (${
        q.reasons.join("+")
      }): повторы ${q.repeat_share}, ` +
        `низкая уверенность ${q.low_conf_share ?? "нет данных"}, сегментов ${q.segments}`,
    );
  }
  return q;
}
