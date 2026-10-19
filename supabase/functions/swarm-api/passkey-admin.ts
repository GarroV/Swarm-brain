// Ручной сброс входа человека (#955): админ пространства или суперадмин снимает его ключи доступа
// (потерял устройство), и при следующем входе палец сохраняется заново. Экрана нет — админку
// перестраивают отдельно (#233), здесь только API.
//   DELETE /admin/workspaces/:wsId/users/:userId/passkeys
// Объём — общие правила admin-scope.ts: админ чужого пространства получает 404, как и на остальных
// маршрутах пространства; аккаунт суперадмина сбрасывает только он сам.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AdminActor,
  canChangeAccountKeys,
  canManageMember,
  canManageWorkspace,
  isSuperadmin,
} from "./admin-scope.ts";
import { parseUserRef } from "../_shared/users/user-ref.ts";
import type { PasskeyStore } from "../_shared/passkeys/store.ts";
import { serverError } from "./client-error.ts";
import { apiErr, json } from "./http.ts";

const ROUTE = /^\/admin\/workspaces\/([^/]+)\/users\/([^/]+)\/passkeys$/;

/**
 * Мастер-админ по таблице master_admins — читается КАЖДЫЙ раз, без кэша. Сбой чтения бросает:
 * по ошибке базы сбрасывать вход мастер-админу нельзя, поэтому вызывающий отвечает отказом.
 * (Таблицу заводит миграция ветки feat/ws-admin; пока её нет, чтение падает и отказ получают все
 * не-суперадмины — это сознательно закрыто по умолчанию. При слиянии — свести к `canChangeAccountKeys`.)
 */
async function isMasterAdmin(supabase: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data, error } = await supabase.from("master_admins").select("telegram_id").eq("telegram_id", telegramId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

export async function handlePasskeyAdminRoutes(
  supabase: SupabaseClient,
  store: PasskeyStore,
  req: Request,
  routePath: string,
  actor: AdminActor,
  origin: string,
): Promise<Response | null> {
  const m = routePath.match(ROUTE);
  if (!m || req.method !== "DELETE") return null;
  const [, wsId, rawUser] = m;

  if (!canManageWorkspace(actor, wsId)) return apiErr(404, "Workspace not found", origin);
  const ref = parseUserRef(decodeURIComponent(rawUser));
  if (ref.kind === "invalid") return apiErr(400, "Invalid user id", origin);
  // Ожидающее приглашение (ещё нет telegram_id) не входило ни разу — ключей у него быть не может.
  if (ref.kind !== "telegram") return apiErr(404, "User not found", origin);

  try {
    const { data, error } = await supabase.from("allowed_users").select("telegram_id, group_id")
      .eq("telegram_id", ref.telegramId).eq("group_id", wsId).maybeSingle();
    if (error) throw error;
    const target = data as { telegram_id: number | null; group_id: string | null } | null;
    // Нет такого человека в ЭТОМ пространстве (в том числе из чужого) — 404, а не 403:
    // существование чужих людей админ узнавать не должен.
    if (!target || !canManageMember(actor, target)) return apiErr(404, "User not found", origin);
    if (!canChangeAccountKeys(actor, target)) return apiErr(403, "Forbidden", origin);
    // Вход мастер-админа сбрасывает только мастер-админ (константа или строка master_admins).
    // Константный аккаунт владельца закрыт выше — только он сам.
    const actorIsMaster = isSuperadmin(actor) || await isMasterAdmin(supabase, actor.telegramId);
    if (!actorIsMaster && await isMasterAdmin(supabase, ref.telegramId)) return apiErr(403, "Forbidden", origin);
    const removed = await store.deleteForPerson(ref.telegramId);
    return json({ ok: true, removed }, 200, origin);
  } catch (e) {
    return serverError(origin, "admin: passkeys reset", e);
  }
}
