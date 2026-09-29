// Вторая запись встречи (T156) на МЕСТЕ ВЫЗОВА: `runMeetingStep` на этапе summarize обязан спросить
// арбитра полноты, прежде чем писать стенограмму. Сама функция сравнения (_shared/meeting-fullness.ts)
// покрыта своими тестами, но порча «if (false && state.challenge && ...)» в meeting-processor.ts их
// не задевала: правило держал только живой смоук scripts/scriba-same-owner-smoke.ts. Здесь шаг
// гоняется целиком на поддельном клиенте, который исполняет ровно те фильтры, что шлёт модуль;
// сеть (OpenAI, Telegram) подменена и считает обращения.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type ProcessState, runMeetingStep } from "./meeting-processor.ts";

const ID = "m-challenge";
const GEN = "gen-2";
type Row = Record<string, unknown>;

/** Поддельный клиент на одну строку встречи; бакет пуст (очереди нет). */
function fake(row: Row) {
  const updates: Row[] = [];
  const gen = () => (row.process_state as ProcessState | null)?.gen;
  const leaseFree = (expr: string) => {
    assert(expr.startsWith("processing_lease.is.null,processing_lease.lt."), `неожиданный or: ${expr}`);
    return row.processing_lease == null;
  };
  const client = {
    storage: {
      from: () => ({
        download: () => Promise.resolve({ data: null, error: { message: "not found" } }),
        remove: () => Promise.resolve({ data: [], error: null }),
      }),
    },
    from: (table: string) => {
      // Имя владельца для легенды тезисов (user_profiles / allowed_users) — в тесте не резолвится.
      if (table !== "meetings") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...row }, error: null }) }) }),
        update: (patch: Row) => {
          const filters: Array<() => boolean> = [];
          const apply = () => {
            if (!filters.every((f) => f())) return [];
            Object.assign(row, patch);
            updates.push(patch);
            return [{ id: row.id }];
          };
          const chain = {
            eq: (col: string, v: unknown) => {
              filters.push(
                col === "process_state->>gen"
                  ? () => gen() === v
                  : col === "recorders"
                  ? () => JSON.stringify(row[col]) === JSON.stringify(JSON.parse(String(v)))
                  : () => row[col] === v,
              );
              return chain;
            },
            is: (col: string, _v: null) => (filters.push(() => row[col] == null), chain),
            neq: (col: string, v: unknown) => (filters.push(() => row[col] !== v), chain),
            or: (expr: string) => (filters.push(() => leaseFree(expr)), chain),
            select: () => {
              const data = apply();
              const res = Promise.resolve({ data, error: null });
              return Object.assign(res, { maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }) });
            },
          };
          return chain;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, updates, row };
}

