// Сверка претендента — запись в базу (T160). Ядро прав: здесь решение challenge.ts превращается в
// условные UPDATE, и ошибка в них — перехват по устаревшему чтению или отказ, который всё же
// отобрал право. Клиент базы подменён записывающим двойником: проверяются фильтры и тела UPDATE.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InMemoryPart } from "../_shared/meeting-processor.ts";
import { lowerHolderSeconds, measureUpload, settleChallengeUpload } from "./challenge-io.ts";
import { m4aOf, type Overrides } from "./m4a-fixture.ts";

/** Часть .m4a длиной `seconds` по содержимому (m4a-fixture.ts) — звук серверу не нужен, нужна форма. */
const fakeM4a = (seconds: number, o: Overrides = {}) => m4aOf(seconds, o);

const NOW = "2026-09-28T12:00:00.000Z";
const HOLDER = 100;
const TAKER = 200;

interface Call {
  op: "select" | "update";
  patch?: Record<string, unknown>;
  filters: string[];
}

/** Двойник supabase-js: цепочка from().select|update().eq/is/or()…maybeSingle|select. */
function fakeDb(row: Record<string, unknown> | null, updateHits: boolean[]) {
  const calls: Call[] = [];
  let updates = 0;
  const client = {
    from(_table: string) {
      return {
        select(_cols: string) {
          const call: Call = { op: "select", filters: [] };
          calls.push(call);
          const q = {
            eq: (c: string, v: unknown) => (call.filters.push(`${c}=eq.${v}`), q),
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          };
          return q;
        },
        update(patch: Record<string, unknown>) {
          const call: Call = { op: "update", patch, filters: [] };
          calls.push(call);
          const hit = "recorders" in patch && Object.keys(patch).length === 1 ? true : updateHits[updates++];
          const result = { data: hit ? [{ id: "m" }] : [], error: null };
          const q = {
            eq: (c: string, v: unknown) => (call.filters.push(`${c}=eq.${v}`), q),
            is: (c: string, v: unknown) => (call.filters.push(`${c}=is.${v}`), q),
            or: (f: string) => (call.filters.push(`or(${f})`), q),
            select: (_c: string) => ({
              maybeSingle: () => Promise.resolve({ data: hit ? { id: "m" } : null, error: null }),
              then: (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok),
            }),
            then: (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok),
          };
          return q;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const part = (offset: number, seconds: number, o: Overrides = {}): InMemoryPart =>
  ({ blob: new Blob([fakeM4a(seconds, o)]), offset, name: `p${offset}` }) as unknown as InMemoryPart;

function heldRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim_owner: HOLDER,
    recorded_seconds: 180,
    transcript: null,
    notes_edited_at: null,
    status: "draft",
    lease_expires_at: "2026-09-28T12:20:00.000Z",
    agent_last_recording: false,
    started_at: "2026-09-28T09:00:00.000Z",
    created_at: "2026-09-28T09:00:00.000Z",
    recorders: [
      { telegram_id: HOLDER, claimed_at: "2026-09-28T09:03:00.000Z", role: "transcribe", recorded_seconds: 180 },
      { telegram_id: TAKER, claimed_at: "2026-09-28T11:55:00.000Z", role: "challenger", recorded_seconds: 9000 },
    ],
    ...extra,
  };
}

const rolesOf = (call: Call | undefined) =>
  Object.fromEntries(
    ((call?.patch?.recorders ?? []) as Array<{ telegram_id: number; role: string }>).map((
      r,
    ) => [r.telegram_id, r.role]),
  );

Deno.test("замер выгрузки: охват частей по содержимому, пересечение дорожек не удваивается", async () => {
  assertEquals(await measureUpload([part(0, 900), part(900, 600), part(100, 300)]), 1500);
  assertEquals(await measureUpload([part(0, 900), { ...part(900, 1), blob: new Blob(["не mp4"]) }]), null);
});

Deno.test("ЯДРО: выгрузка полнее — перехват UPDATE под условиями держателя, держатель superseded", async () => {
  const { client, calls } = fakeDb(heldRow(), [true]);
  const out = await settleChallengeUpload(
    client,
    "m",
    TAKER,
    1.5,
    [part(0, 900), part(900, 900), part(1800, 900)],
    NOW,
  );
  assertEquals(out, { ok: true, reset: true, measuredSec: 2700 });
  const take = calls.find((c) => c.op === "update" && "claim_owner" in (c.patch ?? {}));
  assertEquals(take?.patch?.claim_owner, TAKER);
  assertEquals(take?.patch?.recorded_seconds, 2700);
  assertEquals(take?.patch?.mic_start_offset, 1.5);
  assertEquals(take?.patch?.summary_status, null);
  assertEquals(take?.filters, [
    "id=eq.m",
    `claim_owner=eq.${HOLDER}`,
    "recorded_seconds=eq.180",
    `or(agent_last_recording.is.null,agent_last_recording.is.false,lease_expires_at.is.null,lease_expires_at.lt.${NOW})`,
  ]);
  assertEquals(rolesOf(calls.at(-1)), { [HOLDER]: "superseded", [TAKER]: "transcribe" });
});

Deno.test("ЯДРО: заявлено много, выгружено мало — 409, право не трогается, претендент defer", async () => {
  const { client, calls } = fakeDb(heldRow(), []);
  const out = await settleChallengeUpload(client, "m", TAKER, null, [part(0, 200)], NOW);
  assertEquals(out.ok, false);
  assertEquals(out.ok === false && out.status, 409);
  assertEquals(calls.filter((c) => c.op === "update" && "claim_owner" in (c.patch ?? {})).length, 0);
  assertEquals(rolesOf(calls.at(-1)), { [HOLDER]: "transcribe", [TAKER]: "defer" });
});

Deno.test("ЯДРО: длинный заголовок у короткого или пустого файла — 409, перехвата нет", async () => {
  for (const parts of [[part(0, 2, { mvhdSec: 9000 })], [part(0, 9000, { noMdat: true })]]) {
    const { client, calls } = fakeDb(heldRow(), [true]);
    const out = await settleChallengeUpload(client, "m", TAKER, null, parts, NOW);
    assertEquals(out.ok === false && out.status, 409);
    assertEquals(calls.filter((c) => c.op === "update" && "claim_owner" in (c.patch ?? {})).length, 0);
    assertEquals(rolesOf(calls.at(-1)), { [HOLDER]: "transcribe", [TAKER]: "defer" });
  }
});

Deno.test("ЯДРО: строка изменилась за время сверки (UPDATE не лёг) — 409 и defer, а не перехват", async () => {
  const { client, calls } = fakeDb(heldRow(), [false]);
  const out = await settleChallengeUpload(client, "m", TAKER, null, [part(0, 900), part(900, 900)], NOW);
  assertEquals(out.ok === false && out.status, 409);
  assertEquals(rolesOf(calls.at(-1)), { [HOLDER]: "transcribe", [TAKER]: "defer" });
});

Deno.test("брошенная встреча (лиз истёк, стенограммы нет) — занимается без сброса маркеров", async () => {
  const { client, calls } = fakeDb(heldRow({ lease_expires_at: "2026-09-28T11:00:00.000Z" }), [true]);
  const out = await settleChallengeUpload(client, "m", TAKER, null, [part(0, 60)], NOW);
  assertEquals(out, { ok: true, reset: false, measuredSec: 60 });
  const take = calls.find((c) => c.op === "update" && "claim_owner" in (c.patch ?? {}));
  assertEquals("summary_status" in (take?.patch ?? {}), false);
  assertEquals(take?.filters, ["id=eq.m", "transcript=is.null", `or(claim_owner.is.null,lease_expires_at.lt.${NOW})`]);
});

Deno.test("встречи нет — 404, в базу ничего не пишется", async () => {
  const { client, calls } = fakeDb(null, []);
  const out = await settleChallengeUpload(client, "m", TAKER, null, [part(0, 60)], NOW);
  assertEquals(out.ok === false && out.status, 404);
  assertEquals(calls.filter((c) => c.op === "update").length, 0);
});

Deno.test("ЯДРО: поправка секунд держателя — только при тех же держателе и секундах и без бота", async () => {
  const { client, calls } = fakeDb(null, [true]);
  await lowerHolderSeconds(client, "m", HOLDER, 86_000, 600);
  assertEquals(calls[0]?.patch, { recorded_seconds: 600 });
  assertEquals(calls[0]?.filters, [
    "id=eq.m",
    `claim_owner=eq.${HOLDER}`,
    "recorded_seconds=eq.86000",
    "agent_last_seen_at=is.null",
  ]);
});
