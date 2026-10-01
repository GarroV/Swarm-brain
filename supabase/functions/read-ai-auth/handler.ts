// read-ai-auth: OAuth-подключение Read.ai (общий токен бота, oauth_tokens.service='read_ai').
//
// Read.ai не используется, поэтому функция ВЫКЛЮЧЕНА по умолчанию: пока READ_AI_AUTH_ENABLED
// не равно "true", любой запрос получает 403 и ничего не читает и не пишет. Включать только на
// время переподключения и выключать сразу после. Переменная своя, отдельная от READ_AI_ENABLED
// (вебхук): включение приёма вебхуков не должно открывать подключение заново.
//
// Когда включено: state одноразовый (снимается из oauth_state до обмена кода) и живёт
// STATE_TTL_MS; всё, что попадает в HTML, экранируется.
export const STATE_TTL_MS = 10 * 60 * 1000;

const CLIENT_REG_URL = "https://api.read.ai/oauth/register";
const TOKEN_URL = "https://authn.read.ai/oauth2/token";
const AUTH_URL = "https://authn.read.ai/oauth2/auth";

export type StateRow = { client_id: string; code_verifier: string; created_at: string | null };

export interface ReadAiAuthStore {
  getClientId(): Promise<string | null>;
  saveClientId(clientId: string): Promise<void>;
  saveState(row: { state: string; client_id: string; code_verifier: string }): Promise<void>;
  // Читает и тут же удаляет state: повторно один и тот же state не принимается.
  takeState(state: string): Promise<StateRow | null>;
  saveToken(row: Record<string, unknown>): Promise<void>;
}

export interface ReadAiAuthDeps {
  enabled: boolean;
  clientId: string | undefined;
  redirectUri: string;
  now: () => number;
  store: ReadAiAuthStore;
  fetch: typeof fetch;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// title/message — обычный текст: экранируется здесь, разметку снаружи сюда не передают.
function htmlPage(title: string, message: string, status = 200, color = "#22c55e", note = ""): Response {
  const noteHtml = note ? `<p><small style="color:#888">${escapeHtml(note)}</small></p>` : "";
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Swarm Brain</title></head>
<body style="font-family:system-ui;text-align:center;padding:60px;color:#1a1a1a">
<h2 style="color:${color}">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>${noteHtml}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

const errorPage = (title: string, message: string, status: number, note = "") =>
  htmlPage(title, message, status, "#ef4444", note);

function randomBase64Url(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function sha256Base64Url(plain: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function isStateFresh(row: StateRow, now: number): boolean {
  if (!row.created_at) return false;
  const created = Date.parse(row.created_at);
  if (!Number.isFinite(created)) return false;
  const age = now - created;
  return age >= 0 && age <= STATE_TTL_MS;
}

async function resolveClientId(deps: ReadAiAuthDeps): Promise<{ clientId: string } | { error: Response }> {
  const known = deps.clientId || await deps.store.getClientId();
  if (known) return { clientId: known };
  const regRes = await deps.fetch(CLIENT_REG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [deps.redirectUri],
      client_name: "Swarm Brain Bot",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const regData = await regRes.json().catch(() => ({}));
  if (!regRes.ok || typeof regData?.client_id !== "string") {
    return {
      error: errorPage(
        "❌ Ошибка регистрации",
        "Read.ai не поддерживает автоматическую регистрацию. Добавь READ_AI_CLIENT_ID в Supabase Secrets.",
        502,
        JSON.stringify(regData),
      ),
    };
  }
  await deps.store.saveClientId(regData.client_id);
  return { clientId: regData.client_id };
}

async function startFlow(deps: ReadAiAuthDeps): Promise<Response> {
  const resolved = await resolveClientId(deps);
  if ("error" in resolved) return resolved.error;
  const codeVerifier = randomBase64Url(32);
  const stateParam = randomBase64Url(32);
  await deps.store.saveState({ state: stateParam, client_id: resolved.clientId, code_verifier: codeVerifier });

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", resolved.clientId);
  authUrl.searchParams.set("redirect_uri", deps.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", stateParam);
  authUrl.searchParams.set("code_challenge", await sha256Base64Url(codeVerifier));
  authUrl.searchParams.set("code_challenge_method", "S256");
  return Response.redirect(authUrl.toString(), 302);
}

async function finishFlow(deps: ReadAiAuthDeps, code: string, state: string): Promise<Response> {
  const stateRow = await deps.store.takeState(state);
  if (!stateRow || !isStateFresh(stateRow, deps.now())) {
    return errorPage("❌ Ошибка", "Неверный или просроченный state. Начни подключение заново.", 400);
  }

  const tokenRes = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: deps.redirectUri,
      client_id: stateRow.client_id,
      code_verifier: stateRow.code_verifier,
    }),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || typeof tokenData?.access_token !== "string") {
    return errorPage("❌ Ошибка токена", "Read.ai не выдал токен.", 502, JSON.stringify(tokenData));
  }

  const nowIso = new Date(deps.now()).toISOString();
  await deps.store.saveToken({
    service: "read_ai",
    client_id: stateRow.client_id,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: new Date(deps.now() + (tokenData.expires_in ?? 600) * 1000).toISOString(),
    updated_at: nowIso,
  });
  return htmlPage(
    "✅ Read.ai подключён!",
    "Можешь закрыть эту страницу и вернуться в Telegram. Бот теперь может забирать транскрипции встреч.",
  );
}

export function handleReadAiAuth(req: Request, deps: ReadAiAuthDeps): Promise<Response> | Response {
  // Выключатель — первым делом, до разбора параметров: в выключенном виде ответ не зависит от запроса.
  if (!deps.enabled) return new Response("Read.ai auth is disabled", { status: 403 });

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return errorPage("❌ Ошибка авторизации", `Read.ai вернул ошибку: ${error}`, 400);

  if (url.searchParams.get("start") === "1") return startFlow(deps);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code && state) return finishFlow(deps, code, state);

  return new Response("Not found", { status: 404 });
}
