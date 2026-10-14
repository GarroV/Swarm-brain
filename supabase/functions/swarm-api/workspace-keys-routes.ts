// Маршруты ключа пространства и мастер-админов (#233, этап 1). Подключены в admin.ts после общего
// гейта isAdmin, поэтому сюда приходит уже админ (своего пространства или суперадмин).
//   • /admin/workspaces/:id/openai-key — GET статус, PUT {key}, DELETE. Объём — `canManageWorkspace`
//     (чужое пространство для обычного админа — 404, как у остальных маршрутов пространства).
//   • /admin/master-admins — GET/POST/DELETE, только суперадмин.
// Ключ в ответах и логах не появляется никогда: ни в статусе, ни в ошибках.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clearOpenAIKey, keyStatus, setOpenAIKey, WorkspaceKeyError } from "../_shared/workspace-keys.ts";
import { addMasterAdmin, listMasterAdmins, removeMasterAdmin } from "../_shared/users/master-admins.ts";
import { type AdminActor, canManageWorkspace, isSuperadmin } from "./admin-scope.ts";
import { serverError } from "./client-error.ts";
import { apiErr, json } from "./http.ts";

export type WorkspaceKeysDeps = { fetchImpl?: typeof fetch };

const KEY_ROUTE = /^\/admin\/workspaces\/([^/]+)\/openai-key$/;
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
): Promise<Response | null> {
  try {
    const keyMatch = routePath.match(KEY_ROUTE);
    if (keyMatch) return await handleKeyRoute(supabase, req, keyMatch[1], actor, origin, deps);
    const masterMatch = routePath.match(MASTER_ROUTE);
    if (masterMatch) return await handleMasterRoute(supabase, req, masterMatch[1], actor, origin);
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
    if (e instanceof WorkspaceKeyError) return apiErr(e.status, e.message, origin);
    throw e;
  }
}

async function handleMasterRoute(
  supabase: SupabaseClient,
  req: Request,
  idPart: string | undefined,
  actor: AdminActor,
  origin: string,
): Promise<Response | null> {
  const known = idPart === undefined ? ["GET", "POST"] : ["DELETE"];
  if (!known.includes(req.method)) return null;
  if (!isSuperadmin(actor)) return apiErr(403, "Forbidden", origin);

  if (req.method === "GET") return json(await listMasterAdmins(supabase), 200, origin);

  if (req.method === "POST") {
    const body = await readBody(req);
    if (!body) return apiErr(400, "Invalid JSON", origin);
    const res = await addMasterAdmin(supabase, Number(body.telegram_id), actor.telegramId);
    if (!res.ok) return apiErr(400, res.message, origin);
    return json(await listMasterAdmins(supabase), 201, origin);
  }

  const res = await removeMasterAdmin(supabase, Number(idPart));
  if (!res.ok) return apiErr(res.reason === "not_found" ? 404 : 409, res.message, origin);
  return json(await listMasterAdmins(supabase), 200, origin);
}
