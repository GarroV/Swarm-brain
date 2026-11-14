import { reviewQueueEmail } from "./entries-guard.ts";
import type { MeetingAttributionRow, MeetingsRouteContext } from "./meetings-routes.ts";
import { importerDisplayName, type RawMeetingFacets, weightedCounts } from "../_shared/meeting-list-facets.ts";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { BOT_MEETING_SOURCE_KEY } from "../_shared/bot-profile.ts";

/** Same stable source grouping as the existing meetingSourceKey on the list surface. */
export function facetSourceKey(source: string, recordedBy: unknown): string {
  if (["granola", "read_ai", "web-recorder"].includes(source)) return source;
  if (source === "desktop-agent" || source === "swarm-recorder") {
    return recordedBy === "bot" ? BOT_MEETING_SOURCE_KEY : "bumblebee";
  }
  return "meeting";
}

type NamedGroup = MeetingAttributionRow & { added_by: string; weight: number };
/** Authoritative union snapshot; pending keeps its distinct existing owner/attendee predicate. */
export async function handleMeetingFacets(context: MeetingsRouteContext): Promise<Response> {
  const { supabase, groupId, telegram_id, userEmail, origin, withImporterNames } = context;
  const { data, error } = await supabase.rpc("get_meeting_facets", {
    p_group: groupId,
    p_viewer: telegram_id,
    p_email: reviewQueueEmail(userEmail) || null,
  });
  if (error) return serverError(origin, "meeting facets", error);
  if (
    !data || data.includesPending !== true || !Number.isSafeInteger(data.total) || !Array.isArray(data.countries) ||
    !Array.isArray(data.authors) ||
    !Array.isArray(data.sources)
  ) return apiErr(500, "Meeting facets unavailable", origin);
  const raw = data as RawMeetingFacets;
  const groups: NamedGroup[] = raw.authors.flatMap((a) => {
    const base = { owner_id: a.owner_id, metadata: { added_by_telegram_id: a.metadata_actor }, added_by: a.added_by };
    return a.fallback_ids.length
      ? a.fallback_ids.map((id) => ({ ...base, id, weight: 1 }))
      : [{ ...base, weight: a.count }];
  });
  // Resolve the legacy recorder fallback with exactly the existing list's lookup semantics.
  const fallback = new Map<string, number>();
  const missing = groups.flatMap((g) => g.id ? [g.id] : []);
  for (let at = 0; at < missing.length; at += 500) {
    const { data: rows, error: lookupError } = await supabase.from("meetings").select("entry_id, recorders").in(
      "entry_id",
      missing.slice(at, at + 500),
    );
    if (lookupError) return serverError(origin, "meeting facet names", lookupError);
    for (const row of rows ?? []) {
      const value = row.recorders?.[0]?.telegram_id;
      const id = typeof value === "number"
        ? value
        : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : null;
      if (row.entry_id && id !== null) fallback.set(row.entry_id, id);
    }
  }
  const named = await withImporterNames(groups, fallback);
  return json(
    {
      total: raw.total,
      includesPending: true,
      emptyCountries: raw.emptyCountries,
      countries: raw.countries,
      sources: weightedCounts(raw.sources.map((s) => [facetSourceKey(s.source, s.recorded_by), s.count])),
      people: weightedCounts(named.flatMap((row) => {
        const name = importerDisplayName(row);
        return name ? [[name, row.weight] as [string, number]] : [];
      })),
    },
    200,
    origin,
  );
}
