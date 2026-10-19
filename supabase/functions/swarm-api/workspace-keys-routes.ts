// Маршруты ключа пространства и мастер-админов (#233, этап 1). Подключены в admin.ts после общего
// гейта isAdmin, поэтому сюда приходит уже админ (своего пространства или суперадмин).
//   • /admin/workspaces/:id/openai-key — GET статус, PUT {key}, DELETE. Объём — `canManageWorkspace`
//     (чужое пространство для обычного админа — 404, как у остальных маршрутов пространства).
//   • /admin/master-admins — GET/POST/DELETE, только суперадмин.
//   • GET /admin/ai-health — баннер сбоя ключа и «встало в обработке» (админу — своё пространство,
//     мастеру — все, включая вызовы без пространства).
//   • PUT /admin/workspaces/:id/users/:tid/admin {is_admin} — назначить/снять админа пространства,
//     только мастер-админ (мастер заводит пространства и назначает их админов; решение 19.10.2026).
// Ключ в ответах и логах не появляется никогда: ни в статусе, ни в ошибках.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clearOpenAIKey, keyStatus, setOpenAIKey, WorkspaceKeyError } from "../_shared/workspace-keys.ts";
import { keyIssues, stalledMeetings } from "../_shared/ai-health.ts";
import { addMasterAdmin, listMasterAdmins, removeMasterAdmin } from "../_shared/users/master-admins.ts";
import { type AdminActor, canManageWorkspace, isSuperadmin } from "./admin-scope.ts";
import { serverError } from "./client-error.ts";
import { apiErr, json } from "./http.ts";

export type WorkspaceKeysDeps = { fetchImpl?: typeof fetch };
type ResolveNames = (ids: number[]) => Promise<Map<number, string>>;

const KEY_ROUTE = /^\/admin\/workspaces\/([^/]+)\/openai-key$/;
const HEALTH_ROUTE = "/admin/ai-health";
const ADMIN_ROLE_ROUTE = /^\/admin\/workspaces\/([^/]+)\/users\/(-?\d+)\/admin$/;
const MASTER_ROUTE = /^\/admin\/master-admins(?:\/(\d+))?$/;

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function handleWorkspaceKeysRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  actor: AdminActor,
  origin: string,
  deps: WorkspaceKeysDeps = {},
  resolveNames: ResolveNames = () => Promise.resolve(new Map()),
): Promise<Response | null> {
  try {
    const keyMatch = routePath.match(KEY_ROUTE);
    if (keyMatch) return await handleKeyRoute(supabase, req, keyMatch[1], actor, origin, deps);
    if (routePath === HEALTH_ROUTE && req.method === "GET") return await handleHealthRoute(supabase, actor, origin);
    const roleMatch = routePath.match(ADMIN_ROLE_ROUTE);
    if (roleMatch && req.method === "PUT") {
      return await handleAdminRoleRoute(supabase, req, roleMatch[1], Number(roleMatch[2]), actor, origin);
    }
    const masterMatch = routePath.match(MASTER_ROUTE);
    if (masterMatch) return await handleMasterRoute(supabase, req, masterMatch[1], actor, origin, resolveNames);
    return null;
  } catch (e) {
    return serverError(origin, "admin: workspace keys", e);
  }
}

async function handleKeyRoute(
  supabase: SupabaseClient,
  req: Request,
  wsId: string,
  actor: AdminActor,
  origin: string,
  deps: WorkspaceKeysDeps,
): Promise<Response | null> {
  if (!["GET", "PUT", "DELETE"].includes(req.method)) return null;
  if (!canManageWorkspace(actor, wsId)) return apiErr(404, "Workspace not found", origin);
  const { data: ws } = await supabase.from("workspaces").select("id").eq("id", wsId).maybeSingle();
  if (!ws) return apiErr(404, "Workspace not found", origin);

  if (req.method === "GET") return json(await keyStatus(supabase, wsId), 200, origin);

  if (req.method === "DELETE") {
    await clearOpenAIKey(supabase, wsId);
    return json(await keyStatus(supabase, wsId), 200, origin);
  }

  const body = await readBody(req);
  if (!body) return apiErr(400, "Invalid JSON", origin);
  try {
    const status = await setOpenAIKey(supabase, wsId, body.key, actor.telegramId, deps.fetchImpl);
    return json(status, 200, origin);
  } catch (e) {
    if (e instanceof WorkspaceKeyError) return apiErr(e.status, e.message, origin, e.code);
    throw e;
  }
}

