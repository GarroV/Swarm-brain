// Отметка «клиент интеграции реально обращался к серверу» (issue #921). Карточки в вебе
// («Claude Desktop», «Рекордер») по ней отличают живое подключение от просто выпущенного токена:
// после переезда сервера клиенты ходят на старый адрес, а токен при этом «активен».
//
// Пишем не чаще раза в CLIENT_SEEN_MIN_INTERVAL_MS: токен проверяется на каждом запросе, а
// пульс рекордера идёт часто — без прореживания это лишняя запись на каждый вызов.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SeenClient = "mcp" | "recorder";

export const CLIENT_SEEN_COLUMN: Record<SeenClient, string> = {
  mcp: "mcp_last_seen_at",
  recorder: "recorder_last_seen_at",
};

export const CLIENT_SEEN_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Помечает обращение клиента. Ошибка записи НЕ роняет запрос: отметка — справочная,
 * а запрос человека важнее; причину пишем в лог, а не глотаем.
 */
export async function markClientSeen(
  supabase: SupabaseClient,
  telegramId: number,
  client: SeenClient,
  now: Date = new Date(),
): Promise<void> {
  const column = CLIENT_SEEN_COLUMN[client];
  const threshold = new Date(now.getTime() - CLIENT_SEEN_MIN_INTERVAL_MS).toISOString();
  try {
    const { error } = await supabase
      .from("allowed_users")
      .update({ [column]: now.toISOString() })
      .eq("telegram_id", telegramId)
      .or(`${column}.is.null,${column}.lt.${threshold}`);
    if (error) console.warn(`client-seen: не удалось записать ${column} для ${telegramId}: ${error.message}`);
  } catch (e) {
    console.warn(`client-seen: не удалось записать ${column} для ${telegramId}: ${e instanceof Error ? e.message : e}`);
  }
}
