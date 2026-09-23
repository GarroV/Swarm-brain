// Говорящие в стенограмме: разбор таймлайна с границы, сведение времени с сегментами, сборка
// стенограммы и легенда для промпта тезисов. Чистый модуль — ни сети, ни Deno.env, ни базы:
// ошибка тут молчаливая и дорогая (неверное имя в стенограмме выглядит правдоподобно), поэтому
// всё сведение живёт здесь и покрыто тестами (speakers.test.ts).
//
// Источник таймлайна — бот scriba: он опрашивает активного говорящего на площадке и шлёт интервалы
// полем `speakers` формы meeting-ingest. Поле НЕОБЯЗАТЕЛЬНОЕ: рекордер bumblebee о нём не знает и
// знать не должен — без поля стенограмма собирается ровно как раньше (мягкая деградация).

export interface SpeakerSpan {
  start: number;
  end: number;
  name: string;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

/** Часть дорожки в том виде, в каком её знает сборка стенограммы (подмножество Part). */
export interface SpeakerPart {
  track: "sys" | "mic";
  done: boolean;
  segments?: Segment[];
}

/** Невалидный таймлайн на границе. meeting-ingest превращает её в 400 с этим же текстом. */
export class SpeakerTimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeakerTimelineError";
  }
}

/** Потолок на размер таймлайна: час встречи с опросом раз в секунду — ~3600 интервалов. */
export const MAX_SPEAKER_SPANS = 5000;
/** Потолок на длину имени: имя едет в промпт тезисов, «имя» на 10КБ — это мусор, а не имя. */
export const MAX_SPEAKER_NAME_LEN = 120;

export const LABEL_OTHER = "собеседник";
export const LABEL_SELF = "я";

// Имя приходит из списка участников площадки, то есть его задаёт посторонний человек. В промпт и в
// стенограмму оно попадает как есть, а формат стенограммы — построчный («метка: текст»), поэтому
// перевод строки в имени ломает разметку и открывает инъекцию инструкций в промпт тезисов.
// Управляющие символы схлопываем в пробел, а не отвергаем: странное имя участника — не повод
// отбить всю запись.
function sanitizeName(raw: string): string {
  // deno-lint-ignore no-control-regex
  return raw.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Разбирает необязательное поле `speakers` формы meeting-ingest.
 * Нет поля / пустая строка / пустой массив → `[]` (прежнее поведение, НЕ ошибка).
 * Мусор → SpeakerTimelineError с внятным текстом и индексом сбойного интервала.
 */
export function parseSpeakerTimeline(raw: unknown): SpeakerSpan[] {
  if (raw === null || raw === undefined) return [];

  let value: unknown = raw;
  if (typeof value === "string") {
    if (value.trim().length === 0) return [];
    try {
      value = JSON.parse(value);
    } catch {
      throw new SpeakerTimelineError("speakers: invalid JSON");
    }
  }

  if (!Array.isArray(value)) {
    throw new SpeakerTimelineError("speakers: must be a JSON array of spans");
  }
  if (value.length > MAX_SPEAKER_SPANS) {
    throw new SpeakerTimelineError(
      `speakers: too many spans (${value.length} > ${MAX_SPEAKER_SPANS})`,
    );
  }

  const timeline: SpeakerSpan[] = [];
  for (let i = 0; i < value.length; i++) {
    const at = `speakers[${i}]`;
    const item: unknown = value[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new SpeakerTimelineError(`${at}: must be an object {start, end, name}`);
    }
    const span = item as Record<string, unknown>;

    if (typeof span.name !== "string") {
      throw new SpeakerTimelineError(`${at}: name must be a string`);
    }
    const name = sanitizeName(span.name);
    if (name.length === 0) {
      throw new SpeakerTimelineError(`${at}: name is empty`);
    }
    if (name.length > MAX_SPEAKER_NAME_LEN) {
      throw new SpeakerTimelineError(
        `${at}: name too long (${name.length} > ${MAX_SPEAKER_NAME_LEN})`,
      );
    }

    const start = finiteNumber(span.start);
    if (start === null) {
      throw new SpeakerTimelineError(`${at}: start must be a finite number of seconds`);
    }
    if (start < 0) {
      throw new SpeakerTimelineError(`${at}: start must not be negative`);
    }
    const end = finiteNumber(span.end);
    if (end === null) {
      throw new SpeakerTimelineError(`${at}: end must be a finite number of seconds`);
    }
    if (end <= start) {
      throw new SpeakerTimelineError(`${at}: end must be greater than start`);
    }

    timeline.push({ start, end, name });
  }
  return timeline;
}

/**
 * Кто говорил на интервале [start, end]. Побеждает наибольшее СТРОГО положительное перекрытие;
 * ничья — более ранний интервал во входе. Не нашли — null (сегмент останется с прежней меткой).
 */
export function nameAt(
  timeline: readonly SpeakerSpan[],
  start: number,
  end: number,
): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  let best: SpeakerSpan | null = null;
  let bestOverlap = 0;
  for (const span of timeline) {
    const overlap = Math.min(end, span.end) - Math.max(start, span.start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = span;
    }
  }
  if (best) return best.name;

  // Сегмент нулевой (или отрицательной) длины: перекрытие у него всегда 0, поэтому ищем интервал,
  // содержащий точку. Без этой ветки вырожденный сегмент Whisper молча терял бы имя.
  if (end <= start) {
    for (const span of timeline) {
      if (span.start <= start && start <= span.end) return span.name;
    }
  }
  return null;
}

