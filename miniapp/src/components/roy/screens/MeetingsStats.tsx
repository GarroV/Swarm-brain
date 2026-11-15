"use client";
import { useDt } from "../nav";
import { countryCode } from "@/lib/countries";
import { sourceKeyLabel } from "@/lib/sourceLabels";
import type { MeetingFacets } from "@/lib/meetingsFacets";
import { CountsCard, MEET_DETAIL_COPY } from "./meetAdminPresentation";

export function MeetingsStats({ facets, markets }: { facets: MeetingFacets | null; markets: string[] | null }) {
  const dt = useDt();
  if (!facets) return <div className="roy-shim m-3 h-20 rounded-lg" aria-busy="true" />;
  const marketSet = new Set((markets ?? []).map(countryCode));
  const countryCounts: [string, number][] = [];
  let other = 0;
  for (const [code, n] of facets.countries) {
    if (marketSet.size === 0 || (code !== "—" && marketSet.has(code))) countryCounts.push([code, n]);
    else other += n;
  }
  countryCounts.sort((a, b) => b[1] - a[1]);
  if (other) countryCounts.push([dt(MEET_DETAIL_COPY.other.ru, MEET_DETAIL_COPY.other.en), other]);
  return <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
    <div className="px-1 text-ink-mute" style={{ fontSize: 12 }}>{dt(MEET_DETAIL_COPY.totalPrefix.ru, MEET_DETAIL_COPY.totalPrefix.en)}{facets.total}</div>
    <CountsCard title={dt(MEET_DETAIL_COPY.byCountry.ru, MEET_DETAIL_COPY.byCountry.en)} counts={countryCounts} />
    <CountsCard title={dt(MEET_DETAIL_COPY.sources.ru, MEET_DETAIL_COPY.sources.en)} counts={facets.sources.map(([key, n]) => [sourceKeyLabel(key, dt), n])} />
  </div>;
}
