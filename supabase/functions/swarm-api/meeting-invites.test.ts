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
