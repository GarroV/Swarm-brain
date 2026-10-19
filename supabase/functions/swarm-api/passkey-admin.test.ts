import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePasskeyAdminRoutes } from "./passkey-admin.ts";
import { MemoryStore } from "../_shared/passkeys/memory-store.ts";
import { SUPERADMIN_TELEGRAM_ID } from "./admin-scope.ts";

type Row = { telegram_id: number; group_id: string };
const PEOPLE: Row[] = [
  { telegram_id: 11, group_id: "ws-a" },
  { telegram_id: 22, group_id: "ws-b" },
  { telegram_id: SUPERADMIN_TELEGRAM_ID, group_id: "ws-a" },
];

// Мок: allowed_users — .select().eq(telegram_id).eq(group_id).maybeSingle(); master_admins — по telegram_id.
// masters — строки таблицы; mastersBroken — чтение таблицы падает (таблицы нет, база недоступна).
let masters: number[] = [];
let mastersBroken = false;

function fakeSupabase(): SupabaseClient {
  return {
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => {
          f[k] = v;
          return b;
        },
        maybeSingle: () => {
          if (table === "master_admins") {
            if (mastersBroken) return Promise.resolve({ data: null, error: { message: "relation does not exist" } });
            return Promise.resolve({
              data: masters.includes(f.telegram_id as number) ? { telegram_id: f.telegram_id } : null,
              error: null,
            });
          }
          return Promise.resolve({
            data: PEOPLE.find((p) => p.telegram_id === f.telegram_id && p.group_id === f.group_id) ?? null,
            error: null,
          });
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

function resetFakes() {
  masters = [];
  mastersBroken = false;
}

function seeded() {
  resetFakes();
  const store = new MemoryStore();
  for (const [telegramId, credentialId] of [[11, "k11"], [22, "k22"], [SUPERADMIN_TELEGRAM_ID, "kroot"]] as const) {
    store.keys.push({ id: credentialId, telegramId, credentialId, publicKey: "p", signCount: 0, transports: [] });
  }
  return store;
}

async function reset(store: MemoryStore, actor: { telegramId: number; groupId: string }, wsId: string, userId: string) {
  const res = await handlePasskeyAdminRoutes(
    fakeSupabase(),
    store,
    new Request("https://x", { method: "DELETE" }),
    `/admin/workspaces/${wsId}/users/${userId}/passkeys`,
    actor,
    "https://swarm-team.app",
  );
  return { status: res!.status, body: await res!.json() };
}

Deno.test("админ пространства сбрасывает вход своего человека: ключи сняты, чужие целы", async () => {
  const store = seeded();
  const r = await reset(store, { telegramId: 5, groupId: "ws-a" }, "ws-a", "11");
  assertEquals([r.status, r.body], [200, { ok: true, removed: 1 }]);
  assertEquals(store.keys.map((k) => k.credentialId).sort(), ["k22", "kroot"]);
});

Deno.test("админ чужого пространства: 404 и ключи целы", async () => {
  const store = seeded();
  // Чужое пространство целиком.
  assertEquals((await reset(store, { telegramId: 5, groupId: "ws-a" }, "ws-b", "22")).status, 404);
  // Человек из чужого пространства под своим же wsId админа.
  assertEquals((await reset(store, { telegramId: 5, groupId: "ws-a" }, "ws-a", "22")).status, 404);
  assertEquals(store.keys.length, 3);
});

Deno.test("суперадмин сбрасывает вход в любом пространстве", async () => {
  const store = seeded();
  const r = await reset(store, { telegramId: SUPERADMIN_TELEGRAM_ID, groupId: "ws-a" }, "ws-b", "22");
  assertEquals([r.status, r.body.removed], [200, 1]);
});

Deno.test("аккаунт суперадмина админ пространства не сбрасывает (403)", async () => {
  const store = seeded();
  const r = await reset(store, { telegramId: 5, groupId: "ws-a" }, "ws-a", String(SUPERADMIN_TELEGRAM_ID));
  assertEquals(r.status, 403);
  assertEquals(store.keys.some((k) => k.credentialId === "kroot"), true);
});

Deno.test("мастер-админа из таблицы master_admins админ пространства не сбрасывает (403), мастер — может", async () => {
  const store = seeded();
  masters = [11, 5]; // 11 — цель (мастер), 5 — второй мастер
  assertEquals((await reset(store, { telegramId: 6, groupId: "ws-a" }, "ws-a", "11")).status, 403);
  assertEquals(store.keys.some((k) => k.credentialId === "k11"), true);
  // Мастер из таблицы сбрасывает мастеру в своём пространстве.
  assertEquals((await reset(store, { telegramId: 5, groupId: "ws-a" }, "ws-a", "11")).status, 200);
});

Deno.test("сбой чтения master_admins — отказ, ключи целы (не «раз не прочли, значит не мастер»)", async () => {
  const store = seeded();
  mastersBroken = true;
  const r = await reset(store, { telegramId: 6, groupId: "ws-a" }, "ws-a", "11");
  assertEquals(r.status >= 400, true);
  assertEquals(store.keys.length, 3);
  // Суперадмину таблица не нужна: константа решает сама.
  const sa = await reset(store, { telegramId: SUPERADMIN_TELEGRAM_ID, groupId: "ws-a" }, "ws-a", "11");
  assertEquals(sa.status, 200);
});

Deno.test("ожидающее приглашение и кривой адрес: 404 и 400; чужой метод — маршрут не отвечает", async () => {
  const store = seeded();
  assertEquals((await reset(store, { telegramId: 5, groupId: "ws-a" }, "ws-a", "a%40b.co")).status, 404);
  assertEquals((await reset(store, { telegramId: 5, groupId: "ws-a" }, "ws-a", "%20")).status, 400);
  const none = await handlePasskeyAdminRoutes(
    fakeSupabase(),
    store,
    new Request("https://x", { method: "GET" }),
    "/admin/workspaces/ws-a/users/11/passkeys",
    { telegramId: 5, groupId: "ws-a" },
    "https://x",
  );
  assertEquals(none, null);
});
