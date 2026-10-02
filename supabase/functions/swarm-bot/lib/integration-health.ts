// Состояние интеграции Granola (#175). Granola отвечала 403 SUBSCRIPTION_INACTIVE, а опрос
// превращал любой не-2xx в пустой список: «новых заметок нет», last_polled_at обновлялся, и
// мёртвая интеграция была неотличима от живой. Здесь — чистые правила; запросы и отправка —
// в handlers/granola.ts.

/** Причина сбоя одной строкой: HTTP-статус и код Granola из тела, если он есть. */
export function describeGranolaFailure(status: number, body: string): string {
  let code: string | null = null;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; error?: unknown };
    const raw = parsed.code ?? parsed.error;
    if (typeof raw === "string" && raw.trim()) code = raw.trim().slice(0, 80);
  } catch { /* не JSON — достаточно статуса */ }
  return code ? `HTTP ${status} ${code}` : `HTTP ${status}`;
}

/** Часы, когда человеку можно написать о сбое (по Белграду): ночное сообщение будит. */
export const NOTICE_FROM_HOUR = 8;
export const NOTICE_TO_HOUR = 21;

export function belgradeHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Belgrade", hour: "2-digit", hourCycle: "h23" })
      .format(now),
  );
}

export interface NoticeDecision {
  send: "broke" | "recovered" | null;
  /** Новое значение last_error_notified_at. */
  notifiedAt: string | null;
}

/**
 * Писать ли человеку. О сбое — один раз и днём: ночной сбой сообщается первым дневным опросом.
 * О восстановлении — только если о сбое сообщали (иначе «снова работает» без «сломалось»).
 */
export function decideNotice(prevNotifiedAt: string | null, nextError: string | null, now: Date): NoticeDecision {
  const hour = belgradeHour(now);
  const daytime = hour >= NOTICE_FROM_HOUR && hour < NOTICE_TO_HOUR;
  if (!nextError) {
    return { send: prevNotifiedAt && daytime ? "recovered" : null, notifiedAt: null };
  }
  if (prevNotifiedAt) return { send: null, notifiedAt: prevNotifiedAt };
  return daytime ? { send: "broke", notifiedAt: now.toISOString() } : { send: null, notifiedAt: null };
}

/** Что сказать человеку, когда импорт перестал работать. EN первым — правило интерфейса. */
export function brokeMessage(reason: string): string {
  const inactive = reason.includes("SUBSCRIPTION_INACTIVE");
  const en = inactive
    ? "Granola stopped returning notes: the workspace subscription is inactive (the public API needs a paid plan). Import is paused."
    : `Granola stopped returning notes (${reason}). Import is paused until it answers again.`;
  const ru = inactive
    ? "Granola перестала отдавать заметки: подписка рабочего пространства неактивна (публичный API — только на платном плане). Импорт остановлен."
    : `Granola перестала отдавать заметки (${reason}). Импорт стоит, пока она не ответит.`;
  return `⚠️ ${en}\n\n${ru}`;
}

export function recoveredMessage(): string {
  return "✅ Granola answers again — import resumed.\n\nGranola снова отвечает — импорт возобновлён.";
}
