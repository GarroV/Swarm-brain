// Сообщение человеку «по инициативе бота» из swarm-bot: вне комендантского часа уходит сразу,
// в 23:00–9:00 по Москве — в очередь `telegram_outbox` до утра (_shared/notify-person.ts).
// Тело то же, что у sendMessage/sendInlineMessage из lib/telegram.ts (HTML, опционально inline-
// клавиатура): меняется только момент отправки. Ответы на сообщение или кнопку человека сюда не
// идут — они остаются на sendMessage и уходят сразу. Недоставка — исключение, как у sendMessage.
import { supabase } from "./supabase.ts";
import { notifyPerson, type NotifyResult } from "../../_shared/notify-person.ts";

export function notifyMessage(
  recipientId: number,
  text: string,
  kind: string,
  keyboard?: unknown[][],
): Promise<NotifyResult> {
  return notifyPerson(supabase, {
    recipientId,
    kind,
    payload: {
      text,
      parse_mode: "HTML",
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    },
  });
}
