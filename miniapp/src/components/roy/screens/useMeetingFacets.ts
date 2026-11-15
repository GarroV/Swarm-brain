"use client";
import { useEffect, useState } from "react";
import type { MeetingFacets } from "@/lib/meetingsFacets";
import { mcpApiFetch } from "@/lib/api";

/** Counts are independent of paginated rows. A failed aggregate triggers the old full-list fallback. */
export function useMeetingFacets(enabled: boolean, reloadKey?: unknown) {
  const [data, setData] = useState<MeetingFacets | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    mcpApiFetch<MeetingFacets>("/meetings/facets", { cache: "no-store" }).then((next) => {
      if (next.includesPending !== true) throw new Error("Meeting facet snapshot capability unavailable");
      if (active) { setData(next); setFailed(false); }
    }).catch((error) => { if (active) { console.warn("[meeting facets]", error); setFailed(true); } });
    return () => { active = false; };
  }, [enabled, reloadKey]);
  return { data: enabled && !failed ? data : null, failed: enabled && failed };
}
