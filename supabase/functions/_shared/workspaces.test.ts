import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createWorkspace, generateWorkspaceId, validateWorkspaceName, WORKSPACE_NAME_MAX } from "./workspaces.ts";

Deno.test("слаг: ws- и 8 символов base32, детерминирован от байтов", () => {
  assertEquals(generateWorkspaceId(new Uint8Array(8)), "ws-aaaaaaaa");
  assertEquals(generateWorkspaceId(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), "ws-abcdefgh");
  assertEquals(generateWorkspaceId(new Uint8Array(8).fill(31)), "ws-77777777");
  // 32 переходит в начало алфавита: смещения нет, потому что 256 кратно 32
  assertEquals(generateWorkspaceId(new Uint8Array(8).fill(32)), "ws-aaaaaaaa");
});

Deno.test("слаг: случайный, всегда по шаблону и не повторяется на выборке", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = generateWorkspaceId();
    assert(/^ws-[a-z2-7]{8}$/.test(id), id);
    seen.add(id);
  }
  assertEquals(seen.size, 500);
});

Deno.test("название: trim, пустое и слишком длинное отвергаются", () => {
  assertEquals(validateWorkspaceName("  World  "), { ok: true, name: "World" });
  assertEquals(validateWorkspaceName("x".repeat(WORKSPACE_NAME_MAX)).ok, true);
  assertEquals(validateWorkspaceName("x".repeat(WORKSPACE_NAME_MAX + 1)).ok, false);
  assertEquals(validateWorkspaceName("").ok, false);
  assertEquals(validateWorkspaceName("   \t ").ok, false);
  assertEquals(validateWorkspaceName(undefined).ok, false);
  assertEquals(validateWorkspaceName(42).ok, false);
  assertEquals(validateWorkspaceName("Wor\nld").ok, false);
  // длина — в символах, а не в байтах: кириллица в пределе проходит
  assertEquals(validateWorkspaceName("Я".repeat(WORKSPACE_NAME_MAX)).ok, true);
});

function fakeInserts(failFirst: number) {
  const inserted: Array<Record<string, unknown>> = [];
  let attempts = 0;
  const client = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        assertEquals(table, "workspaces");
        attempts++;
        if (attempts <= failFirst) return Promise.resolve({ error: { code: "23505", message: "dup" } });
        inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserted, attempts: () => attempts };
}

Deno.test("создание: слаг не выводится из названия, страны нормализуются", async () => {
  const { client, inserted } = fakeInserts(0);
  const ws = await createWorkspace(client, { name: "Turkey and co", countries: ["tr", "Грузия", "TR", "zz"] });
  assert(/^ws-[a-z2-7]{8}$/.test(ws.id));
  assert(!ws.id.includes("turkey"));
  assertEquals(inserted[0].name, "Turkey and co");
  assertEquals(inserted[0].allowed_markets, ["TR", "GE"]);
  assertEquals(ws.allowed_markets, ["TR", "GE"]);
});

Deno.test("создание: без стран — глобальный список (null)", async () => {
  const { client, inserted } = fakeInserts(0);
  await createWorkspace(client, { name: "World" });
  assertEquals(inserted[0].allowed_markets, null);
});

Deno.test("создание: столкновение слага — новый слаг, после лимита попыток — ошибка", async () => {
  const ok = fakeInserts(2);
  const ids = ["ws-aaaaaaaa", "ws-bbbbbbbb", "ws-cccccccc"];
  const made = await createWorkspace(ok.client, { name: "World" }, () => ids.shift()!);
  assertEquals(made.id, "ws-cccccccc");
  assertEquals(ok.attempts(), 3);

  const dead = fakeInserts(99);
  await assertRejects(() => createWorkspace(dead.client, { name: "World" }), Error, "слаг");
  assertEquals(dead.attempts(), 5);
});

Deno.test("создание: чужая ошибка базы не маскируется под столкновение", async () => {
  const client = {
    from: () => ({ insert: () => Promise.resolve({ error: { code: "42501", message: "denied" } }) }),
  } as unknown as SupabaseClient;
  await assertRejects(() => createWorkspace(client, { name: "World" }), Error, "denied");
});
