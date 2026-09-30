// Сверка претендента против одновременной записи соседа (T168). settleChallengeUpload читает
// строку, долго меряет выгрузку и пишет `recorders` обратно; заявка третьего человека, вписанная
// в это окно, стирать не должна: по роли challenger ingest решает, принять ли его выгрузку.
// Двойник базы — строка в памяти, фильтры UPDATE исполняются по-настоящему.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InMemoryPart } from "../_shared/meeting-processor.ts";
import { settleChallengeUpload } from "./challenge-io.ts";
import { m4aOf } from "./m4a-fixture.ts";

const NOW = "2026-09-28T12:00:00.000Z";
const HOLDER = 100;
const TAKER = 200;
const THIRD = 300;
type Row = Record<string, unknown>;

function statefulDb(row: Row, afterFirstRead: (row: Row) => void) {
  let reads = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            const snap = structuredClone(row);
            if (++reads === 1) afterFirstRead(row);
            return Promise.resolve({ data: snap, error: null });
          },
        }),
      }),
      update: (patch: Row) => {
        const conds: Array<() => boolean> = [];
        const run = () => {
          const ok = conds.every((f) => f());
          if (ok) Object.assign(row, patch);
          return { data: ok ? [{ id: "m" }] : [], error: null };
        };
        const chain = {
          eq: (c: string, v: unknown) => {
            conds.push(() =>
              c === "id" ||
              (c === "recorders" ? JSON.stringify(row[c]) === JSON.stringify(JSON.parse(String(v))) : row[c] === v)
            );
            return chain;
          },
          neq: (c: string, v: unknown) => (conds.push(() => row[c] !== v), chain),
          is: (c: string, _v: null) => (conds.push(() => row[c] === null || row[c] === undefined), chain),
          or: (_f: string) => chain,
          select: () => {
            const res = run();
            return Object.assign(Promise.resolve(res), {
              maybeSingle: () => Promise.resolve({ data: res.data[0] ?? null, error: null }),
            });
          },
          then: (ok: (v: unknown) => unknown) => Promise.resolve(run()).then(ok),
        };
        return chain;
      },
    }),
  };
  return client as unknown as SupabaseClient;
}

const part = (seconds: number): InMemoryPart =>
  ({ blob: new Blob([m4aOf(seconds)]), offset: 0, name: "p0" }) as unknown as InMemoryPart;

function held(): Row {
  return {
    claim_owner: HOLDER,
    recorded_seconds: 1800,
    transcript: null,
    notes_edited_at: null,
    status: "awaiting_review",
    summary_status: null,
    lease_expires_at: "2026-09-28T12:20:00.000Z",
    agent_last_recording: false,
    started_at: "2026-09-28T09:00:00.000Z",
    created_at: "2026-09-28T09:00:00.000Z",
    recorders: [
      { telegram_id: HOLDER, claimed_at: "2026-09-28T09:03:00.000Z", role: "transcribe" },
      { telegram_id: TAKER, claimed_at: "2026-09-28T11:55:00.000Z", role: "challenger", recorded_seconds: 9000 },
    ],
  };
}

Deno.test("ЯДРО: отказ претенденту не стирает заявку третьего, вписанную, пока выгрузку мерили", async () => {
  const row = held();
  const db = statefulDb(row, (r) => {
    r.recorders = [
      ...(r.recorders as Row[]),
      { telegram_id: THIRD, claimed_at: "2026-09-28T11:59:00.000Z", role: "challenger", recorded_seconds: 7000 },
    ];
  });
  const out = await settleChallengeUpload(db, "m", TAKER, null, [part(600)], NOW);
  assertEquals(out.ok, false);
  const roles = Object.fromEntries((row.recorders as Row[]).map((r) => [r.telegram_id, r.role]));
  assertEquals(roles, { [HOLDER]: "transcribe", [TAKER]: "defer", [THIRD]: "challenger" });
});
