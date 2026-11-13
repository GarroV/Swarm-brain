import type { DraftDeleteResult } from "../_shared/meeting-delete.ts";
import { apiErr, corsHeaders } from "./http.ts";

export function draftDeleteResponse(result: DraftDeleteResult, origin: string): Response {
  if (result.ok) return new Response(null, { status: 204, headers: corsHeaders(origin) });
  switch (result.reason) {
    case "not_found":
      return apiErr(404, "Not found", origin);
    case "published":
      return apiErr(409, "Уже в базе — удаляйте через раздел «База»", origin);
    case "shared":
      return apiErr(409, "This meeting has several owners — hide it for yourself instead", origin);
    case "forbidden":
      return apiErr(403, "Only the person who recorded this meeting can delete the draft", origin);
    case "changed":
      return apiErr(409, "Draft changed — reload before deleting", origin);
    case "storage":
      return apiErr(500, "Draft file cleanup is incomplete — retry deletion", origin);
    case "database":
      return apiErr(500, "Internal server error", origin);
  }
}
