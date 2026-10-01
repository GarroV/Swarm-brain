// Лиз обработки встречи (issue #578) на МЕСТЕ ВЫЗОВА: `runMeetingStep` целиком на поддельном клиенте,
// который исполняет ровно те фильтры, что шлёт модуль. Сеть (OpenAI, Telegram) подменена.
//
// Сценарий перехвата: пока воркер A ждёт ответа модели, лиз забирает воркер B (так было на проде, когда
// шаг шёл дольше LEASE_STALE_MS: лиз не продлевался и cron брал встречу вторым воркером). A после этого
// не имеет права писать ничего: ни прогресс, ни стенограмму, ни тезисы, ни уведомления, и не снимает
// чужой лиз в `finally`.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type ProcessState, runMeetingStep } from "./meeting-processor.ts";
import { ProcessingLease } from "./meeting-processing-lease.ts";

const ID = "m-lease";
const GEN = "gen-1";
const B_TOKEN = "2030-01-01T00:00:00.000Z";
type Row = Record<string, unknown>;

/** Поддельный клиент на одну строку встречи. */
function fake(row: Row) {
  const updates: Row[] = [];
  const uploads: string[] = [];
  const gen = () => (row.process_state as ProcessState | null)?.gen;
  const leaseFree = (expr: string) => {
    const m = /^processing_lease\.is\.null,processing_lease\.lt\.(.+)$/.exec(expr);
    assert(m, `неожиданный or: ${expr}`);
    return row.processing_lease == null || Date.parse(String(row.processing_lease)) < Date.parse(m[1]);
  };
  const client = {
    storage: {
      from: () => ({
        download: (path: string) =>
          path.includes("/queued/")
            ? Promise.resolve({ data: null, error: { message: "not found" } })
            : Promise.resolve({ data: new Blob([new Uint8Array(16)]), error: null }),
        upload: (path: string) => (uploads.push(path), Promise.resolve({ data: {}, error: null })),
        remove: () => Promise.resolve({ data: [], error: null }),
        list: () => Promise.resolve({ data: [], error: null }),
      }),
    },
    from: (table: string) => {
      if (table !== "meetings") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { ...structuredClone(row), gen: gen() ?? null }, error: null }),
          }),
        }),
        update: (patch: Row) => {
          const filters: Array<() => boolean> = [];
          const apply = () => {
            if (!filters.every((f) => f())) return [];
            Object.assign(row, structuredClone(patch));
            updates.push(patch);
            return [{ id: row.id }];
          };
          const chain = {
            eq: (col: string, v: unknown) => {
              filters.push(col === "process_state->>gen" ? () => gen() === v : () => row[col] === v);
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
  return { client: client as unknown as SupabaseClient, updates, uploads, row };
}

interface NetLog {
  whisper: number;
  chat: number;
  telegram: number;
}

/** Сеть: Whisper и чат отвечают успехом; `onModel` зовётся перед ответом модели (там «приходит B»). */
async function withNet(onModel: (kind: "whisper" | "chat") => void, fn: (log: NetLog) => Promise<void>) {
  const original = globalThis.fetch;
  const log: NetLog = { whisper: 0, chat: 0, telegram: 0 };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.telegram.org")) {
      log.telegram++;
      return Promise.resolve(Response.json({ ok: true }));
    }
    const kind = url.includes("/audio/transcriptions") ? "whisper" : "chat";
    log[kind]++;
    onModel(kind);
    if (init?.signal?.aborted) return Promise.reject(init.signal.reason);
    if (kind === "whisper") {
      return Promise.resolve(Response.json({
        text: "Обсудили план запуска.",
        language: "russian",
        segments: [{ start: 0, end: 5, text: "Обсудили план запуска.", no_speech_prob: 0, avg_logprob: -0.1 }],
      }));
    }
    return Promise.resolve(Response.json({
      choices: [{ message: { content: "- План запуска согласован" }, finish_reason: "stop" }],
    }));
  }) as typeof fetch;
  try {
    await fn(log);
  } finally {
    globalThis.fetch = original;
  }
}

function meetingRow(stage: "transcribe" | "summarize"): Row {
  const done = stage === "summarize";
  const state: ProcessState = {
    parts: [{
      track: "sys",
      name: "sys-0.m4a",
      offset: 0,
      path: `${ID}/${GEN}/sys-0.m4a`,
      done,
      attempts: 0,
      ...(done ? { lang: "russian", segments: [{ start: 0, end: 5, text: "Обсудили план запуска." }] } : {}),
    }],
    stage,
    gen: GEN,
    source: "person",
    sources: ["person"],
    owner: 42,
  };
  return {
    id: ID,
    title: "Созвон",
    recorders: [{ telegram_id: 42, claimed_at: "2026-10-01T09:00:00Z", role: "transcribe" }],
    claim_owner: 42,
    mic_start_offset: 0,
    summary_status: "processing",
    processing_lease: null,
    notes_edited_at: null,
    status: "draft",
    transcript: null,
    draft_notes_md: null,
    process_state: state,
  };
}

