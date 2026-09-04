"use client";
import { useDt } from "@/components/roy/nav";
import type { Me } from "@/types";

/**
 * Панель плитки Telegram. Кнопки привязки пока НЕТ: слияние личности (issue #92) ещё не сделано,
 * а рисовать кнопку, которая ничего не делает, хуже, чем честно сказать, как обстоит дело.
 * Плитка при этом показывается всем: состояние правдиво и сейчас — у веб-личности id отрицательный.
 */
export function TelegramPanel({ me }: { me: Me }) {
  const dt = useDt();
  const linked = me.telegram_id > 0;

  if (linked) {
    return (
      <p className="text-sm text-muted-foreground">
        {dt(
          "Telegram привязан — приходят уведомления, работает бот и запись встреч.",
          "Telegram is linked — notifications, the bot and meeting recording all work.",
        )}
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      {dt(
        "Вход в систему сделан по e-mail, без Telegram: уведомления не приходят и бот недоступен. Кнопка привязки готовится; пока привязать может администратор.",
        "You signed in by e-mail, without Telegram: notifications don't arrive and the bot is unavailable. A link button is on the way; for now an admin can link it for you.",
      )}
    </p>
  );
}
