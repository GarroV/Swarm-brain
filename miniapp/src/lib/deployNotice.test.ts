// Раннер тот же, что у request-cache.test.ts: deno test miniapp/src/lib/deployNotice.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lastNotice, noticeView, publishNotice, subscribeNotice, type DeployNotice } from "./deployNotice.ts";

const AT = "2026-08-27T18:00:00Z";
const UNTIL = "2026-08-27T18:35:00Z";
const n = (over: Partial<DeployNotice> = {}): DeployNotice => ({ at: AT, until: UNTIL, ...over });
const t = (iso: string) => new Date(iso);

Deno.test("плашки нет, когда нечего показывать", () => {
  assertEquals(noticeView(null, t(AT)), null);
  assertEquals(noticeView(undefined, t(AT)), null);
});

Deno.test("до срока — обратный отсчёт в минутах", () => {
  assertEquals(noticeView(n(), t("2026-08-27T17:48:00Z")), { phase: "soon", minutes: 12 });
});

Deno.test("неполная минута округляется вверх — «через 1 мин», а не «через 0»", () => {
  // Ноль в отсчёте читается как «уже», хотя обновление ещё не началось.
  assertEquals(noticeView(n(), t("2026-08-27T17:59:59Z")), { phase: "soon", minutes: 1 });
  assertEquals(noticeView(n(), t("2026-08-27T17:59:01Z")), { phase: "soon", minutes: 1 });
});

Deno.test("ровно в срок — фаза «идёт», а не «через 0 мин»", () => {
  assertEquals(noticeView(n(), t(AT)), { phase: "now", minutes: 0 });
});

Deno.test("между сроком и истечением — всё ещё «идёт»", () => {
  assertEquals(noticeView(n(), t("2026-08-27T18:20:00Z")), { phase: "now", minutes: 0 });
});

Deno.test("после истечения плашка ГАСНЕТ сама — упавший скрипт не оставит её висеть", () => {
  // Главная страховка: сервер тоже фильтрует, но клиент мог закешировать ответ.
  assertEquals(noticeView(n(), t(UNTIL)), null);
  assertEquals(noticeView(n(), t("2026-08-28T09:00:00Z")), null);
});

Deno.test("битые даты не показывают плашку и не роняют экран", () => {
  assertEquals(noticeView(n({ at: "потом" }), t(AT)), null);
  assertEquals(noticeView(n({ until: "" }), t(AT)), null);
});

Deno.test("until раньше at — плашки нет: такой интервал бессмыслен", () => {
  assertEquals(noticeView(n({ until: "2026-08-27T17:00:00Z" }), t("2026-08-27T17:50:00Z")), null);
});

Deno.test("длинный отсчёт показывается в минутах, а не в часах", () => {
  // Заливку объявляют за 15 минут; часы означали бы, что скрипт запустили не тем флагом,
  // и честнее показать большое число, чем молча спрятать плашку.
  assertEquals(noticeView(n(), t("2026-08-27T16:00:00Z")), { phase: "soon", minutes: 120 });
});

// ── стор: колокольчик публикует, плашка слушает (без второго поллинга) ────────

Deno.test("подписчик получает объявление, опубликованное колокольчиком", () => {
  const seen: (DeployNotice | null)[] = [];
  const off = subscribeNotice((x) => seen.push(x));
  publishNotice(n());
  assertEquals(seen, [n()]);
  off();
});

Deno.test("после отписки обновления не приходят — иначе размонтированная плашка течёт", () => {
  const seen: (DeployNotice | null)[] = [];
  const off = subscribeNotice((x) => seen.push(x));
  off();
  publishNotice(n({ at: "2026-09-01T10:00:00Z" }));
  assertEquals(seen.length, 0);
});

Deno.test("снятое объявление (null) доходит до подписчика — плашка должна исчезнуть", () => {
  const seen: (DeployNotice | null)[] = [];
  const off = subscribeNotice((x) => seen.push(x));
  publishNotice(null);
  assertEquals(seen, [null]);
  off();
});

Deno.test("плашка, смонтированная позже публикации, видит последнее объявление", () => {
  // Порядок монтирования не гарантирован: колокольчик мог успеть опросить сервер первым.
  publishNotice(n());
  assertEquals(lastNotice(), n());
  publishNotice(null);
  assertEquals(lastNotice(), null);
});
