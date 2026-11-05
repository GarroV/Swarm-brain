// Создание пространства (workspace): слаг и название. Единый канон для веб-админки (swarm-api
// `POST /admin/workspaces`) и бота-суперадмина (`sa_create`, `/workspace create`).
//
// Слаг `workspaces.id` — ПОСТОЯННЫЙ нейтральный ключ (CLAUDE.md «Идентификаторы»): он внешний ключ
// `group_id` в entries/tasks/meetings/allowed_users, и менять его позже — тяжёлая миграция. Поэтому
// он НИКОГДА не выводится из названия (переименование сделало бы слаг ложью) и человеку не
// показывается: админ вводит только название, слаг рождается здесь.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeCountries } from "./countries.ts";

export const WORKSPACE_NAME_MAX = 60;
export const WORKSPACE_ID_PREFIX = "ws-";
const ID_SUFFIX_LEN = 8;
// RFC 4648 base32 без заглавных: слаг остаётся в шаблоне `^[a-z0-9_-]{1,64}$` workflow'ов и CLI.
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const MAX_CREATE_ATTEMPTS = 5;

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

/**
 * Название пространства: непустое после trim, не длиннее WORKSPACE_NAME_MAX, без управляющих
 * символов. Одно правило для создания и переименования (раньше PATCH писал что угодно).
 */
export function validateWorkspaceName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, message: "name обязателен" };
  const name = raw.trim();
  if (!name) return { ok: false, message: "name обязателен" };
  if ([...name].length > WORKSPACE_NAME_MAX) {
    return { ok: false, message: `name не длиннее ${WORKSPACE_NAME_MAX} символов` };
  }
  // deno-lint-ignore no-control-regex -- именно управляющие символы тут и отсекаем
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, message: "name содержит недопустимые символы" };
  return { ok: true, name };
}

/** `ws-` + 8 случайных символов base32 (40 бит). `bytes` — для тестов; по умолчанию — криптослучайные. */
export function generateWorkspaceId(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(ID_SUFFIX_LEN))): string {
  let suffix = "";
  for (let i = 0; i < ID_SUFFIX_LEN; i++) suffix += BASE32[bytes[i] % BASE32.length];
  return `${WORKSPACE_ID_PREFIX}${suffix}`;
}

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string } | null)?.code === "23505";

export type CreatedWorkspace = { id: string; name: string; allowed_markets: string[] | null };

/**
 * Вставить пространство под свежим слагом; при столкновении слага (23505) — новый слаг, до
 * MAX_CREATE_ATTEMPTS раз. Названия не уникальны намеренно: «World» и «World» различимы слагом,
 * а не запретом. `countries` — необязательный свой список стран (нормализуется); пусто — глобальный.
 */
export async function createWorkspace(
  supabase: SupabaseClient,
  input: { name: string; countries?: string[] },
  makeId: () => string = generateWorkspaceId,
): Promise<CreatedWorkspace> {
  const markets = input.countries && input.countries.length ? normalizeCountries(input.countries) : [];
  const allowed_markets = markets.length ? markets : null;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const id = makeId();
    const { error } = await supabase.from("workspaces").insert({ id, name: input.name, allowed_markets });
    if (!error) return { id, name: input.name, allowed_markets };
    if (!isUniqueViolation(error)) {
      throw new Error(`workspace create: ${(error as { message?: string }).message ?? "db"}`);
    }
  }
  throw new Error("workspace create: не удалось подобрать свободный слаг");
}
