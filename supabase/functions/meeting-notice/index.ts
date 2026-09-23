// meeting-notice — громкий отказ доходит до человека. Единственная поверхность блока notices.
//
// Зачем эндпоинт вообще: бот scriba живёт в контейнере и токена Telegram не имеет (и не должен —
// секрет остаётся на сервере). Поэтому «меня не впустили», «звука нет», «контейнер умер» бот
// приносит сюда, а сервер отправляет владельцу встречи в тот же Telegram, которым уже пользуется
// meeting-processor. Существующие эндпоинты при этом не трогаются (принцип «конвейер неприкосновенен»).
//
// Кому уходит сообщение: identity.telegramId из resolveActingIdentity — ВСЕГДА человек, и он
// никогда не берётся из тела запроса. Иначе токен бота стал бы средством рассылки по людям.
//
// Дверь: attempt 1 — первое уведомление (через 90 с), attempt 2 — единственный повтор (через 3 мин),
// attempt 3 → 409 и ничего не отправлено. Ответ ведёт бота: should_leave / next_reminder_in_s.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN,
//      TELEGRAM_API_BASE (необязательная, по умолчанию https://api.telegram.org — подменяется
//      только смоуком блока, чтобы прогон отказов не стучался в живой Telegram).
// Деплой: supabase functions deploy meeting-notice --no-verify-jwt (бот хитит с Bearer-токеном).
//
// URL-импорты — канон этого репозитория: функции деплоятся без карты импортов.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleNotice } from "./handle.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_API_BASE = Deno.env.get("TELEGRAM_API_BASE") ?? "https://api.telegram.org";

/**
 * Отправка с ПРОВЕРКОЙ результата.
 *
 * Остальной код продукта шлёт в Telegram и не смотрит на ответ — для уведомления о сбое так
 * нельзя: недоставленное сообщение о том, что запись не идёт, и есть молчаливый отказ.
 * Поэтому здесь бросаем и на HTTP-код, и на `ok: false` в теле (Telegram умеет отвечать 200
 * с отказом внутри), и на отсутствующий токен — тоже бросаем, а не выходим тихо.
 */
async function sendTelegram(chatId: number, text: string): Promise<void> {
  if (TELEGRAM_BOT_TOKEN === "") throw new Error("TELEGRAM_BOT_TOKEN is not set on the server");
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  let body: { ok?: boolean; description?: string } = {};
  try {
    body = (await res.json()) as { ok?: boolean; description?: string };
  } catch {
    body = {};
  }
  if (!res.ok || body.ok === false) {
    throw new Error(`telegram ${res.status}: ${body.description ?? "no description in response"}`);
  }
}

Deno.serve((req: Request) => handleNotice(req, { supabase, sendTelegram }));
