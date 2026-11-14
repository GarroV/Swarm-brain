import { assertEquals } from "@std/assert";
import type { Entry } from "@/types";
import {
  entryMeetingFacets,
  meetingCountryFilterCounts,
  meetingFacetSignature,
  meetingFacetView,
  normalizeMeetingFacets,
} from "./meetingsFacets.ts";
import { importerDisplayName } from "../../../supabase/functions/_shared/meeting-list-facets.ts";
import { facetSourceKey } from "../../../supabase/functions/swarm-api/meeting-facets.ts";
import { meetingSourceKey } from "./sourceLabels.ts";

Deno.test("meeting facet presentation: complete aggregate normalizes country aliases without page rows", () => {
  assertEquals(
    normalizeMeetingFacets({
      total: 238,
      countries: [["RS", 100], ["Сербия", 137], ["BG", 1]],
      sources: [["granola", 235], ["read_ai", 3]],
      people: [["Fictional A", 100], ["Fictional B", 138]],
    }),
    {
      total: 238,
      emptyCountries: 0,
      countries: [["RS", 237], ["BG", 1]],
      sources: [["granola", 235], ["read_ai", 3]],
      people: [["Fictional A", 100], ["Fictional B", 138]],
    },
  );
  assertEquals(entryMeetingFacets([]), {
    total: 0,
    emptyCountries: 0,
    countries: [],
    sources: [],
    people: [],
  });
});

Deno.test("server facet source categories equal the current meeting list including legacy recording attribution", () => {
  for (
    const source of [
      "granola",
      "read_ai",
      "web-recorder",
      "desktop-agent",
      "swarm-recorder",
      "unknown",
      "meeting",
    ]
  ) {
    for (const recorded_by of [undefined, null, "bot", "recorder", "invalid"]) {
      assertEquals(
        facetSourceKey(source, recorded_by),
        meetingSourceKey({ source, metadata: { recorded_by } }),
      );
    }
  }
});
Deno.test("canonical meeting author presentation preserves resolved names and human fallbacks", () => {
  for (
    const [added_by, expected] of [
      [null, ""],
      ["", ""],
      ["granola", ""],
      ["read_ai", ""],
      ["claude_desktop", ""],
      ["desktop-agent", ""],
      ["swarm-recorder", ""],
      [" 123 ", ""],
      ["-30", ""],
      ["Fixture Human", "Fixture Human"],
      ["  Human Name  ", "Human Name"],
    ]
  ) {
    assertEquals(importerDisplayName({ added_by }), expected);
    assertEquals(
      importerDisplayName({ added_by, importer_name: "Full Name" }),
      "Full Name",
    );
  }
});

Deno.test("meeting facets: one union snapshot owns the count even when the independently loaded queue is stale", () => {
  const pending = [{
    id: "just-published",
    source: "granola",
    metadata: { confirmed: false },
    countries: ["RS"],
  }] as Entry[];
  const view = meetingFacetView(
    {
      includesPending: true,
      total: 237,
      countries: [["RS", 237]],
      sources: [["granola", 237]],
      people: [],
    },
    pending,
    { failed: false, loading: false, hasMore: true, loadingMore: false },
  );
  assertEquals(view?.total, 237);
});
Deno.test("meeting facets: aggregate outage plus failed initial page never claims a pending-only total is complete", () => {
  const pending = [{
    id: "pending",
    source: "granola",
    countries: ["RS"],
  }] as Entry[];
  const state = {
    failed: true,
    loading: false,
    hasMore: false,
    loadingMore: false,
  };
  assertEquals(meetingFacetView(null, pending, state), null);
  assertEquals(
    meetingFacetView(
      null,
      pending,
      Object.assign({ ...state, failed: false }, { refreshing: true }),
    ),
    null,
  );
  assertEquals(
    meetingFacetView(null, pending, { ...state, failed: false, hasMore: true }),
    null,
  );
  assertEquals(
    meetingFacetView(null, pending, { ...state, failed: false })?.total,
    1,
  );
});

Deno.test("meeting countries: empty-country stats placeholder never hides an explicitly stored dash filter", () => {
  const rows = [{ countries: [], source: "granola" }, {
    countries: ["—"],
    source: "granola",
  }] as Entry[];
  const facets = entryMeetingFacets(rows);
  assertEquals(facets.countries, [["—", 2]]);
  assertEquals(meetingCountryFilterCounts(facets), [["—", 1]]);
});

Deno.test("meeting facet ties keep the server snapshot's pending-first appearance order", () => {
  const view = normalizeMeetingFacets({
    total: 2,
    countries: [["BG", 1], ["RS", 1]],
    sources: [["read_ai", 1], ["granola", 1]],
    people: [["Pending Human", 1], ["Confirmed Human", 1]],
  });
  assertEquals(view.sources, [["read_ai", 1], ["granola", 1]]);
  assertEquals(view.countries, [["BG", 1], ["RS", 1]]);
  assertEquals(view.people, [["Pending Human", 1], ["Confirmed Human", 1]]);
});

Deno.test("pending refresh: relevant category changes invalidate the snapshot, transcript-only updates do not", () => {
  const row = {
    id: "pending",
    source: "read_ai",
    countries: ["RS"],
    metadata: { confirmed: false },
    importer_name: "Fictional A",
    content: "original",
    summary: "summary",
  } as Entry;
  const first = meetingFacetSignature([row]);
  assertEquals(
    meetingFacetSignature([{
      ...row,
      content: "updated transcript",
      summary: "new summary",
    }]),
    first,
  );
  assertEquals(
    meetingFacetSignature([{ ...row, countries: ["BG"] }]) === first,
    false,
  );
  assertEquals(
    meetingFacetSignature([{ ...row, importer_name: "Fictional B" }]) === first,
    false,
  );
  assertEquals(meetingFacetSignature([]) === first, false);
});
