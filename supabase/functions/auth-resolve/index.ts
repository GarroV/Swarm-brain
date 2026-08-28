// auth-resolve — server-to-server резолв verified email → личность (для CF google-login).
// Аутентификация ВЫЗОВА (не пользователя): HMAC(email) на WEB_JWT_SECRET, общий с CF Pages.
// Возвращает allowed_users по email (lower). Деплой: supabase functions deploy auth-resolve --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type GoogleName, nameSigPayload, profileNameUpdate } from "../_shared/google-profile.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WEB_JWT_SECRET = Deno.env.get("WEB_JWT_SECRET") ?? "";
const enc = new TextEncoder();

async function hmacHex(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(WEB_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!WEB_JWT_SECRET) return json({ error: "not configured" }, 500);
  let body: { email?: string; sig?: string; given_name?: string; family_name?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const email = (body.email ?? "").toLowerCase().trim();
  const sig = body.sig ?? "";
  if (!email || !sig) return json({ error: "bad request" }, 400);
  // Доказательство владения WEB_JWT_SECRET, привязанное к конкретному email.
  // Два контракта подписи: email|given|family (несёт имя из Google) и голый email (старый CF Pages).
  // Обе стороны деплоятся не атомарно, поэтому старая подпись остаётся валидной — иначе вход ляжет
  // на время между раскаткой функции и раскаткой Pages. Имя принимается ТОЛЬКО при новой подписи:
  // с голым email его можно было бы подменить реплеем.
  const claimedName: GoogleName = { given: body.given_name, family: body.family_name };
  const nameSigned = timingSafeEq(sig, await hmacHex(nameSigPayload(email, claimedName)));
  if (!nameSigned && !timingSafeEq(sig, await hmacHex(email))) return json({ error: "forbidden" }, 403);
  const trustedName: GoogleName = nameSigned ? claimedName : {};

  // email хранится в lower (бэкфилл + запись админкой); уникальный индекс по lower(email).
  const { data, error } = await supabase
    .from("allowed_users")
    .select("id, telegram_id, group_id")
    .eq("email", email)
    .maybeSingle();
  if (error) return json({ error: "db" }, 500);
  if (!data) return json({ found: false });
  const row = data as { id: number; telegram_id: number | null; group_id: string | null };

  // email-only приглашение (админ добавил почту, без Telegram): у строки telegram_id=NULL.
  // Веб/апп всё идентифицирует по telegram_id, поэтому выдаём ДЕТЕРМИНИРОВАННУЮ синтетическую
  // идентичность = -id (реальные Telegram id положительные → коллизий нет; без последовательностей).
  // Присваиваем атомарно (update ... where telegram_id is null) — идемпотентно и без гонки; заводим
  // минимальный профиль (имя = локальная часть email), не перетирая существующий.
  let telegramId = row.telegram_id;
  if (telegramId == null) {
    const synthetic = -row.id;
    const { data: upd } = await supabase
      .from("allowed_users")
      .update({ telegram_id: synthetic })
      .eq("id", row.id).is("telegram_id", null)
      .select("telegram_id").maybeSingle();
    telegramId = (upd as { telegram_id: number | null } | null)?.telegram_id ?? null;
    if (telegramId == null) {
      // гонка: кто-то присвоил первым — перечитываем актуальный telegram_id
      const { data: re } = await supabase
        .from("allowed_users").select("telegram_id").eq("id", row.id).maybeSingle();
      telegramId = (re as { telegram_id: number | null } | null)?.telegram_id ?? null;
    }
    if (telegramId != null) {
      // Имя из Google лучше локальной части email («v.garro»), но она остаётся резервом:
      // человек мог не дать scope profile или не иметь имени в аккаунте.
      const seed = profileNameUpdate(null, trustedName) ?? { first_name: email.split("@")[0] };
      await supabase.from("user_profiles").upsert(
        { telegram_id: telegramId, ...seed },
        { onConflict: "telegram_id", ignoreDuplicates: true },
      );
    }
  }

  // Дозаполняем имя при каждом входе: пустые поля — из Google, заполненные руками не трогаем.
  // Раньше first_name не писал никто автоматически, и дефолтному названию записи без календаря
  // (#184) было нечего подставлять.
  if (telegramId != null) {
    const { data: prof } = await supabase
      .from("user_profiles").select("first_name, last_name").eq("telegram_id", telegramId).maybeSingle();
    const upd = profileNameUpdate(prof as { first_name?: string | null; last_name?: string | null } | null, trustedName);
    if (upd) {
      const { error: profErr } = await supabase
        .from("user_profiles").upsert({ telegram_id: telegramId, ...upd }, { onConflict: "telegram_id" });
      // Профиль — не причина не пустить человека в продукт: логируем и идём дальше.
      if (profErr) console.error("auth-resolve: профиль не обновлён", telegramId, profErr.message);
    }
  }

  return json({ found: true, id: row.id, telegram_id: telegramId, group_id: row.group_id });
});