/** Сеть подменена: OpenAI отвечает 400 (без ретраев), каждое обращение записано. */
async function withFetchStub(fn: (calls: string[]) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return Promise.resolve(
      new Response(JSON.stringify({ error: { message: "stub: сеть в тесте закрыта" } }), { status: 400 }),
    );
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const seg = (text: string, start = 0) => ({ start, end: start + 5, text });

/** Встреча в обработке второй записью: все части распознаны, осталась сводка. */
function challengerRow(currentText: string, incomingText: string): Row {
  const state: ProcessState = {
    parts: [{
      track: "sys",
      name: "sys-0.m4a",
      offset: 0,
      path: `${ID}/${GEN}/sys-0.m4a`,
      done: true,
      attempts: 0,
      segments: [seg(incomingText)],
    }],
    stage: "summarize",
    gen: GEN,
    source: "person",
    sources: ["agent:1", "person"],
    owner: 42,
    challenge: { priorStatus: "done" },
  };
  return {
    id: ID,
    title: "Встреча",
    recorders: [],
    claim_owner: 42,
    mic_start_offset: 0,
    summary_status: "processing",
    processing_lease: null,
    notes_edited_at: null,
    transcript: { segments: [seg(currentText)] },
    process_state: state,
  };
}

const FULL = "Полная стенограмма первой записи, в которой распознано заметно больше речи, чем во второй.";
const POOR = "Обрывок.";

Deno.test("вторая запись беднее текущей → стенограмма не тронута, статус вернулся, модель не звали", async () => {
  await withFetchStub(async (calls) => {
    const { client, updates, row } = fake(challengerRow(FULL, POOR));

    // Исход шага читаем после проверок: при обойдённом арбитре шаг падает на закрытой сети, и
    // понятная причина — перезаписанная стенограмма — должна прозвучать первой.
    const res = await runMeetingStep(client, ID, 10_000).catch((e: unknown) => e);

    assert(
      updates.every((u) => !("transcript" in u)),
      "стенограмму перезаписали, хотя вторая запись беднее: место вызова keepCurrentTranscript обойдено",
    );
    assertEquals((row.transcript as { segments: Array<{ text: string }> }).segments[0].text, FULL);
    assertEquals(row.summary_status, "done");
    assertEquals(row.processing_lease, null);
    assertEquals(calls, [], `при сохранённой текущей стенограмме не должно быть сети, а было: ${calls.join(", ")}`);
    assertEquals(res, { claimed: true, done: true });
  });
});

Deno.test("вторая запись полнее текущей → стенограмма заменена и дальше идёт сводка", async () => {
  await withFetchStub(async (calls) => {
    const { client, updates, row } = fake(challengerRow(POOR, FULL));

    // Сводка упирается в закрытую сеть — нам важно, что до неё дошло уже с новой стенограммой.
    await assertRejects(() => runMeetingStep(client, ID, 10_000));

    assert(updates.some((u) => "transcript" in u), "более полная вторая запись не заменила стенограмму");
    assertEquals((row.transcript as { segments: Array<{ text: string }> }).segments[0].text, FULL);
    assert(calls.some((u) => u.includes("api.openai.com")), "после замены стенограммы сводку не запрашивали");
  });
});

// ── Претендент (T168): владелец встречи переходит вместе со стенограммой ─────────────

const HOLDER = 42;
const RIVAL = 77;

function rivalRow(currentText: string, incomingText: string): Row {
  const r = challengerRow(currentText, incomingText);
  const state = r.process_state as ProcessState;
  r.process_state = {
    ...state,
    source: `person:${RIVAL}`,
    owner: RIVAL,
    rival: { recordedSeconds: 2400, micStartOffset: 1.5 },
  };
  r.recorded_seconds = 600;
  r.recorders = [
    { telegram_id: HOLDER, claimed_at: "2026-09-28T09:00:00Z", role: "transcribe" },
    { telegram_id: RIVAL, claimed_at: "2026-09-28T09:40:00Z", role: "challenger" },
  ];
  return r;
}

const rolesOf = (row: Row) =>
  Object.fromEntries(
    (row.recorders as Array<{ telegram_id: number; role: string }>).map((r) => [r.telegram_id, r.role]),
  );

Deno.test("ЯДРО: запись претендента полнее — стенограмма и владелец переходят к нему одной UPDATE", async () => {
  await withFetchStub(async () => {
    const { client, updates, row } = fake(rivalRow(POOR, FULL));
    await assertRejects(() => runMeetingStep(client, ID, 10_000));
    const write = updates.find((u) => "transcript" in u);
    assertEquals(write?.claim_owner, RIVAL, "владелец не переехал той же записью, что стенограмма");
    assertEquals(row.claim_owner, RIVAL);
    assertEquals(row.recorded_seconds, 2400);
    assertEquals(row.mic_start_offset, 1.5);
    assertEquals(rolesOf(row), { [HOLDER]: "superseded", [RIVAL]: "transcribe" });
  });
});

Deno.test("ЯДРО: запись претендента беднее — встреча остаётся у держателя, претендент defer", async () => {
  await withFetchStub(async () => {
    const { client, row } = fake(rivalRow(FULL, POOR));
    await runMeetingStep(client, ID, 10_000).catch((e: unknown) => e);
    assertEquals(row.claim_owner, HOLDER);
    assertEquals(row.recorded_seconds, 600);
    assertEquals((row.transcript as { segments: Array<{ text: string }> }).segments[0].text, FULL);
    assertEquals(rolesOf(row), { [HOLDER]: "transcribe", [RIVAL]: "defer" });
  });
});

Deno.test("ЯДРО: встречу опубликовали, пока шла вторая запись, — полнее, но не заменяет", async () => {
  await withFetchStub(async (calls) => {
    const { client, updates, row } = fake({ ...challengerRow(POOR, FULL), status: "in_base" });
    await runMeetingStep(client, ID, 10_000).catch((e: unknown) => e);
    assert(updates.every((u) => !("transcript" in u)), "опубликованную встречу переписали");
    assertEquals(row.summary_status, "done");
    assertEquals(calls, []);
  });
});
