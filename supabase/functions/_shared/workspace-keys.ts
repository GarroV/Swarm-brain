// Ключ к нейронке у пространства (#233). Потребители берут ключ через `getOpenAIKey` /
// `resolveOpenAIKey`; пока в `workspace_secrets` нет строк, это ровно ключ сервера OPENAI_API_KEY.
//
// Правило выбора ключа (`getOpenAIKey`):
//   • пространства нет (служебный вызов, `groupId` null/undefined), функция выключена
//     (`WORKSPACE_OWN_KEYS=off`) или у пространства своего ключа нет → ключ сервера `OPENAI_API_KEY`, как и сейчас;
//   • свой ключ есть → он. Не расшифровался — ОШИБКА, а не тихий переход на ключ сервера: это
//     тратило бы чужие деньги (решение владельца 14.10.2026).
//   • OpenAI отказал ключу пространства (401) — `reportKeyRejected` пишет ошибку в строку, показ — в
//     статусе. На ключ сервера НЕ переключаемся: вызов падает как обычно. Людям ничего не шлём.
// Ключ наружу не отдаётся никогда: статус — только last4/дата; в ошибки и логи ключ не попадает.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openSecret, sealSecret, secretsKeyConfigured } from "./secret-box.ts";
import { classifyResponse, recordOutcome, type SendText } from "./ai-health.ts";

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
  /** Когда OpenAI последний раз отказал этому ключу (401); очищается новым ключом. */
  last_error: string | null;
  last_error_at: string | null;
  /** Режим сервера: `WORKSPACE_OWN_KEYS` не `off`. При `false` ключ пространства не используется. */
  own_keys_enabled: boolean;
  /** Можно ли сохранить ключ пространства: задан `WORKSPACE_SECRETS_KEY` и миграция накатана. */
  storage_available: boolean;
  /** Есть ли у сервера общий ключ `OPENAI_API_KEY` — на него работает пространство без своего ключа. */
  server_key_available: boolean;
};

export type OpenAIKeySource = "workspace" | "server";
export type ResolvedKey = { key: string | undefined; source: OpenAIKeySource };

const REJECTED_MARK = "rejected";

