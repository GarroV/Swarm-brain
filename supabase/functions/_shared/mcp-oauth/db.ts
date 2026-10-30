import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ACCESS_PREFIX, OAuthError, sha256 } from "./rules.ts";

export type OAuthDb = SupabaseClient;

export async function rpc<T>(db: OAuthDb, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    console.error("MCP OAuth database operation failed:", name, error.code);
    throw new OAuthError("temporarily_unavailable", "Authorization service unavailable", 503);
  }
  return data as T;
}

export interface OAuthIdentity {
  telegramId: number;
  groupId: string;
  connectionId: string;
  tokenHash: string;
}

export async function resolveOAuthAccessToken(
  db: OAuthDb,
  token: string,
  expectedResource: string,
): Promise<OAuthIdentity | null> {
  if (!new RegExp(`^${ACCESS_PREFIX}[A-Za-z0-9_-]{43}$`).test(token)) return null;
  const tokenHash = await sha256(token);
  const result = await rpc<Omit<OAuthIdentity, "tokenHash"> | null>(db, "mcp_oauth_resolve", {
    p_token_hash: tokenHash,
    p_resource: expectedResource,
  });
  if (!result || !Number.isSafeInteger(result.telegramId) || !result.groupId || !result.connectionId) return null;
  return { ...result, tokenHash };
}

export async function takeRate(db: OAuthDb, req: Request, category: string): Promise<void> {
  // Address headers are only a secondary throttle. The global bound cannot be evaded by spoofing them.
  const address = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown").slice(
    0,
    256,
  );
  const addressHash = (await sha256(address)).slice(0, 32);
  const registration = category === "register";
  const seconds = registration ? 3600 : 60;
  for (
    const [bucket, limit] of [[`${category}:global`, registration ? 1000 : 6000], [
      `${category}:addr:${addressHash}`,
      registration ? 30 : 120,
    ]] as const
  ) {
    const allowed = await rpc<boolean>(db, "mcp_oauth_take_rate", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: seconds,
    });
    if (!allowed) throw new OAuthError("slow_down", "Too many requests; try again later", 429);
  }
}

export function checkDb(error: { code?: string } | null): void {
  if (error) {
    console.error("MCP OAuth database operation failed:", error.code);
    throw new OAuthError("temporarily_unavailable", "Authorization service unavailable", 503);
  }
}
