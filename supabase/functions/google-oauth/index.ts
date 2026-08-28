// Google Calendar OAuth для рекордера встреч (серверная интеграция, как Granola/Read.ai).
// Поток: swarm-api /google/connect-url выдаёт подписанный state(JWT с telegram_id) →
// /start редиректит на consent Google → /callback меняет код на токены и сохраняет
// refresh_token в user_integrations(service='google_calendar'). Потом meeting-current
// по этому токену спрашивает «какая встреча идёт».
//
// Деплой: supabase functions deploy google-oauth --no-verify-jwt  (хитят браузер + Google).
// Секреты: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (+ есть WEB_JWT_SECRET, WEB_BASE_URL).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyJWT } from "../_shared/jwt.ts";
import { CALENDAR_SCOPE } from "../_shared/google-scopes.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const JWT_SECRET = Deno.env.get("WEB_JWT_SECRET") ?? "";
const WEB_BASE = Deno.env.get("WEB_BASE_URL") ?? "";
const REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/google-oauth/callback`;
// Минимальный доступ: только чтение событий календаря. Канон строки — _shared/google-scopes.ts
// (её же просит экран входа через Google, чтобы календарь привязывался одним действием).
const SCOPE = CALENDAR_SCOPE;
const enc = new TextEncoder();

async function hmacHex(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return new Response("Google OAuth не настроен (нет GOOGLE_CLIENT_ID/SECRET)", { status: 500 });
  }
  const url = new URL(req.url);
  const isCallback = url.pathname.endsWith("/callback");

  // ── /link: привязка календаря, добытая на экране ВХОДА (server-to-server) ──
  // Вход через Google просит календарный scope вместе с профилем (решение владельца 2026-08-28),
  // и refresh_token оказывается у CF Pages. Класть его в базу оттуда нельзя — SERVICE_ROLE в CF
  // не тащим, — поэтому Pages отдаёт токен сюда под HMAC(telegram_id|refresh) на общем
  // WEB_JWT_SECRET. Тот же приём, что у auth-resolve: подпись доказывает владение секретом и
  // привязана к конкретной паре, а не к «кто-то знает URL».
  if (url.pathname.endsWith("/link") && req.method === "POST") {
    if (!JWT_SECRET) return new Response("not configured", { status: 500 });
    let body: { telegram_id?: number; refresh_token?: string; sig?: string };
    try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
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

  // ── /callback: обмен кода на токены, сохранение refresh_token ──
  if (isCallback) {
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const payload = await verifyJWT(state, JWT_SECRET);
    if (!payload || !code) return new Response("invalid callback (bad state/code)", { status: 400 });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return new Response("token exchange failed: " + (await tokenRes.text()), { status: 500 });
    const tok = await tokenRes.json();
    const refresh = tok.refresh_token as string | undefined;
    if (!refresh) {
      // refresh_token приходит только при первом согласии; отзови доступ и повтори (prompt=consent уже стоит).
      return new Response("no refresh_token — отзови доступ приложения в Google и подключись заново", { status: 500 });
    }
    await supabase.from("user_integrations").upsert(
      { telegram_id: payload.telegram_id, service: "google_calendar", api_key: refresh, skipped_note_ids: [] },
      { onConflict: "telegram_id,service" },
    );
    return Response.redirect((WEB_BASE || "https://swarm-brain.pages.dev") + "/?google=connected", 302);
  }

  // ── /start: редирект на consent Google ──
  const state = url.searchParams.get("state") ?? "";
  if (!(await verifyJWT(state, JWT_SECRET))) return new Response("invalid state", { status: 400 });
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", CLIENT_ID);
  auth.searchParams.set("redirect_uri", REDIRECT_URI);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", SCOPE);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("state", state);
  return Response.redirect(auth.toString(), 302);
});