/** Журнал выдачи/снятия роли мастер-админа: кто, кому, когда — строка в логе функции (как у смены почты). */
function logMasterChange(event: "master_admin_added" | "master_admin_removed", actor: number, target: number): void {
  console.log(JSON.stringify({ event, actor, target, at: new Date().toISOString() }));
}

async function handleMasterRoute(
  supabase: SupabaseClient,
  req: Request,
  idPart: string | undefined,
  actor: AdminActor,
  origin: string,
  resolveNames: ResolveNames,
): Promise<Response | null> {
  // Список с именами для экрана: имя — из профиля (resolveNames), без имени — null, веб покажет id.
  const listWithNames = async () => {
    const rows = await listMasterAdmins(supabase);
    const names = await resolveNames(rows.map((r) => r.telegram_id));
    return rows.map((r) => ({ ...r, name: names.get(r.telegram_id) ?? null }));
  };
  const known = idPart === undefined ? ["GET", "POST"] : ["DELETE"];
  if (!known.includes(req.method)) return null;
  if (!isSuperadmin(actor)) return apiErr(403, "Forbidden", origin);

  if (req.method === "GET") return json(await listWithNames(), 200, origin);

  if (req.method === "POST") {
    const body = await readBody(req);
    if (!body) return apiErr(400, "Invalid JSON", origin);
    const res = await addMasterAdmin(supabase, Number(body.telegram_id), actor.telegramId);
    if (!res.ok) return apiErr(400, res.message, origin, res.reason);
    logMasterChange("master_admin_added", actor.telegramId, Number(body.telegram_id));
    return json(await listWithNames(), 201, origin);
  }

  const res = await removeMasterAdmin(supabase, Number(idPart));
  if (!res.ok) return apiErr(res.reason === "not_found" ? 404 : 409, res.message, origin, res.reason);
  logMasterChange("master_admin_removed", actor.telegramId, Number(idPart));
  return json(await listWithNames(), 200, origin);
}

async function handleHealthRoute(supabase: SupabaseClient, actor: AdminActor, origin: string): Promise<Response> {
  const scope = isSuperadmin(actor) ? undefined : actor.groupId;
  if (scope === "") return json({ issues: [], stalled: [] }, 200, origin);
  const [issues, stalled] = await Promise.all([keyIssues(supabase, scope), stalledMeetings(supabase, scope)]);
  const { data } = await supabase.from("workspaces").select("id, name");
  const names = new Map(((data ?? []) as Array<{ id: string; name: string | null }>).map((w) => [w.id, w.name]));
  const named = <T extends { group_id: string }>(r: T) => ({
    ...r,
    workspace_name: names.get(r.group_id) ?? r.group_id,
  });
  return json({ issues: issues.map(named), stalled: stalled.map(named) }, 200, origin);
}

async function handleAdminRoleRoute(
  supabase: SupabaseClient,
  req: Request,
  wsId: string,
  telegramId: number,
  actor: AdminActor,
  origin: string,
): Promise<Response> {
  if (!isSuperadmin(actor)) return apiErr(403, "Forbidden", origin);
  const body = await readBody(req);
  if (!body || typeof body.is_admin !== "boolean") return apiErr(400, "is_admin must be boolean", origin);
  const { data } = await supabase.from("allowed_users").select("telegram_id, group_id")
    .eq("telegram_id", telegramId).maybeSingle();
  if (!data || (data as { group_id: string | null }).group_id !== wsId) {
    return apiErr(404, "User not found in this workspace", origin);
  }
  const { error } = await supabase.from("allowed_users").update({ is_admin: body.is_admin })
    .eq("telegram_id", telegramId).eq("group_id", wsId);
  if (error) throw new Error(`admin role: не записать (${error.code ?? "db"})`);
  return json({ ok: true, is_admin: body.is_admin }, 200, origin);
}
