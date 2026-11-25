import { deleteSprint, getSprintKind } from "../_shared/tasks/sprints.ts";
import { apiErr, corsHeaders } from "./http.ts";

/** Archive a tab/space without removing its contents or their links. */
export async function archiveSprintResponse(
  id: string,
  groupId: string,
  viewerId: number | undefined,
  isAdmin: boolean,
  origin: string,
): Promise<Response> {
  const kind = await getSprintKind(id, groupId);
  if (kind === null) return apiErr(404, "Not found", origin);
  if (!isAdmin && kind !== "board_tab") return apiErr(403, "Forbidden", origin);
  // Keep the kind predicate on the write as well as the read. Sprint spaces remain admin-only.
  const ok = await deleteSprint(id, groupId, viewerId, isAdmin ? undefined : "board_tab");
  if (!ok) return apiErr(404, "Not found", origin);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
