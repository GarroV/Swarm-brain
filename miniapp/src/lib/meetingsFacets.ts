import type { Entry } from "@/types";
import { countryCode } from "./countries";
import { meetingSourceKey } from "./sourceLabels";
import { weightedCounts, importerDisplayName, type MeetingFacets, type Counts } from "../../../supabase/functions/_shared/meeting-list-facets";
export type { MeetingFacets };

export function entryMeetingFacets(rows: Entry[]): MeetingFacets {
  const count = (keys: string[]) => weightedCounts(keys.map((key): [string, number] => [key, 1]));
  return { total: rows.length, emptyCountries: rows.filter((row) => !row.countries?.length).length,
    countries: count(rows.flatMap((row) => row.countries?.length ? row.countries.map(countryCode) : ["—"])),
    sources: count(rows.map(meetingSourceKey)),
    people: count(rows.map(importerDisplayName).filter(Boolean)),
  };
}

/** Normalize presentation only; the server already counted the union in a single snapshot. */
export function normalizeMeetingFacets(server: MeetingFacets): MeetingFacets {
  const countries: Counts = server.countries.map(([key,n]) => [countryCode(key),n]);
  return { total: server.total, emptyCountries: server.emptyCountries ?? 0,
    countries: weightedCounts(countries), sources: server.sources, people: server.people };
}

/** Empty arrays add the stats placeholder; an explicitly stored dash remains a filter value. */
export function meetingCountryFilterCounts(facets: MeetingFacets | null): Counts {
  return (facets?.countries ?? []).map(([key,n]): [string,number] => [key, n - (key === "—" ? facets?.emptyCountries ?? 0 : 0)]).filter(([key,n]) => key !== "" && n > 0);
}

export type MeetingListCompleteness = { failed: boolean; loading: boolean; hasMore: boolean; loadingMore: boolean; refreshing?: boolean };
/** A failed/truncated fallback is never labelled a complete count. */
export function meetingFacetView(server: MeetingFacets | null, rows: Entry[] | null, list: MeetingListCompleteness): MeetingFacets | null {
  if (server?.includesPending === true) return normalizeMeetingFacets(server);
  return rows && !list.failed && !list.refreshing && !list.loading && !list.hasMore && !list.loadingMore ? entryMeetingFacets(rows) : null;
}

/** Changes relevant to aggregate counters, not the large transcript/summary payload. */
export function meetingFacetSignature(rows: Entry[]): string {
  return JSON.stringify(rows.map((r) => [r.id,r.source,r.countries,r.owner_id,r.added_by,r.importer_name,r.metadata?.confirmed,r.metadata?.recorded_by,r.metadata?.added_by_telegram_id]));
}
