// Мастер-админы (#233, этап 1): доступ ко всем пространствам. Мастер-админ = константа
// SUPERADMIN_TELEGRAM_ID (запасной, пока константа в коде) ЛИБО строка в `master_admins`.
// Права суперадмина (`isSuperadmin`, `AdminActor.isMaster`) решаются этим признаком: он вычисляется
// один раз на запрос (`masterAdminFlag`) и кладётся в актора. Адресат технических тревог — другое
// дело: он остаётся константой и отсюда не берётся.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPERADMIN_TELEGRAM_ID } from "./admin-scope.ts";

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

/**
 * Мастер-админ ли `telegramId`. Без кэша: решение о правах читает таблицу на каждый вызов (PK),
 * поэтому снятый мастер-админ теряет права сразу на всех экземплярах функции.
 */
export async function isMasterAdmin(supabase: SupabaseClient, telegramId: number): Promise<boolean> {
  if (telegramId === SUPERADMIN_TELEGRAM_ID) return true;
  const { data, error } = await supabase.from("master_admins").select("telegram_id")
    .eq("telegram_id", telegramId).maybeSingle();
  if (error) throw new Error(`master-admins: не прочитать список (${error.code ?? "db"})`);
  return data != null;
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

/**
 * Признак мастер-админа для ЦЕЛИ действия: сбой чтения списка → «мастер» (fail-closed): лучше
 * отказать админу пространства, чем отдать ему аккаунт мастера. Нет аккаунта (`null`) — не мастер.
 */
export async function targetIsMasterAdmin(
  supabase: SupabaseClient,
  telegramId: number | null | undefined,
): Promise<boolean> {
  if (telegramId == null) return false;
  try {
    return await isMasterAdmin(supabase, Number(telegramId));
  } catch (e) {
    console.error("master-admins: список не прочитан, цель считается мастер-админом:", e);
    return true;
  }
}

/** Строка allowed_users с признаком `is_master` (см. `MemberRow`); null → null. */
export async function withMasterFlag<T extends { telegram_id: number | null }>(
  supabase: SupabaseClient,
  row: T | null,
): Promise<(T & { is_master: boolean }) | null> {
  if (!row) return null;
  return { ...row, is_master: await targetIsMasterAdmin(supabase, row.telegram_id) };
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
  return await changeMasterRole(supabase, telegramId, actorTid, "added");
}

export async function removeMasterAdmin(
  supabase: SupabaseClient,
  telegramId: number,
  actorTid: number,
): Promise<MasterAdminResult> {
  if (telegramId === SUPERADMIN_TELEGRAM_ID) {
    return {
      ok: false,
      reason: "builtin",
      message: "Этого мастер-админа задаёт код, снять его из списка нельзя",
    };
  }
  return await changeMasterRole(supabase, telegramId, actorTid, "removed");
}

const DENIALS = {
  invalid_id: "telegram_id должен быть положительным числом",
  builtin: "Этого мастер-админа задаёт код, снять его из списка нельзя",
  last: "Нельзя удалить последнего мастер-админа",
  not_found: "Такого мастер-админа нет",
} as const;

/** The route authenticates the master admin; PostgreSQL commits membership and history together. */
async function changeMasterRole(
  supabase: SupabaseClient,
  target: number,
  actor: number,
  action: "added" | "removed",
): Promise<MasterAdminResult> {
  const { data, error } = await supabase.rpc("change_master_admin_role", {
    p_target: target,
    p_actor: actor,
    p_action: action,
    p_builtin: SUPERADMIN_TELEGRAM_ID,
  });
  if (error) throw new Error(`master-admins: не записать роль и журнал (${error.code ?? "db"})`);
  if (data?.ok === true) return { ok: true };
  if (data?.ok === false && typeof data.reason === "string" && Object.hasOwn(DENIALS, data.reason)) {
    const reason = data.reason as keyof typeof DENIALS;
    return { ok: false, reason, message: DENIALS[reason] };
  }
  throw new Error("master-admins: неверный ответ изменения роли");
}
