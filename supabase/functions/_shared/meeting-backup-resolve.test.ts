// Разборщик копий записей (#1314) на фейковой базе: что он записывает в копию и во встречу.
// Решения по случаям — в meeting-backup-decision.test.ts; здесь — исполнение: итог в копии, вливание
// тем же путём, что вторая запись в ingest, одна тяжёлая операция за проход, сбой не теряет копию.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { countNeedsReview, INGEST_PER_PASS, resolveBackups } from "./meeting-backup-resolve.ts";

type Row = Record<string, unknown>;
const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();

function fake(tables: Record<string, Row[]>, files: Map<string, Blob>, onUpload?: () => void) {
  const col = (r: Row, c: string) => (c === "process_state->>gen" ? r.gen ?? null : r[c] ?? null);
  const from = (table: string) => {
    const rows = tables[table];
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let limit = Infinity;
    let order: string | null = null;
    let head = false;
    const run = () => {
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) {
        hit.forEach((r) => {
          Object.assign(r, patch);
          const ps = patch!.process_state as Row | undefined;
          if (ps) {
            r.gen = ps.gen;
            r.sources = ps.sources;
          }
        });
        return { data: hit.map((r) => ({ id: r.id })), error: null, count: hit.length };
      }
      if (order) hit = [...hit].sort((a, b) => String(a[order!]).localeCompare(String(b[order!])));
      return { data: head ? null : hit.slice(0, limit), error: null, count: hit.length };
    };
    const q: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = o?.head ?? false), q),
      eq: (c: string, v: unknown) => (filters.push((r) => col(r, c) === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => col(r, c) !== v), q),
      is: (c: string, v: null) => (filters.push((r) => col(r, c) === v), q),
      gte: (c: string, v: string) => (filters.push((r) => String(col(r, c)) >= v), q),
      order: (c: string) => ((order = c), q),
      limit: (n: number) => ((limit = n), q),
      update: (p: Row) => ((patch = p), q),
      maybeSingle: () => {
        const r = run();
        return Promise.resolve({ data: (r.data as Row[])[0] ? { ...(r.data as Row[])[0] } : null, error: null });
      },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };
  const storage = {
    from: () => ({
      download: (p: string) =>
        Promise.resolve(
          files.has(p) ? { data: files.get(p), error: null } : { data: null, error: { message: "нет файла" } },
        ),
      upload: (p: string, b: Blob) => (files.set(p, b), onUpload?.(), Promise.resolve({ error: null })),
      remove: (ps: string[]) => (ps.forEach((p) => files.delete(p)), Promise.resolve({ error: null })),
    }),
  };
  return { from, storage } as unknown as SupabaseClient;
}

function world() {
  const files = new Map<string, Blob>();
  const tables: Record<string, Row[]> = { meeting_audio_backups: [], meetings: [] };
  const meeting = (id: string, over: Row = {}) => {
    tables.meetings.push({
      id,
      claim_owner: 7,
      summary_status: "done",
      status: "awaiting_review",
      notes_edited_at: null,
      recorded_seconds: 420,
      sources: ["person:7"],
      gen: "g0",
      first_segment: { text: "привет" },
      created_at: ago(30),
      ...over,
    });
  };
  const backup = (id: string, meetingId: string, over: Row = {}) => {
    const p1 = `backup/${meetingId}/person_7/u1/sys-a.m4a`;
    const p2 = `backup/${meetingId}/person_7/u1/mic-b.m4a`;
    files.set(p1, new Blob(["sys"]));
    files.set(p2, new Blob(["mic"]));
    tables.meeting_audio_backups.push({
      id,
      meeting_id: meetingId,
      uploader: 7,
      source: "person:7",
      recorded_seconds: 6100,
      created_at: ago(5),
      expires_at: ago(-60),
      parts: [
        { track: "sys", name: "a.m4a", offset: 0, path: p1, size: 3 },
        { track: "mic", name: "b.m4a", offset: 2, path: p2, size: 3 },
      ],
      replaced_at: null,
      purged_at: null,
      resolution: null,
      resolved_at: null,
      ...over,
    });
  };
  return { files, tables, meeting, backup, client: () => fake(tables, files) };
}
const backupRow = (w: ReturnType<typeof world>, id: string) => w.tables.meeting_audio_backups.find((r) => r.id === id)!;
const meetingRow = (w: ReturnType<typeof world>, id: string) => w.tables.meetings.find((r) => r.id === id)!;

Deno.test("ЯДРО: покрытая копия помечается covered и во встречу ничего не пишет", async () => {
  const w = world();
  w.meeting("m1", { recorded_seconds: 6526 });
  w.backup("b1", "m1");
  const r = await resolveBackups(w.client(), NOW);
  assertEquals(r.covered, 1);
  assertEquals(backupRow(w, "b1").resolution, "covered");
  assert(backupRow(w, "b1").resolved_at !== null);
  assertEquals(meetingRow(w, "m1").summary_status, "done");
});

