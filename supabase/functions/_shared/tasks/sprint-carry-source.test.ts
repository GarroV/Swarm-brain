// #476: exercise the actual composition projection, not a parallel carry resolver.
import { assertEquals, assertObjectMatch, assertRejects } from "@std/assert";

const saved = new Map(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map((key) => [key, Deno.env.get(key)]));
Deno.env.set("SUPABASE_URL", "https://sprint-source-fixture.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
const { listItems } = await import("./sprint-items.ts");
for (const [key, value] of saved) {
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
}

type Scenario = {
  from?: string | null;
  frozen?: boolean;
  missingItem?: boolean;
  missingCycle?: boolean;
  sourceGroup?: string;
  archived?: boolean;
  cycleFailure?: boolean;
};

async function withSourceFixture<T>(
  scenario: Scenario,
  check: (read: () => Promise<Record<string, unknown>[]>, calls: URL[]) => Promise<T>,
) {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    const table = url.pathname.split("/").at(-1);
    const select = url.searchParams.get("select") ?? "";
    let rows: Record<string, unknown>[];
    if (table === "sprint_cycles" && url.searchParams.get("id") === "eq.current-cycle") {
      rows = [{ id: "current-cycle" }];
    } else if (table === "sprint_cycles") {
      if (scenario.cycleFailure) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "fixture source cycle unavailable" }), { status: 500 }),
        );
      }
      rows = [{
        id: "source-cycle",
        name: "Previous sprint",
        group_id: scenario.sourceGroup ?? "workspace",
        archived_at: scenario.archived ? "2026-11-01T00:00:00Z" : null,
      }];
      const cycleIds = url.searchParams.get("id");
      if (cycleIds?.startsWith("in.(")) {
        rows = rows.filter((r) => cycleIds.slice(4, -1).split(",").includes(String(r.id)));
      }
      // Model actual PostgREST filters: an omitted scope would expose the foreign fixture.
      if (url.searchParams.has("group_id")) {
        rows = rows.filter((r) => `eq.${r.group_id}` === url.searchParams.get("group_id"));
      }
      if (url.searchParams.get("archived_at") === "is.null") rows = rows.filter((r) => r.archived_at === null);
    } else if (table === "sprint_items" && url.searchParams.has("cycle_id")) {
      rows = [{
        id: "current-item",
        cycle_id: "current-cycle",
        task_id: "task",
        in_plan: true,
        added_at: "2026-11-02T00:00:00Z",
        frozen_at: scenario.frozen ? "2026-11-03T00:00:00Z" : null,
        frozen_title: "Snapshot title",
        frozen_status: "open",
        frozen_assignees: [],
        carried_from: scenario.from === undefined ? "source-item" : scenario.from,
        carry_count: 1,
        carried_manual: true,
        to_carry: false,
      }];
    } else if (table === "sprint_items") {
      assertEquals(
        url.searchParams.get("id"),
        "in.(source-item)",
        "carried_from addresses the source item, not its cycle",
      );
      rows = scenario.missingItem
        ? []
        : [{ id: "source-item", cycle_id: scenario.missingCycle ? "missing-cycle" : "source-cycle" }];
    } else if (table === "tasks") {
      rows = [{ id: "task", title: "Live title", status: "open", project_id: null, assignees: [], links: [] }];
    } else if (table === "task_comments") {
      rows = [];
    } else {
      throw new Error(`Unexpected PostgREST table: ${table}`);
    }
    // The fixture honours the requested scalar projection; fields missing from SELECT do not arrive.
    const fields = new Set(select.split(",").map((field) => field.trim()));
    rows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => fields.has(key))));
    return Promise.resolve(new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } }));
  };
  try {
    return await check(
      async () => await listItems("current-cycle", "workspace", "everyone") as unknown as Record<string, unknown>[],
      calls,
    );
  } finally {
    globalThis.fetch = original;
  }
}

for (const frozen of [false, true]) {
  Deno.test(`carry source: ${frozen ? "accepted snapshot" : "live row"} resolves item FK to the source sprint`, async () => {
    await withSourceFixture({ frozen }, async (read) => {
      const items = await read();
      assertEquals(items.length, 1);
      assertEquals(items[0].carried_from, "source-item");
      assertEquals(items[0].carried_from_cycle, { id: "source-cycle", name: "Previous sprint" });
      assertObjectMatch(items[0], {
        title: frozen ? "Snapshot title" : "Live title",
        status: "open",
        frozen,
        in_plan: true,
        carry_count: 1,
        carried_manual: true,
        to_carry: false,
      });
    });
  });
}

Deno.test("carry source: absent provenance remains null without extra lookups", async () => {
  await withSourceFixture({ from: null }, async (read, calls) => {
    const [item] = await read();
    assertEquals(item.carried_from, null);
    assertEquals(item.carried_from_cycle, null);
    assertEquals(calls.filter((url) => url.pathname.endsWith("/sprint_items")).length, 1);
    assertEquals(calls.filter((url) => url.pathname.endsWith("/sprint_cycles")).length, 1);
  });
});

for (
  const [label, scenario] of [
    ["missing source item", { missingItem: true }],
    ["missing source sprint", { missingCycle: true }],
    ["foreign source sprint", { sourceGroup: "foreign-workspace" }],
    ["deleted source sprint", { archived: true }],
  ] as const
) {
  Deno.test(`carry source: ${label} never supplies an unverified name`, async () => {
    await withSourceFixture(scenario, async (read) => {
      const [item] = await read();
      assertEquals(item.carried_from, "source-item");
      assertEquals(item.carried_from_cycle, null);
      assertEquals(item.carry_count, 1);
    });
  });
}

Deno.test("carry source: a failed lookup is an error, not a fabricated missing source", async () => {
  await withSourceFixture({ cycleFailure: true }, async (read) => {
    await assertRejects(read, Error, "sprint carry source cycles");
  });
});
