// supabase/functions/swarm-bot/lib/retry.test.ts
// Запуск: deno test supabase/functions/swarm-bot/lib/retry.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withRetry } from "./retry.ts";

Deno.test("withRetry: сбой первой попытки не теряет результат — возвращает успех второй", async () => {
  let attempts = 0;
  const load = () => {
    attempts++;
    if (attempts < 2) throw new Error("Gateway Timeout");
    return Promise.resolve("свод");
  };

  const result = await withRetry(load, { sleep: () => Promise.resolve() });

  assertEquals(result, "свод");
  assertEquals(attempts, 2);
});

Deno.test("withRetry: попытки исчерпаны — бросает последнюю ошибку, а не молчит", async () => {
  let attempts = 0;
  const load = () => {
    attempts++;
    return Promise.reject(new Error(`Gateway Timeout #${attempts}`));
  };

  let thrown: string | null = null;
  try {
    await withRetry(load, { sleep: () => Promise.resolve() });
  } catch (e) {
    thrown = (e as Error).message;
  }

  assertEquals(attempts, 3);
  assertEquals(thrown, "Gateway Timeout #3");
});

Deno.test("withRetry: задержки растут вдвое — 500 мс, затем 1000 мс", async () => {
  const delays: number[] = [];
  await withRetry(
    () => (delays.length < 2 ? Promise.reject(new Error("504")) : Promise.resolve("ок")),
    { sleep: (ms) => { delays.push(ms); return Promise.resolve(); } },
  );

  assertEquals(delays, [500, 1000]);
});
