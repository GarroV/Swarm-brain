// Вторая запись одной встречи (T156). Бот встреч и рекордер bumblebee ОДНОГО человека пишут одну
// встречу: meeting-claim склеивает их по составу, claim_owner у обоих один — и выгружают оба.
// Раньше вторая выгрузка получала already_processed, то есть в базе оставалась та, что пришла
// ПЕРВОЙ, — ровно правило «кто первый», за которое проект уже платил (#23/#24, #176).
//
// Теперь вторая запись ДРУГОГО источника не выбрасывается: её тоже транскрибируют (двойную
// оплату OpenAI на время бок о бок владелец согласовал, D006) и в конце сравнивают объём
// распознанного с текущей стенограммой (`_shared/meeting-fullness.ts`, канон публикации).
// Стенограмма заменяется целиком или не трогается вовсе — две записи в ней не смешиваются.
//
// Источник — не токен и не клиент, а «кто пишет»: у человека рекордер один (сменная сборка,
// повтор выгрузки и прошлый токен — тот же источник), агент различается по своему id. Человек в
// источнике обязателен: право на встречу может перейти к другому участнику, пока первая запись
// ещё обрабатывается, и без него запись другого человека выглядела бы повтором чужой выгрузки.

export type UploadDecision =
  /** Обычная обработка — как было всегда. */
  | "process"
  /** Та же выгрузка ещё раз (ретрай клиента) — второй обработки нет. */
  | "already_processed"
  /** Первая запись ещё обрабатывается — вторая ждёт в очереди и сравнится, когда та закончит. */
  | "queue"
  /** Стенограмма уже есть — обработать вторую запись и оставить более полную. */
  | "challenge";

export function uploadSource(identity: { kind: string; agentId?: string; telegramId: number }): string {
  return identity.kind === "bot"
    ? `agent:${identity.agentId ?? "?"}:${identity.telegramId}`
    : `person:${identity.telegramId}`;
}

export interface UploadContext {
  summaryStatus: string | null;
  /**
   * Источники, чьи выгрузки встреча уже приняла (`process_state.sources`). null — состояния нет
   * или оно старой формы, без записи об источнике.
   */
  sources: readonly string[] | null;
  /** Есть ли у встречи непустая стенограмма. */
  hasTranscript: boolean;
  incoming: string;
  /**
   * Длина входящего аудио, измеренная сервером (audio-length.ts); null — не измерено, не задано —
   * не мерили. Нужна только готовой встрече и источнику, уже бывшему у неё (см. isNewRecording).
   */
  incomingSeconds?: number | null;
  /** Конец текущей стенограммы, с (transcriptEndSec); null — не определён. */
  transcriptSeconds?: number | null;
}

// Новая запись того же источника против повтора её выгрузки (#1271). Клиенты шлют только аудио:
// ни id записи, ни хеша, ни времени начала в выгрузке нет, а рекордер новых полей до выпуска
// сборки не получит. Единственный признак, который есть у раскатанных клиентов, — длина самого
// аудио, измеренная сервером: повтор выгрузки той же записи равен по длине стенограмме, которую
// она дала (с хвостом тишины после последней реплики), а запись, продолженная после первой
// выгрузки, заметно длиннее. Порог — по большему из доли и абсолютного запаса, чтобы тишина в
// конце не принимала повтор за новую запись; ложная «новая» стоит лишнего прогона распознавания
// (арбитр оставит прежнюю версию), ложный «повтор» — потерянной записи.
export const NEW_RECORDING_RATIO = 1.15;
export const NEW_RECORDING_MIN_EXTRA_SEC = 90;

export function isNewRecording(incomingSec: number, transcriptEndSec: number): boolean {
  return incomingSec > Math.max(transcriptEndSec * NEW_RECORDING_RATIO, transcriptEndSec + NEW_RECORDING_MIN_EXTRA_SEC);
}

/** Конец стенограммы — максимум `end` по сегментам; сегментов с числовым концом нет — null. */
export function transcriptEndSec(t: { segments?: Array<{ end?: unknown }> | null } | null): number | null {
  let end: number | null = null;
  for (const s of t?.segments ?? []) {
    const v = s?.end;
    if (typeof v === "number" && Number.isFinite(v) && (end === null || v > end)) end = v;
  }
  return end;
}

/** Нужно ли измерять входящее аудио до решения: только повтор источника к уже готовой встрече. */
export function needsLengthCheck(ctx: Pick<UploadContext, "summaryStatus" | "sources" | "incoming">): boolean {
  return ctx.summaryStatus === "done" && ctx.sources !== null && ctx.sources.includes(ctx.incoming);
}

export function decideUpload(ctx: UploadContext): UploadDecision {
  const seen = ctx.sources !== null && ctx.sources.includes(ctx.incoming);
  if (ctx.summaryStatus === "processing" || ctx.summaryStatus === "done") {
    // Старая форма состояния: чья выгрузка — неизвестно, повтор bumblebee нельзя принять за вторую
    // запись (одно аудио ушло бы в Whisper дважды). Поведение ровно прежнее.
    if (ctx.sources === null) return "already_processed";
    if (seen) {
      // Готовая встреча: повтор выгрузки или новая запись того же источника (#1271). Аудио, которое
      // сервер не смог измерить, — не запись, которую клиенты льют (оба пишут разбираемый AAC в
      // MP4): как и прежде, это повтор. Стенограмму нечем измерить, а аудио настоящее — безопасная
      // сторона: вторая запись, её увидит арбитр, а не молчаливая потеря.
      if (ctx.summaryStatus === "done") {
        const { incomingSeconds: inc, transcriptSeconds: tr } = ctx;
        if (typeof inc !== "number") return "already_processed";
        return typeof tr === "number" && !isNewRecording(inc, tr) ? "already_processed" : "challenge";
      }
      return "already_processed";
    }
    return ctx.summaryStatus === "processing" ? "queue" : "challenge";
  }
  // failed / null. Повтор того же источника после сбоя перерабатывается как раньше; сравнивать
  // есть с чем, только если стенограмма осталась (упали тезисы; claim обнулил маркеры перехватом).
  if (seen || !ctx.hasTranscript) return "process";
  return "challenge";
}
