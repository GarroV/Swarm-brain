// Заморозка откладывает обработку встреч (решение владельца 01.10.2026,
// docs/decisions/2026-10-01-freeze-pauses-processing.md): запись принимается, а транскрипт и
// тезисы ждут разморозки. Ошибка здесь тихая и дорогая — обработка, идущая во время переезда схемы,
// пишет в меняющиеся таблицы, а сторож без отсрочки валит в 'failed' встречу, которая просто ждала.
// Поэтому шаг гоняется целиком на поддельном клиенте, исполняющем ровно те фильтры, что шлёт модуль.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { LEASE_STALE_MS, runMeetingStep } from "./meeting-processor.ts";
import { resetMaintenanceCache } from "./maintenance.ts";
import { holdWaitingMeetings, processingFrozen } from "./processing-freeze.ts";

type Row = Record<string, unknown>;
const NOW = new Date("2026-10-01T23:20:00Z");
const iso = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

/** Поддельный клиент: строка заморозки в app_settings и таблица встреч. */
function fake(maintenance: Row | null, meetings: Row[]) {
  const updates: Array<{ id: unknown; patch: Row }> = [];
  const client = {
    from: (table: string) => {
      if (table === "app_settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: maintenance ? { value: maintenance } : null, error: null }),
            }),
          }),
        };
      }
      if (table !== "meetings") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      return {
        select: () => ({
          eq: (_c: string, id: unknown) => ({
            maybeSingle: () => Promise.resolve({ data: meetings.find((m) => m.id === id) ?? null, error: null }),
          }),
        }),
        update: (patch: Row) => {
          const filters: Array<(r: Row) => boolean> = [];
          const apply = () => {
            const hit = meetings.filter((r) => filters.every((f) => f(r)));
            for (const r of hit) {
              Object.assign(r, patch);
              updates.push({ id: r.id, patch });
            }
            return hit.map((r) => ({ id: r.id }));
          };
          const chain = {
            eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), chain),
            not: (col: string, _op: string, _v: null) => (filters.push((r) => r[col] != null), chain),
            or: (expr: string) => {
              assert(expr.startsWith("processing_lease.is.null,processing_lease.lt."), `неожиданный or: ${expr}`);
              const stale = expr.slice("processing_lease.is.null,processing_lease.lt.".length);
              filters.push((r) => r.processing_lease == null || String(r.processing_lease) < stale);
              return chain;
            },
            select: () => {
              const data = apply();
              return Object.assign(Promise.resolve({ data, error: null }), {
                maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
              });
            },
          };
          return chain;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, updates };
}

/** Встреча, принятая и ждущая обработки: без манифеста шаг сразу возвращается после лиза. */
const waiting = (id = "m-1"): Row => ({
  id,
  summary_status: "processing",
  process_state: null,
  processing_lease: null,
  last_progress_at: iso(-40),
});

const active = { until: iso(30), starts_at: iso(-5), message_en: "x", message_ru: "x" };

Deno.test("заморозка действует → шаг не берёт встречу: ни лиза, ни смены статуса", async () => {
  resetMaintenanceCache();
  const row = waiting();
  const { client, updates } = fake(active, [row]);
  const r = await runMeetingStep(client, "m-1", 10_000, NOW);
  assertEquals(r.claimed, false, "встречу взяли в работу во время заморозки");
  assertEquals(r.deferred, true);
  assertEquals(updates.length, 0, `шаг писал в встречу во время заморозки: ${JSON.stringify(updates)}`);
  assertEquals(row.summary_status, "processing");
});

Deno.test("заморозка объявлена, но ещё не началась (starts_at впереди) → шаг работает", async () => {
  resetMaintenanceCache();
  const { client, updates } = fake({ ...active, starts_at: iso(10) }, [waiting()]);
  const r = await runMeetingStep(client, "m-1", 10_000, NOW);
  assertEquals(r.claimed, true, "плановая заморозка уже остановила обработку");
  assert(updates.some((u) => "processing_lease" in u.patch), "лиз не взят");
});

Deno.test("срок заморозки прошёл → шаг работает сам, без снятия режима", async () => {
  resetMaintenanceCache();
  const { client } = fake({ ...active, starts_at: iso(-60), until: iso(-1) }, [waiting()]);
  const r = await runMeetingStep(client, "m-1", 10_000, NOW);
  assertEquals(r.claimed, true, "истёкшая заморозка всё ещё держит обработку");
});

Deno.test("заморозки нет → шаг работает", async () => {
  resetMaintenanceCache();
  const { client } = fake(null, [waiting()]);
  const r = await runMeetingStep(client, "m-1", 10_000, NOW);
  assertEquals(r.claimed, true);
});

Deno.test("processingFrozen — тот же срок, что у заморозки веба", async () => {
  resetMaintenanceCache();
  assertEquals(await processingFrozen(fake(active, []).client, NOW), true);
  resetMaintenanceCache();
  assertEquals(await processingFrozen(fake({ ...active, starts_at: iso(10) }, []).client, NOW), false);
  resetMaintenanceCache();
  assertEquals(await processingFrozen(fake(null, []).client, NOW), false);
});

Deno.test("ожидающие встречи получают отметку «жива, ждёт» — сторож застоя их после разморозки не валит", async () => {
  const free = waiting("m-free");
  const leased: Row = { ...waiting("m-leased"), processing_lease: iso(-1) }; // её сейчас двигает живой шаг
  const done: Row = { ...waiting("m-done"), summary_status: "done" };
  const { client, updates } = fake(null, [free, leased, done]);
  const n = await holdWaitingMeetings(client, LEASE_STALE_MS, NOW);
  assertEquals(n, 1);
  assertEquals(free.last_progress_at, NOW.toISOString(), "ожидающей встрече не обновили отметку");
  assertEquals(free.summary_status, "processing", "статус ожидающей встречи сменили");
  assertEquals(updates.map((u) => Object.keys(u.patch)), [["last_progress_at"]], "писали что-то кроме отметки");
  assertEquals(done.last_progress_at, iso(-40), "тронули завершённую встречу");
});

Deno.test("приём записи заморозку не смотрит: claim и ingest не читают её и не отвечают 503", async () => {
  // Рекордер на 503 уходит в повторы, а после постоянного сбоя — в dead-letter: заморозка
  // приёма откладывала бы саму запись, а её мы как раз обязаны принять (решение 01.10.2026).
  // Запрет на обработку стоит в runMeetingStep, и inline-проход приёма доходит до него сам.
  for (const f of ["../meeting-ingest/index.ts", "../meeting-claim/index.ts"]) {
    const src = await Deno.readTextFile(new URL(f, import.meta.url));
    assert(!/maintenance|processing-freeze/.test(src), `${f} начал смотреть заморозку — приём записи встанет`);
    assert(!/status:\s*503/.test(src), `${f} отвечает 503`);
  }
});
