import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isSealedKey, openIntegrationKey, sealIntegrationKey, sealLegacyKeys } from "./integration-keys.ts";

const ENC_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
const GRANOLA = "grn_live_test_0123456789abcdef";

async function withKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get("WORKSPACE_SECRETS_KEY");
  if (value === undefined) Deno.env.delete("WORKSPACE_SECRETS_KEY");
  else Deno.env.set("WORKSPACE_SECRETS_KEY", value);
  try {
    return await fn();
  } finally {
    if (prev === undefined) Deno.env.delete("WORKSPACE_SECRETS_KEY");
    else Deno.env.set("WORKSPACE_SECRETS_KEY", prev);
  }
}

type Row = { telegram_id: number; service: string; api_key: string };

/** Фейковая user_integrations: select/update(eq…)/upsert — ровно то, что зовёт код под тестом. */
function fakeDb(rows: Row[]) {
  const client = {
    from(_table: string) {
      return {
        select: () => ({
          eq: (_c: string, service: string) =>
            Promise.resolve({ data: rows.filter((r) => r.service === service).map((r) => ({ ...r })), error: null }),
        }),
        update: (patch: Partial<Row>) => {
          const conds: [string, unknown][] = [];
          const q: { eq: (c: string, v: unknown) => unknown } & PromiseLike<{ error: null }> = {
            eq: (c, v) => {
              conds.push([c, v]);
              return q;
            },
            then: (res) => {
              for (const r of rows) {
                if (conds.every(([c, v]) => (r as Record<string, unknown>)[c] === v)) Object.assign(r, patch);
              }
              return Promise.resolve({ error: null }).then(res);
            },
          };
          return q;
        },
        upsert: (row: Row) => {
          const i = rows.findIndex((r) => r.telegram_id === row.telegram_id && r.service === row.service);
          if (i >= 0) rows[i] = { ...rows[i], ...row };
          else rows.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return client as unknown as SupabaseClient;
}

Deno.test("integration-keys: seal → open возвращает исходный ключ, в строке его нет", async () => {
  await withKey(ENC_KEY, async () => {
    const stored = await sealIntegrationKey(GRANOLA, 42, "granola");
    assert(isSealedKey(stored));
    assert(!stored.includes(GRANOLA));
    assertEquals(await openIntegrationKey(stored, 42, "granola"), GRANOLA);
  });
});

Deno.test("integration-keys: старый открытый ключ читается как есть, без ключа шифрования", async () => {
  await withKey(undefined, async () => {
    assertEquals(await openIntegrationKey(GRANOLA, 42, "granola"), GRANOLA);
  });
});

Deno.test("integration-keys: без ключа шифрования запись падает, а не пишет открытый текст", async () => {
  await withKey(undefined, async () => {
    await assertRejects(() => sealIntegrationKey(GRANOLA, 42, "granola"), Error, "WORKSPACE_SECRETS_KEY");
  });
});

Deno.test("integration-keys: строка, перенесённая другому человеку или сервису, не расшифровывается", async () => {
  await withKey(ENC_KEY, async () => {
    const stored = await sealIntegrationKey(GRANOLA, 42, "granola");
    await assertRejects(() => openIntegrationKey(stored, 43, "granola"), Error, "не расшифровывается");
    await assertRejects(() => openIntegrationKey(stored, 42, "other"), Error, "не расшифровывается");
  });
});

Deno.test("integration-keys: повреждённая зашифрованная строка — ошибка, не пустой ключ", async () => {
  await withKey(ENC_KEY, async () => {
    await assertRejects(() => openIntegrationKey("enc:v1:onlyone", 42, "granola"), Error, "формат");
  });
});

Deno.test("sealLegacyKeys: открытые ключи шифруются, повторный прогон ничего не меняет", async () => {
  await withKey(ENC_KEY, async () => {
    const rows: Row[] = [
      { telegram_id: 1, service: "granola", api_key: "plain-one-0000000000" },
      { telegram_id: 2, service: "granola", api_key: await sealIntegrationKey("already-2", 2, "granola") },
      { telegram_id: 3, service: "google_calendar", api_key: "refresh-untouched" },
    ];
    const keptSealed = rows[1].api_key;
    const first = await sealLegacyKeys(fakeDb(rows), "granola");
    assertEquals(first, { sealed: 1, alreadySealed: 1, failed: 0 });
    assertEquals(rows.filter((r) => r.service === "granola" && !isSealedKey(r.api_key)).length, 0);
    assertEquals(await openIntegrationKey(rows[0].api_key, 1, "granola"), "plain-one-0000000000");
    assertEquals(rows[1].api_key, keptSealed);
    assertEquals(rows[2].api_key, "refresh-untouched");
    const after = rows.map((r) => r.api_key);
    const second = await sealLegacyKeys(fakeDb(rows), "granola");
    assertEquals(second, { sealed: 0, alreadySealed: 2, failed: 0 });
    assertEquals(rows.map((r) => r.api_key), after);
  });
});

Deno.test("sealLegacyKeys: без ключа шифрования строки остаются как были и считаются сбойными", async () => {
  await withKey(undefined, async () => {
    const rows: Row[] = [{ telegram_id: 1, service: "granola", api_key: "plain-one-0000000000" }];
    const r = await sealLegacyKeys(fakeDb(rows), "granola");
    assertEquals(r, { sealed: 0, alreadySealed: 0, failed: 1 });
    assertEquals(rows[0].api_key, "plain-one-0000000000");
  });
});

Deno.test("sealLegacyKeys: dryRun ничего не пишет", async () => {
  await withKey(ENC_KEY, async () => {
    const rows: Row[] = [{ telegram_id: 1, service: "granola", api_key: "plain-one-0000000000" }];
    const r = await sealLegacyKeys(fakeDb(rows), "granola", true);
    assertEquals(r.sealed, 1);
    assertEquals(rows[0].api_key, "plain-one-0000000000");
  });
});
