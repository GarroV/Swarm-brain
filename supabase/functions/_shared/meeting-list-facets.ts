/** Weighted categorical counters; no individual meeting text travels with the aggregate. */
export type Counts = [string, number][];
export type MeetingFacets = {
  total: number;
  includesPending?: boolean;
  emptyCountries?: number;
  countries: Counts;
  sources: Counts;
  people: Counts;
};
export type SourceCount = { source: string; recorded_by: unknown; count: number };
export type AuthorCount = {
  owner_id: number | null;
  metadata_actor: unknown;
  added_by: string;
  count: number;
  fallback_ids: string[];
};
export type RawMeetingFacets = {
  total: number;
  includesPending?: boolean;
  emptyCountries?: number;
  countries: Counts;
  sources: SourceCount[];
  authors: AuthorCount[];
};

export function weightedCounts(values: Counts): Counts {
  const counts = new Map<string, number>();
  for (const [key, n] of values) counts.set(key, (counts.get(key) ?? 0) + n);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export function importerDisplayName(row: { importer_name?: string | null; added_by?: string | null }): string {
  if (row.importer_name) return row.importer_name;
  const name = (row.added_by ?? "").trim();
  return !name || ["granola", "read_ai", "claude_desktop", "desktop-agent", "swarm-recorder"].includes(name) ||
      /^-?\d+$/.test(name)
    ? ""
    : name;
}
