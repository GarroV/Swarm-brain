import { assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AUDIO_RETENTION_DAYS,
  chunk,
  isPurgeMinute,
  PURGE_MINUTE,
  purgeExpiredAudio,
} from "./meeting-audio-retention.ts";

function fakeSupabase(paths: string[], opts: { rpcError?: string; removeError?: string } = {}) {
  const removed: string[][] = [];
  const rpcArgs: unknown[] = [];
  const client = {
    rpc: (_fn: string, args: unknown) => {
      rpcArgs.push(args);
      return Promise.resolve(
        opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: paths, error: null },
      );
    },
    storage: {
      from: (_bucket: string) => ({
        remove: (part: string[]) => {
          removed.push(part);
          return Promise.resolve(opts.removeError ? { error: { message: opts.removeError } } : { error: null });
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, removed, rpcArgs };
}

Deno.test("purgeExpiredAudio: удаляет всё из списка пачками и просит неделю", async () => {
  const paths = Array.from({ length: 250 }, (_, i) => `m/${i}.m4a`);
  const { client, removed, rpcArgs } = fakeSupabase(paths);
  assertEquals(await purgeExpiredAudio(client, "meeting-audio"), 250);
  assertEquals(removed.map((p) => p.length), [100, 100, 50]);
  assertEquals(removed.flat(), paths);
  assertEquals((rpcArgs[0] as { p_days: number }).p_days, AUDIO_RETENTION_DAYS);
  assertEquals(AUDIO_RETENTION_DAYS, 7);
});

Deno.test("purgeExpiredAudio: пустой список — ничего не удаляет", async () => {
  const { client, removed } = fakeSupabase([]);
  assertEquals(await purgeExpiredAudio(client, "meeting-audio"), 0);
  assertEquals(removed.length, 0);
});

Deno.test("purgeExpiredAudio: сбой списка или удаления — исключение, а не тихий ноль", async () => {
  await assertRejects(
    () => purgeExpiredAudio(fakeSupabase([], { rpcError: "нет функции" }).client, "b"),
    Error,
    "нет функции",
  );
  await assertRejects(() => purgeExpiredAudio(fakeSupabase(["a"], { removeError: "403" }).client, "b"), Error, "403");
});

Deno.test("isPurgeMinute: раз в час, в свою минуту", () => {
  assertEquals(isPurgeMinute(new Date(Date.UTC(2026, 9, 8, 13, PURGE_MINUTE))), true);
  assertEquals(isPurgeMinute(new Date(Date.UTC(2026, 9, 8, 13, PURGE_MINUTE + 1))), false);
});

Deno.test("chunk: режет без потерь", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
