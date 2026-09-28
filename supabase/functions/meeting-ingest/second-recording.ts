// Вторая запись одной встречи (T156). Бот scriba и рекордер bumblebee ОДНОГО человека пишут одну
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
}

export function decideUpload(ctx: UploadContext): UploadDecision {
  const seen = ctx.sources !== null && ctx.sources.includes(ctx.incoming);
  if (ctx.summaryStatus === "processing" || ctx.summaryStatus === "done") {
    // Старая форма состояния: чья выгрузка — неизвестно, повтор bumblebee нельзя принять за вторую
    // запись (одно аудио ушло бы в Whisper дважды). Поведение ровно прежнее.
    if (ctx.sources === null || seen) return "already_processed";
    return ctx.summaryStatus === "processing" ? "queue" : "challenge";
  }
  // failed / null. Повтор того же источника после сбоя перерабатывается как раньше; сравнивать
  // есть с чем, только если стенограмма осталась (упали тезисы; claim обнулил маркеры перехватом).
  if (seen || !ctx.hasTranscript) return "process";
  return "challenge";
}