/**
 * Сводит части транскрибации в отсортированную стенограмму. Пустой таймлайн → результат ровно тот
 * же, что был до появления говорящих: `sys` → «собеседник», `mic` → «я».
 *
 * Имя подставляется ТОЛЬКО дорожке `sys`. Дорожка `mic` — это микрофон claim_owner, то есть «я» по
 * построению (meeting-ingest отбивает чужой аплоад 403), и она авторитетнее любого таймлайна;
 * вдобавок у бота дорожки `mic` не бывает вовсе.
 */
export function buildSegments(
  parts: readonly SpeakerPart[],
  micOffset: number,
  timeline: readonly SpeakerSpan[],
): Segment[] {
  const shiftMic = Number.isFinite(micOffset) ? micOffset : 0;
  const segments: Segment[] = [];
  for (const p of parts) {
    if (!p.done || !p.segments) continue;
    const isMic = p.track === "mic";
    const shift = isMic ? shiftMic : 0;
    for (const s of p.segments) {
      // Таймлайн приходит в секундах от начала записи, а у `sys` сдвига нет — времена совпадают.
      const speaker = isMic ? LABEL_SELF : (nameAt(timeline, s.start, s.end) ?? LABEL_OTHER);
      segments.push({
        start: s.start + shift,
        end: s.end + shift,
        text: s.text,
        speaker,
      });
    }
  }
  segments.sort((a, b) => a.start - b.start);
  return segments;
}

/**
 * Легенда говорящих для промпта тезисов: объясняет модели, что означают метки в стенограмме.
 *
 * Легенда обязана описывать ровно те метки, которые в стенограмме ЕСТЬ. Обещание «я — владелец
 * записи» там, где ни одной реплики «я» нет (запись бота — только имена), сбивает атрибуцию.
 * Именованных меток нет → возвращаем прежнюю строку ДОСЛОВНО: bumblebee не должен заметить правки.
 */
export function speakerLegend(
  ownerName: string | null,
  labels: Iterable<string | undefined>,
): string {
  const present = new Set<string>();
  for (const label of labels) {
    const trimmed = (label ?? "").trim();
    if (trimmed.length > 0) present.add(trimmed);
  }
  const hasOther = present.has(LABEL_OTHER);
  const hasSelf = present.has(LABEL_SELF);
  const me = ownerName ? `«я» — это ${ownerName} (владелец записи)` : "«я» — владелец записи";

  const named = [...present].filter((l) => l !== LABEL_OTHER && l !== LABEL_SELF);
  if (named.length === 0) {
    return `Стенограмма (реплики помечены «собеседник» — другие участники, ${me}):`;
  }

  const clauses = ["реплики помечены именем говорящего"];
  if (hasOther) clauses.push("«собеседник» — участник, чьё имя не определилось");
  if (hasSelf) clauses.push(me);
  return `Стенограмма (${clauses.join("; ")}):`;
}
