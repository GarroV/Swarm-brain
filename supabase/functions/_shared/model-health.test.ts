// Запуск: deno test supabase/functions/_shared/model-health.test.ts
//
// Сигнал об отказе модели (#372): серия отказов за окно тревожит админа один раз, одиночный сбой
// — нет; долгий отказ не засыпает чат; причина различима (квота, ключ, 5xx).
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  ALERT_COOLDOWN_H,
  failureAdvice,
  type ModelHealth,
  parseOpenAiError,
  recordModelFailure,
  stepHealth,
  THRESHOLD,
  WINDOW_MIN,
} from "./model-health.ts";
import { isSystemModelFailure } from "./external-fetch.ts";

const QUOTA = { status: 429, code: "insufficient_quota", message: "You exceeded your current quota" };
const t0 = new Date("2026-10-02T01:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);

function run(failures: number, stepMin: number, start: ModelHealth | null = null) {
  let h = start;
  const alerts: number[] = [];
  for (let i = 0; i < failures; i++) {
    const r = stepHealth(h, QUOTA, at(i * stepMin));
    h = r.next;
    if (r.alert) alerts.push(i + 1);
  }
  return { h: h!, alerts };
}

Deno.test("серия отказов в окне тревожит ровно один раз — на пороге", () => {
  const { alerts } = run(THRESHOLD + 5, 1);
  assertEquals(alerts, [THRESHOLD]);
});

Deno.test("одиночные отказы реже окна не тревожат", () => {
  const { alerts, h } = run(THRESHOLD * 2, WINDOW_MIN + 1);
  assertEquals(alerts, []);
  assertEquals(h.count, 1);
});

Deno.test("после паузы ALERT_COOLDOWN_H новая серия тревожит снова", () => {
  const first = run(THRESHOLD, 1);
  let h = first.h;
  const later = ALERT_COOLDOWN_H * 60 + 10;
  const alerts: boolean[] = [];
  for (let i = 0; i < THRESHOLD; i++) {
    const r = stepHealth(h, QUOTA, at(later + i));
    h = r.next;
    alerts.push(r.alert);
  }
  assertEquals(alerts.filter(Boolean).length, 1);
});

Deno.test("разбор тела OpenAI и совет по причине", () => {
  const f = parseOpenAiError(429, JSON.stringify({ error: { code: "insufficient_quota", message: "quota" } }));
  assertEquals(f, { status: 429, code: "insufficient_quota", message: "quota" });
  assertStringIncludes(failureAdvice(f), "квота");
  assertStringIncludes(failureAdvice({ status: 401, code: null, message: null }), "Ключ");
  assertStringIncludes(failureAdvice({ status: 503, code: null, message: null }), "стороне OpenAI");
  assertEquals(parseOpenAiError(502, "<html>bad gateway</html>").code, null);
});

Deno.test("системный отказ — без ответа, 401/403/429/5xx; ошибка запроса — нет", () => {
  for (const s of [null, 401, 403, 429, 500, 503]) assert(isSystemModelFailure(s), String(s));
  for (const s of [400, 404, 413]) assert(!isSystemModelFailure(s), String(s));
});

Deno.test("recordModelFailure сохраняет состояние и шлёт текст с причиной", async () => {
  let stored: ModelHealth | null = null;
  const sent: string[] = [];
  const deps = {
    load: () => Promise.resolve(stored),
    save: (h: ModelHealth) => {
      stored = h;
      return Promise.resolve();
    },
    alert: (t: string) => {
      sent.push(t);
      return Promise.resolve();
    },
    now: () => t0,
  };
  for (let i = 0; i < THRESHOLD; i++) await recordModelFailure(QUOTA, deps);
  assertEquals(sent.length, 1);
  assertStringIncludes(sent[0], "HTTP 429, insufficient_quota");
  assertEquals(stored!.count, THRESHOLD);
});