/** Отказ с текстом для человека. `code` — машинная причина, `status` — HTTP-статус маршрута. */
export class WorkspaceKeyError extends Error {
  constructor(
    readonly code: "invalid_format" | "rejected" | "unverifiable" | "storage_unavailable",
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

/** Таблицы нет: миграция ещё не накатана (Postgres 42P01 / PostgREST PGRST205). */
const isMissingTable = (code: string | undefined) => code === "42P01" || code === "PGRST205";

type SecretRow = { ciphertext: string; iv: string };

async function loadOwnKey(supabase: SupabaseClient, groupId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("workspace_secrets")
    .select("ciphertext, iv")
    .eq("group_id", groupId)
    .eq("kind", KIND)
    .maybeSingle();
  if (error) {
    // Раскатка рядом с общим ключом: код может приехать раньше миграции — тогда своих ключей нет и
    // пространство работает на ключе сервера. Любая другая ошибка базы — ошибка, не фолбэк.
    if (isMissingTable(error.code)) {
      console.error("workspace-keys: таблицы workspace_secrets нет (миграция не накатана), ключ сервера");
      return null;
    }
    throw new Error(`workspace-keys: не прочитать ключ пространства (${error.code ?? "db"})`);
  }
  if (!data) return null;
  return await openSecret(data as SecretRow, aadOf(groupId));
}

/**
 * Ключ OpenAI и его источник. `key` undefined — нет ни своего ключа, ни ключа сервера (так же, как
 * `Deno.env.get`). `groupId` пустой — служебный вызов без пространства: ключ сервера. Ошибка
 * чтения/расшифровки — исключение, не фолбэк.
 */
export async function resolveOpenAIKey(
  supabase: SupabaseClient,
  groupId: string | null | undefined,
): Promise<ResolvedKey> {
  const server = Deno.env.get("OPENAI_API_KEY");
  if (!groupId || !ownKeysEnabled()) return { key: server, source: "server" };
  const hit = cache.get(groupId);
  let own: string | null;
  if (hit && hit.expires > Date.now()) {
    own = hit.key;
  } else {
    own = await loadOwnKey(supabase, groupId);
    cache.set(groupId, { key: own, expires: Date.now() + CACHE_TTL_MS });
  }
  return own ? { key: own, source: "workspace" } : { key: server, source: "server" };
}

/** Только ключ (см. `resolveOpenAIKey`). */
export async function getOpenAIKey(
  supabase: SupabaseClient,
  groupId: string | null | undefined,
): Promise<string | undefined> {
  return (await resolveOpenAIKey(supabase, groupId)).key;
}

/**
 * OpenAI отказал ключу пространства (401): фиксируем в строке, сбрасываем кэш. Никому ничего не
 * шлём, на ключ сервера не переходим. Сбой записи не должен ронять вызов — логируем и идём дальше.
 */
export async function reportKeyRejected(supabase: SupabaseClient, groupId: string): Promise<void> {
  resetKeyCache(groupId);
  const { error } = await supabase.from("workspace_secrets")
    .update({ last_error: REJECTED_MARK, last_error_at: new Date().toISOString() })
    .eq("group_id", groupId).eq("kind", KIND);
  if (error) console.error(`workspace-keys: не записать отказ ключа (${error.code ?? "db"})`);
}

/** Код ошибки из тела ответа (для 429: «кончились деньги» против «слишком часто»). Тело не расходуем. */
async function errorCodeOf(res: { status: number; clone?: () => Response }): Promise<string | null> {
  if (res.status !== 429 || !res.clone) return null;
  try {
    const body = await res.clone().json() as { error?: { code?: string | null; type?: string | null } };
    return body.error?.code ?? body.error?.type ?? null;
  } catch {
    return null;
  }
}

/**
 * После ответа OpenAI — единая точка (#233): 401 на ключе пространства → `reportKeyRejected`; исход
 * любого ключа (своего или серверного) → `recordOutcome` (тревога админам пространства, баннер).
 * Ответ не трогает; сбой учёта не роняет вызов.
 */
export async function noteOpenAIResponse(
  supabase: SupabaseClient,
  groupId: string | null | undefined,
  resolved: ResolvedKey,
  res: { status: number; clone?: () => Response },
  send?: SendText,
): Promise<void> {
  if (res.status === 401 && resolved.source === "workspace" && groupId) {
    await reportKeyRejected(supabase, groupId);
  }
  try {
    const outcome = classifyResponse(res.status, await errorCodeOf(res));
    await recordOutcome(supabase, { groupId: groupId ?? "", source: resolved.source, outcome, send });
  } catch (e) {
    console.error("workspace-keys: исход вызова не записан:", e instanceof Error ? e.message : e);
  }
}

/**
 * Вызов не дошёл до ответа (таймаут, обрыв сети): мягкий сбой ключа — тревога, только если держится
 * (`ai-health.ts`). Отмену извне (`AbortSignal` вызывающего) сюда не отправляют — это не сбой OpenAI.
 */
export async function noteOpenAIFailure(
  supabase: SupabaseClient,
  groupId: string | null | undefined,
  resolved: ResolvedKey,
  send?: SendText,
): Promise<void> {
  try {
    await recordOutcome(supabase, { groupId: groupId ?? "", source: resolved.source, outcome: { kind: "soft" }, send });
  } catch (e) {
    console.error("workspace-keys: исход вызова не записан:", e instanceof Error ? e.message : e);
  }
}

/**
 * Ключ на один вызов OpenAI: `key` — в заголовок, `noteResponse(res)` — после ответа (401 на ключе
 * пространства фиксируется). Для кода, где ключ раньше передавался строкой.
 */
export type KeyHandle = {
  key: string;
  noteResponse(res: { status: number; clone?: () => Response }): Promise<void>;
  /** Вызов не дошёл до ответа (таймаут, обрыв): мягкий сбой ключа. */
  noteError(): Promise<void>;
};
/** Принимают и обычную строку (ключ сервера, как раньше), и ручку. */
export type KeyLike = string | KeyHandle;

export async function openAIKeyHandle(
  supabase: SupabaseClient,
  groupId: string | null | undefined,
): Promise<KeyHandle> {
  const resolved = await resolveOpenAIKey(supabase, groupId);
  return {
    key: resolved.key ?? "",
    noteResponse: (res) => noteOpenAIResponse(supabase, groupId, resolved, res),
    noteError: () => noteOpenAIFailure(supabase, groupId, resolved),
  };
}

export const keyOf = (k: KeyLike): string => (typeof k === "string" ? k : k.key);
export const noteKeyResponse = (k: KeyLike, res: { status: number; clone?: () => Response }): Promise<void> =>
  typeof k === "string" ? Promise.resolve() : k.noteResponse(res);

/** Чей ключ у пространства. Ключ не содержит и не расшифровывается. */
export async function keyStatus(supabase: SupabaseClient, groupId: string): Promise<KeyStatus> {
  const server: KeyStatus = {
    source: "server",
    last4: null,
    set_at: null,
    set_by: null,
    last_error: null,
    last_error_at: null,
    own_keys_enabled: ownKeysEnabled(),
    storage_available: secretsKeyConfigured(),
    server_key_available: Boolean(Deno.env.get("OPENAI_API_KEY")),
  };
  if (!server.own_keys_enabled) return server;
  const { data, error } = await supabase
    .from("workspace_secrets")
    .select("last4, set_at, set_by, last_error, last_error_at")
    .eq("group_id", groupId)
    .eq("kind", KIND)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.code)) return { ...server, storage_available: false };
    throw new Error(`workspace-keys: не прочитать статус ключа (${error.code ?? "db"})`);
  }
  if (!data) return server;
  const row = data as {
    last4: string;
    set_at: string;
    set_by: number;
    last_error: string | null;
    last_error_at: string | null;
  };
  return {
    ...server,
    source: "workspace",
    last4: row.last4,
    set_at: row.set_at,
    set_by: Number(row.set_by),
    last_error: row.last_error ?? null,
    last_error_at: row.last_error_at ?? null,
  };
}

function normalizeKey(raw: unknown): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  const ok = key.startsWith("sk-") && !/\s/.test(key) && key.length >= MIN_KEY_LENGTH &&
    key.length <= MAX_KEY_LENGTH;
  if (!ok) {
    throw new WorkspaceKeyError("invalid_format", 'The key must start with "sk-" and contain no spaces.', 400);
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
    throw new WorkspaceKeyError("unverifiable", "Could not verify the key, please try again later.", 503);
  }
  await res.body?.cancel();
  if (res.status === 401) throw new WorkspaceKeyError("rejected", "OpenAI rejected the key.", 400);
  if (!res.ok) {
    throw new WorkspaceKeyError("unverifiable", "Could not verify the key, please try again later.", 503);
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
  if (!secretsKeyConfigured()) {
    throw new WorkspaceKeyError("storage_unavailable", "Key storage is not set up on the server yet.", 503);
  }
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
    last_error: null,
    last_error_at: null,
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
