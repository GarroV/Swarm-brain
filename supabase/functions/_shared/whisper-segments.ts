// Разбор ответа Whisper (verbose_json) в сегменты стенограммы: фильтр галлюцинаций, схлопывание петель,
// счётчики уверенности для оценки качества (#75). Чистая логика без сети.
import {
  dropConsecutiveRuns,
  isRepeatedFiller,
  isSingleTokenSpam,
  isWhisperHallucination,
  WHISPER_HALLUCINATION_RE,
} from "./whisper-hallucinations.ts";
import { type ConfidenceCount, countConfidence } from "./transcript-quality.ts";
import type { Segment } from "./speakers.ts";

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
}
export interface WhisperReply {
  text?: string;
  segments?: WhisperSegment[];
}
export interface RefinedPart {
  segments: Segment[];
  viaFallback: boolean;
  /** Уверенность Whisper по оставшимся сегментам; undefined — модель не отдала avg_logprob. */
  conf?: ConfidenceCount;
}

export function refineWhisperReply(d: WhisperReply): RefinedPart {
  const raw = (d.segments ?? [])
    .filter((s) => !isWhisperHallucination(s.text ?? "", s.no_speech_prob ?? 0, s.avg_logprob ?? 0));
  const kept: Segment[] = raw.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  // Схлопываем подряд идущие одинаковые короткие сегменты — петля Whisper на тишине
  // (напр. «sviđanje»×77 по 5с на молчащем микрофоне), язык-независимо, ДО проверки доминирования.
  const collapsed = dropConsecutiveRuns(kept, (s) => s.text);
  const texts = collapsed.map((s) => s.text);
  // Часть — мусор, если это одна фраза-«аутро» по всем сегментам (isRepeatedFiller) ИЛИ сплошной
  // спам одиночных токенов (тихий микрофон: смесь двух петель держит любой токен под порогом
  // доминирования). В обоих случаях дропаем ВСЁ и НЕ подставляем d.text (тот же повторённый мусор).
  const filler = isRepeatedFiller(texts) || isSingleTokenSpam(texts);
  const segments: Segment[] = filler ? [] : collapsed;
  let viaFallback = false;
  // Фолбэк на d.text — только если он сам не галлюцинация и часть не признана повтором-мусором.
  if (!filler && segments.length === 0 && d.text && !WHISPER_HALLUCINATION_RE.test(d.text)) {
    segments.push({ start: 0, end: 0, text: d.text.trim() });
    viaFallback = true;
  }
  // Уверенность — по сегментам, дошедшим до стенограммы: отфильтрованные галлюцинации не в счёт.
  return { segments, viaFallback, conf: filler ? undefined : countConfidence(raw) };
}
