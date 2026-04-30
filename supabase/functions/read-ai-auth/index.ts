import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDIRECT_URI = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/read-ai-auth";
const CLIENT_REG_URL = "https://api.read.ai/oauth/register";
const TOKEN_URL = "https://authn.read.ai/oauth2/token";
const AUTH_URL = "https://authn.read.ai/oauth2/auth";
const PRECONFIGURED_CLIENT_ID = Deno.env.get("READ_AI_CLIENT_ID");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function randomBase64Url(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function sha256Base64Url(plain: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function htmlPage(title: string, message: string, color = "#22c55e"): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Swarm Brain</title></head>
<body style="font-family:system-ui;text-align:center;padding:60px;color:#1a1a1a">
<h2 style="color:${color}">${title}</h2><p>${message}</p></body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return htmlPage("❌ Ошибка авторизации", `Read.ai вернул ошибку: ${error}`, "#ef4444");
  }

  // ── Step 1: Start OAuth ────────────────────────────────────────────────────
  if (start === "1") {
    let clientId: string | undefined = PRECONFIGURED_CLIENT_ID;

    if (!clientId) {
      const { data: existing } = await supabase
        .from("oauth_tokens").select("client_id").eq("service", "read_ai").maybeSingle();
      clientId = existing?.client_id;
    }

    if (!clientId) {
      const regRes = await fetch(CLIENT_REG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [REDIRECT_URI],
          client_name: "Swarm Brain Bot",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) {
        return htmlPage(
          "❌ Ошибка регистрации",
          `Read.ai не поддерживает автоматическую регистрацию.<br><br>` +
          `Добавь переменную <b>READ_AI_CLIENT_ID</b> в Supabase Secrets.<br><br>` +
          `<small style="color:#888">${JSON.stringify(regData)}</small>`,
          "#ef4444"
        );
      }
      clientId = regData.client_id as string;
      await supabase.from("oauth_tokens").upsert({ service: "read_ai", client_id: clientId });
    }

    const codeVerifier = randomBase64Url(32);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const stateParam = randomBase64Url(16);

    await supabase.from("oauth_state").upsert({
      state: stateParam,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", stateParam);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    return Response.redirect(authUrl.toString(), 302);
  }

  // ── Step 2: OAuth callback ─────────────────────────────────────────────────
  if (code && state) {
    const { data: stateRow } = await supabase
      .from("oauth_state").select("*").eq("state", state).maybeSingle();

    if (!stateRow) {
      return htmlPage("❌ Ошибка", "Неверный или просроченный state. Попробуй /connect снова.", "#ef4444");
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: stateRow.client_id,
        code_verifier: stateRow.code_verifier,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return htmlPage("❌ Ошибка токена", JSON.stringify(tokenData), "#ef4444");
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 600) * 1000).toISOString();
    await supabase.from("oauth_tokens").upsert({
      service: "read_ai",
      client_id: stateRow.client_id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });

    await supabase.from("oauth_state").delete().eq("state", state);

    return htmlPage(
      "✅ Read.ai подключён!",
      "Можешь закрыть эту страницу и вернуться в Telegram.<br><br><small style='color:#888'>Бот теперь может забирать транскрипции встреч.</small>"
    );
  }

  return new Response("Not found", { status: 404 });
});
