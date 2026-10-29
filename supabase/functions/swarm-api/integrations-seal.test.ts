// Ключ Granola при сохранении из веба (#585): в базу уходит шифротекст, а читатель (поллер,
// ручки /granola/notes*) получает исходный ключ через openIntegrationKey.
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeIntegrationsDeps } from "./integrations.ts";
import { isSealedKey, openIntegrationKey } from "../_shared/integration-keys.ts";

const ENC_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
const GRANOLA = "grn_live_test_0123456789abcdef";

Deno.test("сохранение ключа Granola: в базе лежит шифротекст, а поллер читает исходный ключ", async () => {
  Deno.env.set("WORKSPACE_SECRETS_KEY", ENC_KEY);
  try {
    const rows: Array<Record<string, unknown>> = [];
    const db = {
      from: () => ({
        upsert: (row: Record<string, unknown>) => {
          rows.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as SupabaseClient;
    await makeIntegrationsDeps(db).saveGranolaKey(42, GRANOLA);
    assertEquals(rows.length, 1);
    const stored = rows[0].api_key as string;
    assertNotEquals(stored, GRANOLA);
    assert(isSealedKey(stored));
    assert(!stored.includes(GRANOLA));
    assertEquals(await openIntegrationKey(stored, 42, "granola"), GRANOLA);
  } finally {
    Deno.env.delete("WORKSPACE_SECRETS_KEY");
  }
});
