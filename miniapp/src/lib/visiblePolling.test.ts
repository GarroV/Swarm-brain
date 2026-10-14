import { assertEquals } from "jsr:@std/assert@1";
import { FakeTime } from "jsr:@std/testing@1/time";
import { startVisiblePolling, type PollDoc } from "./visiblePolling.ts";

function fakeDoc(state: string) {
  const subs = new Set<() => void>();
  const doc: PollDoc & { set(s: string): void } = {
    visibilityState: state,
    addEventListener: (_t, cb) => { subs.add(cb); },
    removeEventListener: (_t, cb) => { subs.delete(cb); },
    set(s) { doc.visibilityState = s; subs.forEach((cb) => cb()); },
  };
  return { doc, subs };
}

Deno.test("поллинг: скрытая вкладка не тикает, видимая — тикает", () => {
  using time = new FakeTime();
  const { doc } = fakeDoc("hidden");
  let ticks = 0;
  const stop = startVisiblePolling(doc, () => ticks++, 10_000);
  time.tick(30_000);
  assertEquals(ticks, 0);
  doc.visibilityState = "visible";
  time.tick(20_000);
  assertEquals(ticks, 2);
  stop();
});

Deno.test("поллинг: возврат видимости — ровно одна догрузка; скрытие её не вызывает", () => {
  using time = new FakeTime();
  const { doc } = fakeDoc("visible");
  let visibleCalls = 0;
  const stop = startVisiblePolling(doc, () => {}, 10_000, () => visibleCalls++);
  doc.set("hidden");
  assertEquals(visibleCalls, 0);
  doc.set("visible");
  assertEquals(visibleCalls, 1);
  stop();
  time.tick(1);
});

Deno.test("поллинг: stop снимает подписку и интервал", () => {
  using time = new FakeTime();
  const { doc, subs } = fakeDoc("visible");
  let ticks = 0;
  const stop = startVisiblePolling(doc, () => ticks++, 1_000);
  stop();
  time.tick(5_000);
  assertEquals(ticks, 0);
  assertEquals(subs.size, 0);
});
