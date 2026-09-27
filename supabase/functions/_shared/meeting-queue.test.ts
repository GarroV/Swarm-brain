// Очередь второй записи одной встречи (T156): когда ожидающая запись идёт в обработку, когда
// выбрасывается и что делает воркер, чьё состояние вытеснили посреди работы. Живой путь со
// Storage и настоящими функциями держит scripts/scriba-same-owner-smoke.ts; здесь — ветки решений
// на поддельном клиенте, который исполняет ровно те фильтры, что шлёт модуль.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { promoteQueued, queuedPath, readQueued, requeueLost, writeQueued } from "./meeting-queue.ts";
import type { ProcessState } from "./meeting-processor.ts";

const ID = "m-1";
const OWNER = 42;

type Row = Record<string, unknown>;

/** Поддельный клиент: одна строка встречи и бакет-словарь. */
function fake(row: Row | null, files: Record<string, string> = {}) {
  const bucket = new Map(Object.entries(files));
  const removed: string[] = [];
  const updates: Row[] = [];
  const matches = (filters: Array<(r: Row) => boolean>) => row !== null && filters.every((f) => f(row));
  const client = {
    storage: {
      from: () => ({
        download: (path: string) =>
          Promise.resolve(
            bucket.has(path)
              ? { data: new Blob([bucket.get(path) ?? ""]), error: null }
              : { data: null, error: { message: "not found" } },
          ),
        upload: async (path: string, body: Blob) => {
          bucket.set(path, await body.text());
          return { error: null };
        },
        remove: (paths: string[]) => {
          for (const p of paths) {
            bucket.delete(p);
            removed.push(p);
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: row === null
                ? null
                : { ...row, sources: (row.process_state as ProcessState | null)?.sources ?? null },
            }),
        }),
      }),
      update: (patch: Row) => {
        const filters: Array<(r: Row) => boolean> = [];
        const chain = {
          eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), chain),
          is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), chain),
          or: (expr: string) => {
            assertEquals(expr, "summary_status.is.null,summary_status.neq.processing");
            filters.push((r) => r.summary_status !== "processing");
            return chain;
          },
          select: () => {
            if (!matches(filters) || row === null) return Promise.resolve({ data: [] });
            Object.assign(row, patch);
            updates.push(patch);
            return Promise.resolve({ data: [{ id: row.id }] });
          },
        };
        return chain;
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, bucket, removed, updates };
}

const botState: ProcessState = {
  parts: [{
    track: "sys",
    name: "part-000.m4a",
    offset: 0,
    path: `${ID}/g-bot/sys-part-000.m4a`,
    done: true,
    attempts: 0,
  }],
  stage: "transcribe",
  gen: "g-bot",
  source: "agent:scriba",
  sources: ["agent:scriba"],
  owner: OWNER,
};
const queuedJson = JSON.stringify({ ...botState, challenge: undefined });

Deno.test("в очередь пишется состояние без флага претендента — его ставит продвижение", async () => {
  const f = fake({ id: ID });
  await writeQueued(f.client, ID, { ...botState, challenge: { priorStatus: "done" } });
  const back = await readQueued(f.client, ID);
  assertEquals(back?.challenge, undefined);
  assertEquals(back?.source, "agent:scriba");
});

Deno.test("битый queued.json выбрасывается, а не валит обработку", async () => {
  const f = fake({ id: ID }, { [queuedPath(ID)]: "{не json" });
  assertEquals(await readQueued(f.client, ID), null);
  assert(f.removed.includes(queuedPath(ID)));
});

Deno.test("пустая очередь — продвигать нечего", async () => {
  const f = fake({ id: ID, summary_status: "done", notes_edited_at: null });
  assertEquals(await promoteQueued(f.client, ID), false);
  assertEquals(f.updates.length, 0);
});

