import { assert, assertEquals } from "@std/assert";
Deno.env.set(
  "SUPABASE_URL",
  Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:1",
);
Deno.env.set(
  "SUPABASE_SERVICE_ROLE_KEY",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "x",
);
const { handleIngest, sameSecret } = await import("./index.ts");

Deno.test("sameSecret: exact match only, empty expected never passes", () => {
  assert(sameSecret("abc", "abc"));
  assert(!sameSecret("abd", "abc"));
  assert(!sameSecret("ab", "abc"));
  assert(!sameSecret("", ""));
});

Deno.test("ingest rejects wrong method, wrong token and bad payload before touching the base", async () => {
  const post = (auth: string, body: string) =>
    handleIngest(
      new Request("http://x", {
        method: "POST",
        headers: { authorization: auth },
        body,
      }),
      "t0ken",
    );
  assertEquals(
    (await handleIngest(new Request("http://x"), "t0ken")).status,
    405,
  );
  assertEquals((await post("Bearer nope", "{}")).status, 401);
  assertEquals((await post("", "{}")).status, 401);
  assertEquals(
    (await post(
      "Bearer t0ken",
      '{"source":"osm","country":"HRV","started_at":"x"}',
    )).status,
    400,
  );
  assertEquals((await post("Bearer t0ken", "not json")).status, 400);
});

Deno.test("admin actions of the collector: token required, a broken snapshot is refused with details before the base", async () => {
  const post = (auth: string, body: unknown) =>
    handleIngest(
      new Request("http://x", {
        method: "POST",
        headers: { authorization: auth },
        body: JSON.stringify(body),
      }),
      "t0ken",
    );
  const started_at = "2026-10-02T00:00:00Z";
  assertEquals(
    (await post("Bearer nope", { source: "accept_new", country: "HR", started_at })).status,
    401,
  );
  const bad = await post("Bearer t0ken", {
    source: "snapshot",
    country: "HR",
    started_at,
    snapshot: { nonsense: true },
  });
  assertEquals(bad.status, 400);
  assert(Array.isArray((await bad.json()).details));
});
