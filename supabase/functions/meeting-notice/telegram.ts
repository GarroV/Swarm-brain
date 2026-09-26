// Отправка уведомления в Telegram — с ПРОВЕРКОЙ результата.
//
// Вынесено из index.ts отдельным модулем ровно затем, чтобы это можно было проверить тестом:
// в index.ts живёт Deno.serve, и импортировать его из теста нельзя.
//
// Остальной код продукта шлёт в Telegram и на ответ не смотрит. Для уведомления о сбое так
// нельзя: недоставленное сообщение о том, что запись не идёт, и есть молчаливый отказ — причём
// вдвойне, потому что оно молчит о молчании.
//
// Успехом считается ТОЛЬКО `{"ok": true}` в теле. Не «не пришёл ok: false», а именно ok: true:
// Telegram умеет ответить 200 с телом, которое не разбирается (прокси, обрезанный ответ,
// HTML-заглушка шлюза), и тогда проверка «ok !== false» пропускала недоставленное сообщение
// как доставленное.
export interface TelegramSenderConfig {
  botToken: string;
  /** База API. Подменяется смоуком блока, чтобы прогон отказов не стучался в живой Telegram. */
  apiBase: string;
  /** Точка подмены для теста; в проде — глобальный fetch. */
  fetchImpl?: typeof fetch;
}

export type TelegramSender = (chatId: number, text: string) => Promise<void>;

export function makeTelegramSender(config: TelegramSenderConfig): TelegramSender {
  const doFetch = config.fetchImpl ?? fetch;
  return async (chatId: number, text: string): Promise<void> => {
    if (config.botToken === "") throw new Error("TELEGRAM_BOT_TOKEN is not set on the server");
    const res = await doFetch(`${config.apiBase}/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    let body: { ok?: unknown; description?: unknown } | null = null;
    try {
      body = (await res.json()) as { ok?: unknown; description?: unknown };
    } catch {
      body = null;
    }

    if (body === null) {
      throw new Error(`telegram ${res.status}: ответ не разобран — считать сообщение доставленным нельзя`);
    }
    if (body.ok !== true) {
      const description = typeof body.description === "string" ? body.description : "no description in response";
      throw new Error(`telegram ${res.status}: ${description}`);
    }
  };
}
