// Приглашение бота (D017): площадку, куда бот не ходит, сервер отбивает сразу при вставке ссылки,
// а не заводит приглашение, которое потом кончится пустой встречей с join_failed.
//
// Отказ обязан случиться ДО базы: заглушка supabase падает при любом обращении, поэтому
// «отказ после вставки строки» здесь красный, а не зелёный.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleMeetingInviteRoutes, type InviteContext } from "./meeting-invites.ts";

const untouchable = new Proxy({}, {
  get(_t, prop) {
    throw new Error(`база не должна трогаться при отказе (обращение к ${String(prop)})`);
  },
}) as SupabaseClient;

function ctx(): InviteContext {
  return { supabase: untouchable, telegramId: 1, groupId: "ws1", isDemo: false, origin: "http://localhost" };
}

function post(joinUrl: unknown): Request {
  return new Request("http://localhost/meeting-invites", {
    method: "POST",
    body: JSON.stringify({ join_url: joinUrl }),
  });
}

for (
  const [name, url] of [
    ["Контур.Толк", "https://team.ktalk.ru/room42"],
    ["Контур.Толк (talk.kontur.ru)", "https://talk.kontur.ru/room42"],
    ["Zoom", "https://us02web.zoom.us/j/123456789?pwd=abc"],
  ] as const
) {
  Deno.test(`БЛОКИРУЮЩИЙ: ${name} — 400 unsupported_platform на EN и RU, приглашение не заводится`, async () => {
    const res = await handleMeetingInviteRoutes(ctx(), post(url), "/meeting-invites");
    assertEquals(res?.status, 400);
    const body = await res!.json();
    assertEquals(body.code, "unsupported_platform");
    assertEquals(typeof body.error, "string");
    assertEquals(typeof body.error_ru, "string");
    assertEquals(/Google Meet/.test(body.error) && /Google Meet/.test(body.error_ru), true);
  });
}

Deno.test("мусор вместо ссылки — по-прежнему invalid_link, а не отказ площадки", async () => {
  const res = await handleMeetingInviteRoutes(ctx(), post("not a link"), "/meeting-invites");
  assertEquals(res?.status, 400);
  assertEquals((await res!.json()).code, "invalid_link");
});

// ── Остальные границы обработчика: демо, потолок, повтор ссылки, чтение только своего ─────────

interface FakeDb {
  client: SupabaseClient;
  inserted: unknown[];
  filters: [string, unknown][];
}

/** Цепочка запросов supabase-js: фильтры копятся, ответ — заданные строки. */
function fakeDb(rows: Record<string, unknown>[]): FakeDb {
  const inserted: unknown[] = [];
  const filters: [string, unknown][] = [];
  const chain = (result: () => unknown): Record<string, unknown> => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (col: string, v: unknown) => (filters.push([col, v]), q),
      is: () => q,
      gt: () => q,
      single: () => Promise.resolve(result()),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
    };
    return q;
  };
  const client = {
    from: () => ({
      ...chain(() => ({ data: rows[0] ?? null, error: null })),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return chain(() => ({
          data: { id: "22222222-2222-4222-8222-222222222222", taken_at: null, used_at: null, meeting_id: null, ...row },
          error: null,
        }));
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserted, filters };
}

const MEET = "https://meet.google.com/abc-defg-hij";
const row = (o: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  group_id: "ws1",
  invited_by: 1,
  join_url: MEET,
  platform: "meet",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  taken_at: null,
  used_at: null,
  meeting_id: null,
  ...o,
});

Deno.test("БЛОКИРУЮЩИЙ: из демо бота не позвать — 403, база не трогается", async () => {
  const res = await handleMeetingInviteRoutes({ ...ctx(), isDemo: true }, post(MEET), "/meeting-invites");
  assertEquals(res?.status, 403);
  assertEquals((await res!.json()).code, "demo_not_allowed");
});

Deno.test("тело не JSON — invalid_link, а не 500", async () => {
  const req = new Request("http://localhost/meeting-invites", { method: "POST", body: "{" });
  const res = await handleMeetingInviteRoutes(ctx(), req, "/meeting-invites");
  assertEquals((await res!.json()).code, "invalid_link");
});

Deno.test("ссылка на Meet — 201, приглашение заводится на позвавшего в его воркспейсе", async () => {
  const db = fakeDb([]);
  const res = await handleMeetingInviteRoutes({ ...ctx(), supabase: db.client }, post(MEET), "/meeting-invites");
  assertEquals(res?.status, 201);
  assertEquals((await res!.json()).invite.status, "pending");
  const ins = db.inserted[0] as Record<string, unknown>;
  assertEquals([ins.invited_by, ins.group_id, ins.platform], [1, "ws1", "meet"]);
});

Deno.test("та же комната ещё ждёт бота — 200 то же приглашение, второе не заводится", async () => {
  const db = fakeDb([row()]);
  const res = await handleMeetingInviteRoutes(
    { ...ctx(), supabase: db.client },
    post(`${MEET}/?hl=en`),
    "/meeting-invites",
  );
  assertEquals(res?.status, 200);
  assertEquals(db.inserted.length, 0);
});

Deno.test("БЛОКИРУЮЩИЙ: три живых приглашения — четвёртое 429, не заводится", async () => {
  const rooms = ["aaa-bbbb-ccc", "ddd-eeee-fff", "ggg-hhhh-iii"];
  const db = fakeDb(rooms.map((r) => row({ join_url: `https://meet.google.com/${r}` })));
  const res = await handleMeetingInviteRoutes({ ...ctx(), supabase: db.client }, post(MEET), "/meeting-invites");
  assertEquals(res?.status, 429);
  assertEquals(db.inserted.length, 0);
});

Deno.test("БЛОКИРУЮЩИЙ: чтение приглашения — только своё и только в своём воркспейсе; мусорный id — 404", async () => {
  const db = fakeDb([row()]);
  const c = { ...ctx(), supabase: db.client };
  const get = (id: string) => new Request(`http://localhost/meeting-invites/${id}`);
  const ok = await handleMeetingInviteRoutes(c, get(row().id), `/meeting-invites/${row().id}`);
  assertEquals(ok?.status, 200);
  assertEquals(db.filters.some(([k, v]) => k === "invited_by" && v === 1), true);
  assertEquals(db.filters.some(([k, v]) => k === "group_id" && v === "ws1"), true);
  const bad = await handleMeetingInviteRoutes(c, get("x"), "/meeting-invites/x");
  assertEquals(bad?.status, 404);
  assertEquals(await handleMeetingInviteRoutes(c, get("x"), "/meeting-invites/x/y"), null);
});
