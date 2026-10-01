// Google Calendar для рекордера встреч (серверная интеграция, как Granola/Read.ai).
// Здесь осталась одна ручка — POST /link: сохраняет refresh_token календаря в
// user_integrations(service='google_calendar'). Сам OAuth-поток (consent → обмен кода) живёт
// на CF Pages (miniapp/functions/api/auth/google/*): и вход через Google, и отдельная кнопка
// «Подключить календарь» (flow=calendar) — рядом с веб-сессией браузера. До 2026-09-30 у
// этой функции были ещё /start и /callback для кнопки подключения; они сняты.
// Потом meeting-current по этому токену спрашивает «какая встреча идёт».
//
// Деплой: supabase functions deploy google-oauth --no-verify-jwt  (вызывает CF Pages, не браузер).
// Секреты: WEB_JWT_SECRET (подпись /link).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const JWT_SECRET = Deno.env.get("WEB_JWT_SECRET") ?? "";
const enc = new TextEncoder();

async function hmacHex(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ── /link: привязка календаря, добытая на CF Pages (server-to-server) ──
  // Вызывают оба потока CF Pages: вход через Google (календарный scope вместе с профилем, решение
  // владельца 2026-08-28) и кнопка «Подключить календарь» (flow=calendar).
  // В обоих refresh_token оказывается у CF Pages. Класть его в базу оттуда нельзя — SERVICE_ROLE в CF
  // не тащим, — поэтому Pages отдаёт токен сюда под HMAC(telegram_id|refresh) на общем
  // WEB_JWT_SECRET. Тот же приём, что у auth-resolve: подпись доказывает владение секретом и
  // привязана к конкретной паре, а не к «кто-то знает URL».
  if (url.pathname.endsWith("/link") && req.method === "POST") {
    if (!JWT_SECRET) return new Response("not configured", { status: 500 });
    let body: { telegram_id?: number; refresh_token?: string; sig?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const tgId = body.telegram_id;
    const refresh = (body.refresh_token ?? "").trim();
    if (typeof tgId !== "number" || !Number.isFinite(tgId) || !refresh || !body.sig) {
      return new Response("bad request", { status: 400 });
    }
    if (!timingSafeEq(body.sig, await hmacHex(`${tgId}|${refresh}`))) {
      return new Response("forbidden", { status: 403 });
    }
    const { error } = await supabase.from("user_integrations").upsert(
      { telegram_id: tgId, service: "google_calendar", api_key: refresh, skipped_note_ids: [] },
      { onConflict: "telegram_id,service" },
    );
    if (error) {
      console.error("google-oauth /link: не сохранил refresh", tgId, error.message);
      return new Response("db", { status: 500 });
    }
    console.log(`google-oauth /link: календарь привязан на входе, telegram_id=${tgId}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  return new Response("Not found", { status: 404 });
});
