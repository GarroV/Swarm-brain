// Кто стучится в swarm-bot: pg_cron, Telegram или никто из своих.
//
// Два источника законных запросов, и у каждого свой секрет:
// - cron (pg_cron, ручные триггеры) — заголовок X-Cron-Secret со значением CRON_SECRET;
// - Telegram — заголовок X-Telegram-Bot-Api-Secret-Token со значением TELEGRAM_WEBHOOK_SECRET.
// Решение принимается по ЗНАЧЕНИЮ секрета, а не по наличию заголовка: заголовок может
// прислать кто угодно. Запрос с X-Cron-Secret, значение которого не совпало, — отказ, в том
// числе когда у него же верный секрет Telegram: путаницы источников быть не должно.

import { timingSafeEq } from "../../_shared/timing-safe.ts";

export type RequestSource = "cron" | "telegram" | "deny";

export interface WebhookAuthConfig {
  cronSecret: string;
  webhookSecret: string;
  /** TELEGRAM_WEBHOOK_ENFORCE=1. Выключено — переходный режим, пока Telegram не узнал секрет. */
  enforce: boolean;
}

export function classifyRequest(headers: Headers, cfg: WebhookAuthConfig): RequestSource {
  const cron = headers.get("X-Cron-Secret");
  if (cron !== null) {
    return cfg.cronSecret && timingSafeEq(cron, cfg.cronSecret) ? "cron" : "deny";
  }
  if (!cfg.enforce) return "telegram";
  const provided = headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  return cfg.webhookSecret && timingSafeEq(provided, cfg.webhookSecret) ? "telegram" : "deny";
}

// Личный чат с ботом: в Telegram его chat.id совпадает с id пользователя. Токены и всё, что
// даёт доступ к аккаунту, отправляются только туда — не в группу и не в чужой чат.
export function isOwnPrivateChat(chatId: number, userId: number): boolean {
  return userId > 0 && chatId === userId;
}