Deno.test("ЯДРО: прогресс шага продлевает лиз обработки — иначе через 5 минут встречу берёт второй воркер", async () => {
  await withNet(() => {}, async () => {
    const { client, updates, row } = fake(meetingRow("transcribe"));
    await runMeetingStep(client, ID, 10_000);
    const progress = updates.filter((u) => "process_state" in u);
    assert(progress.length > 0, "шаг не сохранил прогресс");
    for (const u of progress) {
      assert(typeof u.processing_lease === "string", "сохранение прогресса не продлило processing_lease");
    }
    assertEquals(row.summary_status, "done");
    assertEquals(row.processing_lease, null);
  });
});

Deno.test("ЯДРО: лиз перехвачен во время Whisper → воркер не пишет прогресс и не снимает чужой лиз", async () => {
  const { client, updates, uploads, row } = fake(meetingRow("transcribe"));
  await withNet((kind) => {
    if (kind === "whisper") row.processing_lease = B_TOKEN;
  }, async (log) => {
    const res = await runMeetingStep(client, ID, 10_000).catch((e: unknown) => e);
    const parts = (row.process_state as ProcessState).parts;
    assertEquals(parts[0].done, false, "воркер без лиза записал прогресс транскрибации");
    assertEquals(row.processing_lease, B_TOKEN, "воркер снял или перезаписал лиз воркера B");
    assertEquals(row.summary_status, "processing");
    assert(updates.every((u) => !("transcript" in u) && !("draft_notes_md" in u)), "воркер без лиза писал содержимое");
    assertEquals(uploads, [], "потеря лиза — не вытеснение поколения: в очередь ставить нечего");
    assertEquals(log.chat, 0, "после потери лиза воркер звал модель тезисов");
    assertEquals(log.telegram, 0);
    assertEquals(res, { claimed: true, done: false });
  });
});

Deno.test("ЯДРО: лиз перехвачен во время тезисов → ни тезисов, ни done, ни уведомлений", async () => {
  const { client, updates, row } = fake(meetingRow("summarize"));
  await withNet((kind) => {
    if (kind === "chat") row.processing_lease = B_TOKEN;
  }, async (log) => {
    const res = await runMeetingStep(client, ID, 10_000).catch((e: unknown) => e);
    assertEquals(row.draft_notes_md, null, "воркер без лиза записал тезисы");
    assertEquals(row.summary_status, "processing", "воркер без лиза закрыл встречу");
    assertEquals(row.processing_lease, B_TOKEN, "воркер снял лиз воркера B");
    assert(updates.every((u) => !("draft_notes_md" in u)));
    assertEquals(log.telegram, 0, "уведомление ушло от воркера без лиза — у людей их было бы два");
    assertEquals(res, { claimed: true, done: false });
  });
});

Deno.test("лиз занят живым воркером → второй не берёт встречу и не зовёт модель", async () => {
  const r = meetingRow("transcribe");
  r.processing_lease = new Date().toISOString();
  const { client, row } = fake(r);
  await withNet(() => {}, async (log) => {
    assertEquals(await runMeetingStep(client, ID, 10_000), { claimed: false, done: false });
    assertEquals(log.whisper, 0);
    assertEquals(row.processing_lease, r.processing_lease);
  });
});

Deno.test("ProcessingLease: продление меняет токен, старый токен больше ничего не пишет", async () => {
  const { client, row } = fake(meetingRow("transcribe"));
  const lease = await ProcessingLease.claim(client, ID);
  assert(lease);
  const first = lease.token;
  await new Promise((r) => setTimeout(r, 5));
  await lease.renew(GEN);
  assertNotEquals(lease.token, first);
  assertEquals(row.processing_lease, lease.token);
  // Протухший с точки зрения времени лиз всё ещё свой — пишет; чужой токен — LeaseLost и флаг lost.
  row.processing_lease = B_TOKEN;
  const err = await lease.renew(GEN).catch((e: unknown) => e);
  assert(err instanceof Error && err.name === "LeaseLostError", `ждали LeaseLostError, а было ${err}`);
  assert(lease.lost && lease.signal.aborted);
  await lease.release();
  assertEquals(row.processing_lease, B_TOKEN, "release снял чужой лиз");
});

Deno.test("ProcessingLease: сменилось поколение при живом лизе — это не потеря лиза, запись просто не легла", async () => {
  const { client, row } = fake(meetingRow("transcribe"));
  const lease = await ProcessingLease.claim(client, ID);
  assert(lease);
  (row.process_state as ProcessState).gen = "gen-2";
  const ok = await lease.write({ updated_at: "x" }, (q) => q.eq("process_state->>gen", GEN), GEN);
  assertEquals(ok, false);
  assertEquals(lease.lost, false);
});

Deno.test("ProcessingLease: запись не легла по другому условию при своём лизе (встречу заморозили) — лиз не потерян", async () => {
  const { client, row } = fake(meetingRow("summarize"));
  const lease = await ProcessingLease.claim(client, ID);
  assert(lease);
  row.notes_edited_at = "2026-10-01T10:00:00Z";
  const ok = await lease.write({ draft_notes_md: "x" }, (q) => q.is("notes_edited_at", null), GEN);
  assertEquals(ok, false);
  assertEquals(lease.lost, false, "свой лиз принят за перехваченный: воркер бросил бы встречу посреди работы");
  await lease.release();
  assertEquals(row.processing_lease, null, "свой лиз не снялся");
});
