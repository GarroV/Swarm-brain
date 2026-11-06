import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createNotificationFeed } from "./notificationFeed.ts";
import type { SwarmNotification } from "./notificationTypes.ts";

const item = (id: string): SwarmNotification => ({
  id,
  type: "task_reminder",
  task_id: null,
  task_title: "Fixture",
  comment_id: null,
  content: "",
  actor_telegram_id: null,
  actor_name: "Fixture",
  read_at: null,
  created_at: "2026-11-06T10:00:00Z",
});
const initial = () => ({ items: [item("a"), item("b")], unread: 2 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

Deno.test("all bell subscribers share one in-flight fetch and the same snapshot", async () => {
  const response = deferred<ReturnType<typeof initial>>();
  let calls = 0;
  const feed = createNotificationFeed({
    load: () => {
      calls++;
      return response.promise;
    },
    read: async () => {},
  });
  const first: number[] = [], second: number[] = [];
  feed.subscribe(() => first.push(feed.getSnapshot().unread));
  const unsubscribe = feed.subscribe(() =>
    second.push(feed.getSnapshot().unread)
  );
  const a = feed.refresh(), b = feed.refresh();
  await Promise.resolve();
  assertEquals(calls, 1);
  response.resolve(initial());
  await Promise.all([a, b]);
  assertEquals(first, [2]);
  assertEquals(second, [2]);
  unsubscribe();
  await feed.markRead();
  assertEquals(second, [2]);
});

Deno.test("mark all read changes every subscriber immediately and reconciles once", async () => {
  let server = initial();
  const save = deferred<void>();
  const feed = createNotificationFeed({
    load: async () => server,
    read: async () => {
      await save.promise;
      server = {
        items: server.items.map((n) => ({ ...n, read_at: "read" })),
        unread: 0,
      };
    },
  });
  await feed.refresh();
  const seen: number[] = [];
  feed.subscribe(() => seen.push(feed.getSnapshot().unread));
  const reading = feed.markRead();
  assertEquals(feed.getSnapshot().unread, 0);
  assertEquals(seen, [0]);
  save.resolve();
  await reading;
  assertEquals(feed.getSnapshot().unread, 0);
  assertEquals(feed.getSnapshot().items.every((n) => n.read_at), true);
});

Deno.test("overlapping single reads do not double-decrement or refetch per bell", async () => {
  let server = initial(), loads = 0;
  const a = deferred<void>(), b = deferred<void>();
  const feed = createNotificationFeed({
    load: async () => {
      loads++;
      return server;
    },
    read: async (ids) => {
      await (ids?.[0] === "a" ? a.promise : b.promise);
      server = {
        items: server.items.map((n) =>
          ids?.includes(n.id) ? { ...n, read_at: "read" } : n
        ),
        unread: server.unread - 1,
      };
    },
  });
  await feed.refresh();
  const readA = feed.markRead(["a"]), readB = feed.markRead(["b"]);
  await feed.markRead(["a"]);
  assertEquals(feed.getSnapshot().unread, 0);
  b.resolve();
  await readB;
  assertEquals(loads, 1);
  a.resolve();
  await readA;
  assertEquals(loads, 2);
  assertEquals(feed.getSnapshot().unread, 0);
});

Deno.test("a stale poll cannot revive unread notifications while marking them read", async () => {
  const stale = deferred<ReturnType<typeof initial>>(), save = deferred<void>();
  let calls = 0;
  const feed = createNotificationFeed({
    load: () =>
      ++calls === 2 ? stale.promise : Promise.resolve(
        calls === 1 ? initial() : {
          items: initial().items.map((n) => ({ ...n, read_at: "read" })),
          unread: 0,
        },
      ),
    read: () => save.promise,
  });
  await feed.refresh();
  const polling = feed.refresh();
  await Promise.resolve();
  const reading = feed.markRead();
  stale.resolve(initial());
  await polling;
  assertEquals(feed.getSnapshot().unread, 0);
  save.resolve();
  await reading;
  assertEquals(feed.getSnapshot().unread, 0);
});

Deno.test("failed read rolls back all bells even when reconciliation is offline", async () => {
  let calls = 0;
  const feed = createNotificationFeed({
    load: () =>
      ++calls === 1
        ? Promise.resolve(initial())
        : Promise.reject(new Error("offline")),
    read: () => Promise.reject(new Error("not saved")),
  });
  await feed.refresh();
  const seen: number[] = [];
  feed.subscribe(() => seen.push(feed.getSnapshot().unread));
  await assertRejects(() => feed.markRead(), Error, "not saved");
  assertEquals(seen, [0, 2]);
  assertEquals(feed.getSnapshot().items.map((n) => n.read_at), [null, null]);
});
