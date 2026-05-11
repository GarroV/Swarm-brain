import { supabase, ADMIN_USER_ID } from "./supabase.ts";
import { sendMessage } from "./telegram.ts";

const READ_AI_TOKEN_URL = "https://authn.read.ai/oauth2/token";
export const READ_AI_API = "https://api.read.ai/v1";
export const READ_AI_AUTH_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/read-ai-auth?start=1";

export async function getReadAiToken(): Promise<string | null> {
  const { data } = await supabase.from("oauth_tokens").select("*").eq("service", "read_ai").maybeSingle();
  if (!data?.access_token) return null;

  if (new Date(data.expires_at) > new Date(Date.now() + 60_000)) return data.access_token;

  const res = await fetch(READ_AI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      client_id: data.client_id,
    }),
  });
  const tokenData = await res.json();
  if (!res.ok) {
    await sendMessage(ADMIN_USER_ID, `⚠️ <b>Read.ai отключился</b> — токен истёк и не обновился.\n\nНажми /connect чтобы переподключить.`);
    return null;
  }

  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 600) * 1000).toISOString();
  await supabase.from("oauth_tokens").update({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? data.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq("service", "read_ai");

  return tokenData.access_token;
}

export async function readAiGet(path: string): Promise<unknown> {
  const token = await getReadAiToken();
  if (!token) throw new Error("Read.ai не подключён. Используй /connect");
  const res = await fetch(`${READ_AI_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { message?: string }).message ?? "Read.ai API error");
  return data;
}
