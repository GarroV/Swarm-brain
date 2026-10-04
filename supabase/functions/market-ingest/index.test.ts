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

Deno.test("admin actions need an admin's MCP token: the collector token is refused, each token does only its own work", async () => {
  const ADMIN = 744230399;
  const findAdmin = (bearer: string) => Promise.resolve(bearer === "smcp_admin" ? ADMIN : null);
  const post = (auth: string, body: unknown) =>
    handleIngest(
      new Request("http://x", {
        method: "POST",
        headers: { authorization: auth },
        body: JSON.stringify(body),
      }),
      "t0ken",
      findAdmin,
    );
  const started_at = "2026-10-02T00:00:00Z";
  const accept = { source: "accept_new", country: "HR", started_at };
  const snapshot = {
    source: "snapshot",
    country: "HR",
    started_at,
    snapshot: { nonsense: true },
  };
  assertEquals((await post("Bearer nope", accept)).status, 401);
  // MCP-токен не админа (findAdmin вернул null) — как чужой
  assertEquals((await post("Bearer smcp_member", accept)).status, 401);
  // токен сборщика (лежит в Actions) решений не принимает
  assertEquals((await post("Bearer t0ken", accept)).status, 403);
  assertEquals((await post("Bearer t0ken", snapshot)).status, 403);
  // админ не льёт данные сборщика
  assertEquals(
    (await post("Bearer smcp_admin", {
      source: "osm",
      country: "HR",
      started_at,
      failed: "x",
    })).status,
    403,
  );
  const bad = await post("Bearer smcp_admin", snapshot);
  assertEquals(bad.status, 400);
  assert(Array.isArray((await bad.json()).details));
});