Deno.test("ЯДРО: непокрытая копия того же человека вливается второй записью, как в ingest", async () => {
  const w = world();
  w.meeting("m1", { recorded_seconds: 420 });
  w.backup("b1", "m1");
  const r = await resolveBackups(w.client(), NOW);
  assertEquals(r.ingested, 1);
  const m = meetingRow(w, "m1");
  assertEquals(m.summary_status, "processing");
  const state = m.process_state as {
    challenge: { priorStatus: string };
    source: string;
    sources: string[];
    owner: number;
    parts: Array<{ path: string; track: string }>;
  };
  assertEquals(state.challenge, { priorStatus: "done" });
  assertEquals([state.source, state.owner], ["person:7", 7]);
  assertEquals(state.parts.map((p) => p.track), ["sys", "mic"]);
  for (const p of state.parts) assert(w.files.has(p.path), `часть ${p.path} не в хранилище встречи`);
  assertEquals(backupRow(w, "b1").resolution, "ingested");
  assertEquals(typeof backupRow(w, "b1").used_at, "string");
});

Deno.test("ЯДРО: копия чужого человека не вливается — needs_review, остаётся неразобранной (resolved_at пуст)", async () => {
  const w = world();
  w.meeting("m1", { claim_owner: 9, recorded_seconds: 4867, sources: ["person:9"] });
  w.backup("b1", "m1", { recorded_seconds: 630, expires_at: ago(10) });
  const r = await resolveBackups(w.client(), NOW);
  assertEquals(r.review, 1);
  assertEquals(backupRow(w, "b1").resolution, "needs_review");
  assertEquals(backupRow(w, "b1").resolved_at, null);
  assertEquals(meetingRow(w, "m1").summary_status, "done");
  assertEquals(await countNeedsReview(w.client()), 1);
  // По сроку такую копию не убирает уборка: meeting-backup-retention.test.ts.
});

Deno.test("за проход вливается не больше INGEST_PER_PASS копий, остальные ждут", async () => {
  const w = world();
  for (const n of ["1", "2"]) {
    w.meeting(`m${n}`, { recorded_seconds: 420 });
    w.backup(`b${n}`, `m${n}`);
  }
  const r = await resolveBackups(w.client(), NOW);
  assertEquals([r.ingested, r.waiting], [INGEST_PER_PASS, 2 - INGEST_PER_PASS]);
  assertEquals(w.tables.meeting_audio_backups.filter((b) => b.resolution === "ingested").length, INGEST_PER_PASS);
});

Deno.test("ЯДРО: сбой скачивания — копия остаётся неразобранной, встреча не тронута, повтор возможен", async () => {
  const w = world();
  w.meeting("m1", { recorded_seconds: 420 });
  w.backup("b1", "m1");
  for (const k of [...w.files.keys()]) w.files.delete(k);
  const r = await resolveBackups(w.client(), NOW);
  assertEquals(r.failed, 1);
  assertEquals(backupRow(w, "b1").resolution, null);
  assertEquals(meetingRow(w, "m1").summary_status, "done");
});

Deno.test("свежая копия и обрабатываемая встреча — ждут без записи; разобранная повторно не берётся", async () => {
  const w = world();
  w.meeting("m1", { recorded_seconds: 420 });
  w.backup("young", "m1", { created_at: new Date(NOW - 60_000).toISOString() });
  w.meeting("m2", { summary_status: "processing", recorded_seconds: 100 });
  w.backup("busy", "m2");
  w.meeting("m3", { recorded_seconds: 6526 });
  w.backup("done", "m3");
  const first = await resolveBackups(w.client(), NOW);
  assertEquals([first.waiting, first.covered], [2, 1]);
  assertEquals([backupRow(w, "young").resolution, backupRow(w, "busy").resolution], [null, null]);
  const second = await resolveBackups(w.client(), NOW);
  assertEquals(second.covered, 0, "разобранная копия не берётся второй раз");
});

Deno.test("ЯДРО: встреча сменилась, пока копия заливалась (её взяли в обработку) — приёмка отказывает, залитое убирается, копия ждёт", async () => {
  const w = world();
  w.meeting("m1", { recorded_seconds: 420 });
  w.backup("b1", "m1");
  const before = w.files.size;
  const client = fake(w.tables, w.files, () => {
    meetingRow(w, "m1").summary_status = "processing";
  });
  const r = await resolveBackups(client, NOW);
  assertEquals([r.ingested, r.waiting], [0, 1]);
  assertEquals(backupRow(w, "b1").resolution, null);
  assertEquals(meetingRow(w, "m1").process_state, undefined, "чужое состояние встречи затёрто");
  assertEquals(w.files.size, before, "залитые во встречу части не убраны");
});
