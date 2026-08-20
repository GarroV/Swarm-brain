import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleAdminRoutes } from "./admin.ts";

// ── Мок цепочки postgrest ─────────────────────────────────────────────────────
// Терминал — maybeSingle/single; update/upsert возвращают тот же builder, поэтому цепочка
// `.update().is().eq().select().maybeSingle()` записывается целиком в calls.

type Call = { method: string; args: unknown[] };

function makeSupabase(terminal: { data?: unknown; error?: unknown } = { data: { id: 29 } }): {
  client: SupabaseClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "update", "upsert", "insert", "delete", "in", "not", "limit", "order", "ilike"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.maybeSingle = () => Promise.resolve(terminal);
  builder.single = () => Promise.resolve(terminal);
  // await напрямую на цепочке (например `await supabase.from(...).upsert(...)`)
  builder.then = (res: (v: unknown) => unknown) => Promise.resolve(terminal).then(res);
  const client = {
    from: (...args: unknown[]) => {
      calls.push({ method: "from", args });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function patchReq(body: unknown): Request {
  return new Request("https://x/admin", { method: "PATCH", body: JSON.stringify(body) });
}

const ADMIN = 744230399;

Deno.test("PATCH /admin/users/:username — ожидающему приглашению привязывается email (lower)", async () => {
  const { client, calls } = makeSupabase({ data: { id: 29 } });
  const res = await handleAdminRoutes(client, patchReq({ email: "I.Ravilova@Dodobrands.IO" }), "/admin/users/indira56", ADMIN, true, "*");
  assertEquals(res!.status, 200);
  assertEquals(await res!.json(), { ok: true, pending: true, email: "i.ravilova@dodobrands.io" });
  // адресуемся по username И только среди строк без telegram_id (чужого юзера не задеть)
  assertEquals(calls.find((c) => c.method === "update")?.args[0], { email: "i.ravilova@dodobrands.io" });
  assertEquals(calls.find((c) => c.method === "is")?.args, ["telegram_id", null]);
  assertEquals(calls.find((c) => c.method === "eq")?.args, ["username", "indira56"]);
  assertEquals(calls.find((c) => c.method === "from")?.args, ["allowed_users"]);
});

Deno.test("PATCH /admin/users/:email — ожидающее email-only приглашение адресуется по прежней почте", async () => {
  const { client, calls } = makeSupabase({ data: { id: 30 } });
  const res = await handleAdminRoutes(client, patchReq({ email: "new@dodobrands.io" }), "/admin/users/old%40dodobrands.io", ADMIN, true, "*");
  assertEquals(res!.status, 200);
  assertEquals(calls.find((c) => c.method === "eq")?.args, ["email", "old@dodobrands.io"]);
});

Deno.test("PATCH ожидающему с полями профиля — честная 400, а не молча проглоченный запрос", async () => {
  const { client, calls } = makeSupabase();
  const res = await handleAdminRoutes(client, patchReq({ email: "a@b.io", role: "BD" }), "/admin/users/indira56", ADMIN, true, "*");
  assertEquals(res!.status, 400);
  assertEquals(calls.length, 0); // в базу не ходили
});

Deno.test("PATCH ожидающему без email — 400 (нечего сохранять)", async () => {
  const { client } = makeSupabase();
  const res = await handleAdminRoutes(client, patchReq({}), "/admin/users/indira56", ADMIN, true, "*");
  assertEquals(res!.status, 400);
});

Deno.test("PATCH — приглашение не найдено → 404", async () => {
  const { client } = makeSupabase({ data: null });
  const res = await handleAdminRoutes(client, patchReq({ email: "a@b.io" }), "/admin/users/nosuchuser", ADMIN, true, "*");
  assertEquals(res!.status, 404);
});

Deno.test("PATCH — занятый email → 409 с понятным текстом", async () => {
  const { client } = makeSupabase({ data: null, error: { code: "23505", message: "duplicate" } });
  const res = await handleAdminRoutes(client, patchReq({ email: "taken@dodobrands.io" }), "/admin/users/indira56", ADMIN, true, "*");
  assertEquals(res!.status, 409);
});

Deno.test("PATCH реального юзера по telegram_id — прежний путь профиля не тронут", async () => {
  const { client, calls } = makeSupabase({ data: { telegram_id: 507931827 } });
  const res = await handleAdminRoutes(client, patchReq({ role: "BD", email: "K.Zabardaevax@dodobrands.io" }), "/admin/users/507931827", ADMIN, true, "*");
  assertEquals(res!.status, 200);
  assertEquals(calls.filter((c) => c.method === "from").map((c) => c.args[0]), ["user_profiles", "allowed_users", "user_profiles"]);
  const upsert = calls.find((c) => c.method === "upsert")!.args[0] as Record<string, unknown>;
  assertEquals(upsert.telegram_id, 507931827);
  assertEquals(upsert.role, "BD");
});

Deno.test("не админ — 403 до любых запросов", async () => {
  const { client, calls } = makeSupabase();
  const res = await handleAdminRoutes(client, patchReq({ email: "a@b.io" }), "/admin/users/indira56", 111, false, "*");
  assertEquals(res!.status, 403);
  assertEquals(calls.length, 0);
});

Deno.test("DELETE ожидающего по username — только строки без telegram_id и внутри воркспейса", async () => {
  const { client, calls } = makeSupabase();
  const req = new Request("https://x/admin", { method: "DELETE" });
  const res = await handleAdminRoutes(client, req, "/admin/workspaces/cee/users/indira56", ADMIN, true, "*");
  assertEquals(res!.status, 204);
  assertEquals(calls.find((c) => c.method === "is")?.args, ["telegram_id", null]);
  assertEquals(calls.filter((c) => c.method === "eq").map((c) => c.args), [["group_id", "cee"], ["username", "indira56"]]);
});

Deno.test("DELETE суперадмина запрещён", async () => {
  const { client } = makeSupabase();
  const req = new Request("https://x/admin", { method: "DELETE" });
  const res = await handleAdminRoutes(client, req, `/admin/workspaces/cee/users/${ADMIN}`, ADMIN, true, "*");
  assertEquals(res!.status, 400);
});
