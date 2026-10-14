// Ключ к нейронке у пространства (#233, этап 1). Только добавляем: ни один существующий потребитель
// OPENAI_API_KEY пока сюда не переключён.
//
// Правило выбора ключа (`getOpenAIKey`):
//   • функция выключена (`WORKSPACE_OWN_KEYS=off`) или у пространства своего ключа нет → ключ
//     сервера `OPENAI_API_KEY`, как и сейчас;
//   • свой ключ есть → он. Не расшифровался — ОШИБКА, а не тихий переход на ключ сервера: это
//     тратило бы чужие деньги (решение владельца 14.10.2026).
// Ключ наружу не отдаётся никогда: статус — только last4/дата; в ошибки и логи ключ не попадает.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openSecret, sealSecret } from "./secret-box.ts";

const KIND = "openai";
const CACHE_TTL_MS = 60_000;
const VERIFY_TIMEOUT_MS = 10_000;
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const MIN_KEY_LENGTH = 20;
const MAX_KEY_LENGTH = 400;

export type KeyStatus = {
  source: "workspace" | "server";
  last4: string | null;
  set_at: string | null;
  set_by: number | null;
};

/** Отказ с текстом для человека. `code` — машинная причина, `status` — HTTP-статус маршрута. */
export class WorkspaceKeyError extends Error {
  constructor(
    readonly code: "invalid_format" | "rejected" | "unverifiable",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WorkspaceKeyError";
  }
}

type CacheEntry = { key: string | null; expires: number };
const cache = new Map<string, CacheEntry>();

/** Сбросить кэш ключей (после set/clear; в тестах). */
export function resetKeyCache(groupId?: string): void {
  if (groupId === undefined) cache.clear();
  else cache.delete(groupId);
}

/** Общий выключатель функции: `WORKSPACE_OWN_KEYS=off` → всегда ключ сервера. */
export function ownKeysEnabled(): boolean {
  return (Deno.env.get("WORKSPACE_OWN_KEYS") ?? "").trim().toLowerCase() !== "off";
}

const aadOf = (groupId: string) => `${groupId}:${KIND}`;

type SecretRow = { ciphertext: string; iv: string };

async function loadOwnKey(supabase: SupabaseClient, groupId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("workspace_secrets")
    .select("ciphertext, iv")
    .eq("group_id", groupId)
    .eq("kind", KIND)
    .maybeSingle();
  if (error) throw new Error(`workspace-keys: не прочитать ключ пространства (${error.code ?? "db"})`);
  if (!data) return null;
  return await openSecret(data as SecretRow, aadOf(groupId));
}

/**
 * Ключ OpenAI для пространства. `undefined` — нет ни своего ключа, ни ключа сервера
 * (так же, как `Deno.env.get`). Ошибка чтения/расшифровки — исключение, не фолбэк.
 */
export async function getOpenAIKey(
  supabase: SupabaseClient,
  groupId: string,
): Promise<string | undefined> {
  if (!ownKeysEnabled()) return Deno.env.get("OPENAI_API_KEY");
  const hit = cache.get(groupId);
  let own: string | null;
  if (hit && hit.expires > Date.now()) {
    own = hit.key;
  } else {
    own = await loadOwnKey(supabase, groupId);
    cache.set(groupId, { key: own, expires: Date.now() + CACHE_TTL_MS });
  }
  return own ?? Deno.env.get("OPENAI_API_KEY");
}

/** Чей ключ у пространства. Ключ не содержит и не расшифровывается. */
export async function keyStatus(supabase: SupabaseClient, groupId: string): Promise<KeyStatus> {
  const server: KeyStatus = { source: "server", last4: null, set_at: null, set_by: null };
  if (!ownKeysEnabled()) return server;
  const { data, error } = await supabase
    .from("workspace_secrets")
    .select("last4, set_at, set_by")
    .eq("group_id", groupId)
    .eq("kind", KIND)
    .maybeSingle();
  if (error) throw new Error(`workspace-keys: не прочитать статус ключа (${error.code ?? "db"})`);
  if (!data) return server;
  const row = data as { last4: string; set_at: string; set_by: number };
  return { source: "workspace", last4: row.last4, set_at: row.set_at, set_by: Number(row.set_by) };
}

function normalizeKey(raw: unknown): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  const ok = key.startsWith("sk-") && !/\s/.test(key) && key.length >= MIN_KEY_LENGTH &&
    key.length <= MAX_KEY_LENGTH;
  if (!ok) {
    throw new WorkspaceKeyError("invalid_format", "Ключ должен начинаться с sk- и не содержать пробелов.", 400);
  }
  return key;
}

async function verifyWithOpenAI(key: string, fetchImpl: typeof fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(OPENAI_MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    throw new WorkspaceKeyError("unverifiable", "Не удалось проверить ключ, попробуйте позже.", 503);
  }
  await res.body?.cancel();
  if (res.status === 401) throw new WorkspaceKeyError("rejected", "Ключ не принят OpenAI.", 400);
  if (!res.ok) {
    throw new WorkspaceKeyError("unverifiable", "Не удалось проверить ключ, попробуйте позже.", 503);
  }
}

/** Задать ключ пространства: формат → живая проверка у OpenAI → шифрование → upsert. */
export async function setOpenAIKey(
  supabase: SupabaseClient,
  groupId: string,
  rawKey: unknown,
  actorTid: number,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyStatus> {
  const key = normalizeKey(rawKey);
  await verifyWithOpenAI(key, fetchImpl);
  const sealed = await sealSecret(key, aadOf(groupId));
  const { error } = await supabase.from("workspace_secrets").upsert({
    group_id: groupId,
    kind: KIND,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    last4: key.slice(-4),
    set_by: actorTid,
    set_at: new Date().toISOString(),
  }, { onConflict: "group_id,kind" });
  resetKeyCache(groupId);
  if (error) throw new Error(`workspace-keys: не сохранить ключ (${error.code ?? "db"})`);
  return await keyStatus(supabase, groupId);
}

/** Снять ключ пространства (дальше — ключ сервера). */
export async function clearOpenAIKey(supabase: SupabaseClient, groupId: string): Promise<void> {
  const { error } = await supabase.from("workspace_secrets").delete()
    .eq("group_id", groupId).eq("kind", KIND);
  resetKeyCache(groupId);
  if (error) throw new Error(`workspace-keys: не снять ключ (${error.code ?? "db"})`);
}
