import { assertEquals, assertRejects } from "@std/assert";
import type { Task } from "@/types";
import type { TasksDeltaResponse } from "./tasksDelta.ts";
import { createOverdueTaskSource } from "./overdueTasks.ts";
import { countMyOverdue } from "./navBadges.ts";

const task = (id: string, extra: Partial<Task> = {}) =>
  ({
    id,
    title: id,
    status: "open",
    due_date: "2026-01-01",
    assignee_telegram_ids: [123],
    ...extra,
  }) as Task;
const change = (
  tasks: Task[],
  serverTime = "2026-11-06T10:01:00Z",
  truncated = false,
): TasksDeltaResponse => ({ tasks, serverTime, truncated });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return { promise, resolve };
};

Deno.test("badge navigation reuses the snapshot after TTL and advances the server cursor", async () => {
  let fullCalls = 0;
  const cursors: string[] = [];
  const source = createOverdueTaskSource({
    full: () => {
      fullCalls++;
      return Promise.resolve([task("1")]);
    },
    delta: (since) => {
      cursors.push(since);
      return Promise.resolve(change([]));
    },
    now: () => Date.parse("2026-11-06T10:00:00Z"),
  });
  await source.refresh();
  await source.refresh();
  await source.refresh();
  assertEquals(fullCalls, 1);
  assertEquals(cursors, ["2026-11-06T09:59:00.000Z", "2026-11-06T10:01:00Z"]);
});

Deno.test("badge follows additions, closure, deletion and changed assignee through the existing merge", async () => {
  const responses = [
    change([task("4")]),
    change([task("1", { status: "done" })]),
    change([task("2", { archived_at: "2026-11-06" })]),
    change([task("3", { assignee_telegram_ids: [999] })]),
  ];
  const source = createOverdueTaskSource({
    full: () => Promise.resolve([task("1"), task("2"), task("3")]),
    delta: () => Promise.resolve(responses.shift()!),
  });
  for (const expected of [3, 4, 3, 2, 1]) {
    const rows = await source.refresh();
    assertEquals(
      countMyOverdue(rows!, { telegram_id: 123 }, new Date("2026-11-06")),
      expected,
    );
  }
});

Deno.test("truncated delta replaces the snapshot with a full read", async () => {
  let fullCalls = 0;
  const source = createOverdueTaskSource({
    full: () => Promise.resolve([task(String(++fullCalls))]),
    delta: () => Promise.resolve(change([task("wrong")], undefined, true)),
  });
  await source.refresh();
  assertEquals((await source.refresh())!.map((t) => t.id), ["2"]);
  assertEquals(fullCalls, 2);
});

Deno.test("failed delta retains the successful cursor and can be retried", async () => {
  const cursors: string[] = [];
  const source = createOverdueTaskSource({
    full: () => Promise.resolve([task("1")]),
    delta: (since) => {
      cursors.push(since);
      return cursors.length === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(change([]));
    },
  });
  await source.refresh();
  await assertRejects(() => source.refresh(), Error, "offline");
  assertEquals((await source.refresh())!.map((t) => t.id), ["1"]);
  assertEquals(cursors[0], cursors[1]);
});

Deno.test("late old delta cannot resurrect a task after a newer refresh", async () => {
  const old = deferred<TasksDeltaResponse>();
  let deltaCalls = 0;
  const source = createOverdueTaskSource({
    full: () => Promise.resolve([task("1")]),
    delta: () =>
      ++deltaCalls === 1
        ? old.promise
        : Promise.resolve(change([task("1", { status: "done" })])),
  });
  await source.refresh();
  const late = source.refresh();
  assertEquals((await source.refresh())![0].status, "done");
  old.resolve(change([task("1")]));
  assertEquals(await late, null);
  assertEquals((await source.refresh())![0].status, "done");
});

Deno.test("cleanup discards a pending full response and retries with a fresh full read", async () => {
  const old = deferred<Task[]>();
  let fullCalls = 0;
  const source = createOverdueTaskSource({
    full: () =>
      ++fullCalls === 1 ? old.promise : Promise.resolve([task("new")]),
    delta: () => Promise.resolve(change([])),
  });
  const late = source.refresh();
  source.cancelPending();
  assertEquals((await source.refresh())![0].id, "new");
  old.resolve([task("old")]);
  assertEquals(await late, null);
});

Deno.test("a late truncated-delta full fallback cannot undo a newer closure", async () => {
  const oldFull = deferred<Task[]>();
  let fullCalls = 0, deltaCalls = 0;
  const source = createOverdueTaskSource({
    full: () =>
      ++fullCalls === 1 ? Promise.resolve([task("1")]) : oldFull.promise,
    delta: () =>
      Promise.resolve(
        ++deltaCalls === 1
          ? change([], undefined, true)
          : change([task("1", { status: "done" })]),
      ),
  });
  await source.refresh();
  const late = source.refresh();
  await Promise.resolve();
  assertEquals(fullCalls, 2);
  assertEquals((await source.refresh())![0].status, "done");
  oldFull.resolve([task("1")]);
  assertEquals(await late, null);
  assertEquals((await source.refresh())![0].status, "done");
});
