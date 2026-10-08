/**
 * Срочное предупреждение владельцу через канал FURCA (#861, решение владельца 08.10.2026).
 *
 * Адресат — только владелец: канал FURCA пишет одному человеку, в его Telegram. Текст, адресат и
 * условие утверждены владельцем 08.10.2026; менять их — снова через его «да» (глобальное правило
 * «никакой коммуникации без владельца»).
 */
import type { AudioState } from "./state-line.ts";

const PLATFORM_LABEL: Readonly<Record<string, string>> = { kontur: "Толк", meet: "Meet" };
const UNTITLED = "встреча без названия";
const CHANNEL_PROJECT = "scriba";

export interface SilenceAlertInput {
  readonly audio: AudioState;
  readonly title: string | undefined;
  readonly platform: string | undefined;
  readonly runId: string;
}

export function silenceAlertText(input: SilenceAlertInput): string {
  const title = input.title ?? UNTITLED;
  if (input.audio === "back") return `✅ Scriba: звук в «${title}» вернулся.`;
  const platform = PLATFORM_LABEL[input.platform ?? ""] ?? input.platform ?? "площадка неизвестна";
  return (
    `⚠️ Scriba: в звонке «${title}» (${platform}) 3 мин нет звука, ` +
    `запись сейчас пишет тишину. Запуск ${input.runId}.`
  );
}

export interface ChannelAlertOptions {
  readonly url: string;
  readonly secret: string;
  readonly fetch?: typeof fetch;
}

/**
 * Отправка в канал FURCA: `POST /notify` с `kind: "alert"`. Не 2xx — исключение с кодом ответа,
 * вызывающий пишет его в журнал.
 */
export function channelAlert(options: ChannelAlertOptions): (text: string) => Promise<void> {
  const send = options.fetch ?? fetch;
  const endpoint = new URL("notify", options.url.endsWith("/") ? options.url : `${options.url}/`)
    .href;
  return async (text): Promise<void> => {
    const response = await send(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ project: CHANNEL_PROJECT, kind: "alert", text }),
    });
    if (!response.ok) throw new Error(`канал FURCA ответил ${String(response.status)}`);
  };
}
