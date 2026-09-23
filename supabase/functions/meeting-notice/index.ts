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
// Сколько раз: считает СЕРВЕР по журналу `meeting_notices` (ключ встречи + получатель), а не бот
// по присланному числу. Дверь — первое уведомление и ровно один повтор, остальные виды — по
// одному на встречу, сверху общий потолок. Исчерпано → 409 и `should_leave: true`.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN,
//      TELEGRAM_API_BASE (необязательная, по умолчанию https://api.telegram.org — подменяется
//      только смоуком блока, чтобы прогон отказов не стучался в живой Telegram).
// Деплой: supabase functions deploy meeting-notice --no-verify-jwt (бот хитит с Bearer-токеном).
//
// URL-импорты — канон этого репозитория: функции деплоятся без карты импортов.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleNotice } from "./handle.ts";
import { makeTelegramSender } from "./telegram.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const sendTelegram = makeTelegramSender({
  botToken: Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "",
  apiBase: Deno.env.get("TELEGRAM_API_BASE") ?? "https://api.telegram.org",
});

Deno.serve((req: Request) => handleNotice(req, { supabase, sendTelegram }));
