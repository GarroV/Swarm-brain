// Мастер-админы (#233, этап 1): доступ ко всем пространствам. Мастер-админ = константа
// SUPERADMIN_TELEGRAM_ID (запасной, пока константа в коде) ЛИБО строка в `master_admins`.
// Права суперадмина (`isSuperadmin`, `AdminActor.isMaster`) решаются этим признаком: он вычисляется
// один раз на запрос (`masterAdminFlag`) и кладётся в актора. Адресат технических тревог — другое
// дело: он остаётся константой и отсюда не берётся.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPERADMIN_TELEGRAM_ID } from "./admin-scope.ts";

const CACHE_TTL_MS = 60_000;

export type MasterAdmin = {
  telegram_id: number;
  added_by: number | null;
  created_at: string | null;
  /** Константа в коде: снять нельзя, пока она там. */
  builtin: boolean;
};

export type MasterAdminResult =
  | { ok: true }
  | { ok: false; reason: "invalid_id" | "builtin" | "last" | "not_found"; message: string };

let cache: { ids: Set<number>; expires: number } | null = null;

export function resetMasterAdminsCache(): void {
  cache = null;
}

async function loadIds(supabase: SupabaseClient): Promise<Set<number>> {
  if (cache && cache.expires > Date.now()) return cache.ids;
  const { data, error } = await supabase.from("master_admins").select("telegram_id");
  if (error) throw new Error(`master-admins: не прочитать список (${error.code ?? "db"})`);
  const ids = new Set((data ?? []).map((r: { telegram_id: number }) => Number(r.telegram_id)));
  cache = { ids, expires: Date.now() + CACHE_TTL_MS };
  return ids;
}

export async function isMasterAdmin(supabase: SupabaseClient, telegramId: number): Promise<boolean> {
  if (telegramId === SUPERADMIN_TELEGRAM_ID) return true;
  return (await loadIds(supabase)).has(telegramId);
}

/**
 * Признак мастер-админа для РЕШЕНИЙ О ПРАВАХ: `isMasterAdmin`, но сбой чтения списка не роняет
 * запрос, а даёт «нет» (константа остаётся «да» без базы). Отказ — безопасная сторона для прав;
 * сбой виден в журнале функции.
 */
export async function masterAdminFlag(supabase: SupabaseClient, telegramId: number): Promise<boolean> {
  try {
    return await isMasterAdmin(supabase, telegramId);
  } catch (e) {
    console.error("master-admins: список не прочитан, права мастер-админа не выданы:", e);
    return false;
  }
}

export async function listMasterAdmins(supabase: SupabaseClient): Promise<MasterAdmin[]> {
  const { data, error } = await supabase
    .from("master_admins")
    .select("telegram_id, added_by, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`master-admins: не прочитать список (${error.code ?? "db"})`);
  const rows = ((data ?? []) as Array<Omit<MasterAdmin, "builtin">>).map((r) => ({
    telegram_id: Number(r.telegram_id),
    added_by: r.added_by == null ? null : Number(r.added_by),
    created_at: r.created_at ?? null,
    builtin: Number(r.telegram_id) === SUPERADMIN_TELEGRAM_ID,
  }));
  if (!rows.some((r) => r.builtin)) {
    rows.unshift({ telegram_id: SUPERADMIN_TELEGRAM_ID, added_by: null, created_at: null, builtin: true });
  }
  return rows;
}

export async function addMasterAdmin(
  supabase: SupabaseClient,
  telegramId: number,
  actorTid: number,
): Promise<MasterAdminResult> {
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    return { ok: false, reason: "invalid_id", message: "telegram_id должен быть положительным числом" };
  }
  const { error } = await supabase.from("master_admins").upsert(
    { telegram_id: telegramId, added_by: actorTid },
    { onConflict: "telegram_id", ignoreDuplicates: true },
  );
  resetMasterAdminsCache();
  if (error) throw new Error(`master-admins: не добавить (${error.code ?? "db"})`);
  return { ok: true };
}

export async function removeMasterAdmin(
  supabase: SupabaseClient,
  telegramId: number,
): Promise<MasterAdminResult> {
  if (telegramId === SUPERADMIN_TELEGRAM_ID) {
    return {
      ok: false,
      reason: "builtin",
      message: "Этого мастер-админа задаёт код, снять его из списка нельзя",
    };
  }
  const { data, error } = await supabase.from("master_admins").select("telegram_id");
  if (error) throw new Error(`master-admins: не прочитать список (${error.code ?? "db"})`);
  const ids = (data ?? []).map((r: { telegram_id: number }) => Number(r.telegram_id));
  if (!ids.includes(telegramId)) {
    return { ok: false, reason: "not_found", message: "Такого мастер-админа нет" };
  }
  if (ids.length <= 1) {
    return { ok: false, reason: "last", message: "Нельзя удалить последнего мастер-админа" };
  }
  const { error: delErr } = await supabase.from("master_admins").delete().eq("telegram_id", telegramId);
  resetMasterAdminsCache();
  if (delErr) throw new Error(`master-admins: не удалить (${delErr.code ?? "db"})`);
  return { ok: true };
}
