// Веб-вход только через Google: личность человека должна совпасть со строкой, где у него уже
// есть настоящий (положительный) telegram_id — иначе пропадут его записи, задачи, passkey.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeLike, findAllowedUserByEmail } from "./allowed-user-by-email.ts";

type Row = { id: number; email: string | null; telegram_id: number | null; group_id: string | null };

/** Мини-база: eq — точное сравнение, ilike — как в Postgres (без учёта регистра, \ экранирует). */
function fakeDb(rows: Row[], failWith?: string): SupabaseClient {
  const likeToRegExp = (p: string) => {
    let re = "";
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === "\\") re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      else if (c === "%") re += ".*";
      else if (c === "_") re += ".";
      else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`, "i");
  };
  const q = (match: (r: Row) => boolean) => ({
    maybeSingle: () => {
      if (failWith) return Promise.resolve({ data: null, error: { message: failWith } });
      const hit = rows.filter(match);
      return Promise.resolve({ data: hit[0] ?? null, error: null });
    },
  });
  return {
    from: () => ({
      select: () => ({
        eq: (_c: string, v: string) => q((r) => r.email === v),
        ilike: (_c: string, p: string) => q((r) => r.email != null && likeToRegExp(p).test(r.email)),
      }),
    }),
  } as unknown as SupabaseClient;
}

const ANNA: Row = { id: 7, email: "Anna.Petrova@dodobrands.io", telegram_id: 4242, group_id: "alpha" };
const BOB: Row = { id: 8, email: "bob@dodobrands.io", telegram_id: 5151, group_id: "alpha" };

Deno.test("Google sign-in resolves to the existing row with the real telegram_id", async () => {
  const row = await findAllowedUserByEmail(fakeDb([ANNA, BOB]), "bob@dodobrands.io");
  assertEquals([row?.id, row?.telegram_id, row?.group_id], [8, 5151, "alpha"]);
});

Deno.test("matches a mixed-case stored email, keeps the positive telegram_id", async () => {
  const row = await findAllowedUserByEmail(fakeDb([ANNA, BOB]), "anna.petrova@dodobrands.io");
  assertEquals(row?.id, 7);
  assertEquals(row?.telegram_id, 4242);
});

Deno.test("lookup is case- and whitespace-insensitive on the Google side too", async () => {
  const row = await findAllowedUserByEmail(fakeDb([BOB]), "  BOB@DodoBrands.io ");
  assertEquals(row?.telegram_id, 5151);
});

Deno.test("unknown email gives null, not someone else", async () => {
  assertEquals(await findAllowedUserByEmail(fakeDb([ANNA, BOB]), "eve@dodobrands.io"), null);
  assertEquals(await findAllowedUserByEmail(fakeDb([ANNA, BOB]), ""), null);
});

Deno.test("LIKE wildcards in the email are data, not a pattern", async () => {
  const rows: Row[] = [{ id: 1, email: "axb@dodobrands.io", telegram_id: 1, group_id: null }];
  assertEquals(await findAllowedUserByEmail(fakeDb(rows), "a_b@dodobrands.io"), null);
  assertEquals(await findAllowedUserByEmail(fakeDb(rows), "%@dodobrands.io"), null);
  assertEquals(escapeLike("a_b%c\\d"), "a\\_b\\%c\\\\d");
});

Deno.test("a database error is thrown, not reported as 'no access'", async () => {
  await assertRejects(() => findAllowedUserByEmail(fakeDb([BOB], "boom"), "bob@dodobrands.io"), Error, "boom");
});
