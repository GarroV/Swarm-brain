import type { Entry } from "@/types";
import type { MeetingsPageQuery, MeetingsPage } from "./api-types/meetings";

const headerCount = (res: Response, name: string): number | null => {
  const value = res.headers.get(name);
  return value != null && /^\d+$/.test(value) ? Number(value) : null;
};

export async function requestMeetingsPage(
  base: string,
  query: MeetingsPageQuery,
  error: (status: number, message: string, body: unknown) => Error,
  light = true,
): Promise<MeetingsPage> {
  const params = new URLSearchParams(light ? { light: "1" } : {});
  for (const key of ["confirmed", "limit", "offset", "cursor", "q", "from", "to", "storage"] as const) {
    const value = query[key];
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const res = await fetch(`${base}/meetings?${params}`, {
    cache: "no-store", credentials: "include", headers: { "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw error(res.status, body.error ?? res.statusText, body);
  return { rows: body ?? [], total: headerCount(res, "X-Total-Count"), unfilteredTotal: headerCount(res, "X-Unfiltered-Count"), keyset: res.headers.get("X-Meeting-Keyset") === "1" };
}

export function mockMeetingsPage(rows: Entry[], query: MeetingsPageQuery): MeetingsPage {
  const all = rows.filter((m) => query.confirmed === undefined || Boolean(m.metadata.confirmed) === query.confirmed);
  const edge = query.cursor ? JSON.parse(query.cursor) as { created_at: string; id: string } : null;
  const remaining = edge ? all.filter((r) => r.created_at < edge.created_at || (r.created_at === edge.created_at && r.id < edge.id)) : all;
  const offset = edge ? 0 : query.offset ?? 0;
  return { rows: remaining.slice(offset, offset + (query.limit ?? 50)), total: remaining.length, unfilteredTotal: all.length, keyset: true };
}

/** The review queue is explicitly eager by owner decision; page boundaries must not cap it. */
export async function loadPendingMeetingPages(
  fetchPage: (query: MeetingsPageQuery) => Promise<MeetingsPage>,
  active: () => boolean = () => true,
): Promise<Entry[]> {
  const all: Entry[] = [];
  const ids = new Set<string>();
  let query: MeetingsPageQuery = { confirmed: false, limit: 200 };
  while (active()) {
    const page = await fetchPage(query);
    if (!active()) return [];
    const oldSize = ids.size;
    for (const row of page.rows) if (!ids.has(row.id)) { ids.add(row.id); all.push(row); }
    if (page.rows.length < 200) return all;
    if (ids.size === oldSize) throw new Error("Meeting queue pagination made no progress");
    const last = page.rows.at(-1)!;
    query = page.keyset
      ? { confirmed: false, limit: 200, cursor: JSON.stringify({ created_at: last.created_at, id: last.id }) }
      : { confirmed: false, limit: 200, offset: (query.offset ?? 0) + page.rows.length };
  }
  return [];
}