Deno.test("первая запись ещё в обработке — ожидающая остаётся в очереди", async () => {
  const f = fake({ id: ID, summary_status: "processing", notes_edited_at: null }, { [queuedPath(ID)]: queuedJson });
  assertEquals(await promoteQueued(f.client, ID), false);
  assert(f.bucket.has(queuedPath(ID)));
});

Deno.test("первая закончила — вторая идёт претендентом, с новым поколением и общими источниками", async () => {
  const row: Row = {
    id: ID,
    summary_status: "done",
    notes_edited_at: null,
    status: "awaiting_review",
    process_state: { parts: [], stage: "summarize", sources: ["person"] },
  };
  const f = fake(row, { [queuedPath(ID)]: queuedJson });
  assertEquals(await promoteQueued(f.client, ID), true);
  const state = row.process_state as ProcessState;
  assertEquals(row.summary_status, "processing");
  assertEquals(state.challenge, { priorStatus: "done" });
  assert(state.gen !== "g-bot", "поколение обязано смениться: прежний воркер не должен писать в новое состояние");
  assertEquals(state.sources, ["person", "agent:scriba"]);
  assert(!f.bucket.has(queuedPath(ID)), "очередь освобождена");
});

Deno.test("тезисы правил человек — вторая запись выбрасывается вместе с частями", async () => {
  const f = fake(
    { id: ID, summary_status: "done", notes_edited_at: "2026-09-28T10:00:00Z", status: "awaiting_review" },
    { [queuedPath(ID)]: queuedJson },
  );
  assertEquals(await promoteQueued(f.client, ID), false);
  assertEquals(f.updates.length, 0);
  assert(f.removed.includes(queuedPath(ID)) && f.removed.includes(botState.parts[0].path));
});

Deno.test("запись уже у команды (in_base) — вторая запись выбрасывается", async () => {
  const f = fake({ id: ID, summary_status: "done", notes_edited_at: null, status: "in_base" }, {
    [queuedPath(ID)]: queuedJson,
  });
  assertEquals(await promoteQueued(f.client, ID), false);
  assertEquals(f.updates.length, 0);
});

Deno.test("вытеснили посреди обработки, владелец тот же — запись встаёт в очередь и сразу идёт, если встреча свободна", async () => {
  // Перехват claim тем же человеком обнулил маркеры: встреча не в обработке, стенограммы нет.
  const row: Row = { id: ID, claim_owner: OWNER, summary_status: null, notes_edited_at: null, status: null };
  const f = fake(row);
  await requeueLost(f.client, ID, botState);
  assertEquals(row.summary_status, "processing");
  assertEquals((row.process_state as ProcessState).source, "agent:scriba");
  assertEquals(f.removed.includes(botState.parts[0].path), false, "распознанные части не выброшены");
});

Deno.test("вытеснили, пока обрабатывается чужая выгрузка того же владельца — ждёт в очереди", async () => {
  const f = fake({ id: ID, claim_owner: OWNER, summary_status: "processing", notes_edited_at: null, status: null });
  await requeueLost(f.client, ID, botState);
  assert(f.bucket.has(queuedPath(ID)));
  assertEquals(f.updates.length, 0);
});

Deno.test("вытеснили, а владелец сменился — запись выбрасывается, в очередь не встаёт", async () => {
  const f = fake({ id: ID, claim_owner: 777, summary_status: "processing", notes_edited_at: null, status: null });
  await requeueLost(f.client, ID, botState);
  assert(!f.bucket.has(queuedPath(ID)));
  assert(f.removed.includes(botState.parts[0].path));
});

Deno.test("вытеснили, а очередь уже занята — вторую очередь не затираем", async () => {
  const other = JSON.stringify({ ...botState, source: "person", gen: "g-rec" });
  const f = fake({ id: ID, claim_owner: OWNER, summary_status: "processing", notes_edited_at: null, status: null }, {
    [queuedPath(ID)]: other,
  });
  await requeueLost(f.client, ID, botState);
  assertEquals(f.bucket.get(queuedPath(ID)), other);
  assert(f.removed.includes(botState.parts[0].path));
});
