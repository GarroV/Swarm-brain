// Запись списка `meetings.recorders` условной UPDATE с повтором. Список — не справка: по роли
// `challenger` в нём meeting-ingest решает, принимать ли выгрузку другого человека, поэтому
// одновременная запись не должна стирать чужую строку.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { updateRecorders } from "./recorders-write.ts";

type Entry = { telegram_id: number; role: string };

/** Строка встречи в памяти; `onRead` — чужая запись между нашим чтением и нашей UPDATE. */
export function recordersDb(initial: Entry[] | null, onRead?: (n: number, db: { recorders: Entry[] | null }) => void) {
  const db = { recorders: initial };
  let reads = 0;
  let writes = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            const snap = db.recorders === null ? null : structuredClone(db.recorders);
            onRead?.(++reads, db);
            return Promise.resolve({ data: { recorders: snap }, error: null });
          },
        }),
      }),
      update: (patch: { recorders: Entry[] }) => {
        const conds: Array<() => boolean> = [];
        const chain = {
          eq: (c: string, v: unknown) => {
            if (c === "recorders") {
              conds.push(() => JSON.stringify(db.recorders) === JSON.stringify(JSON.parse(String(v))));
            }
            return chain;
          },
          is: (c: string, _v: null) => {
            if (c === "recorders") conds.push(() => db.recorders === null);
            return chain;
          },
          select: () => {
            const ok = conds.every((f) => f());
            if (ok) {
              db.recorders = patch.recorders;
              writes++;
            }
            return Promise.resolve({ data: ok ? [{ id: "m" }] : [], error: null });
          },
        };
        return chain;
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, db, writes: () => writes };
}

const addC = (list: unknown[]) => [...(list as Entry[]), { telegram_id: 3, role: "challenger" }];

Deno.test("чужая строка, вписанная между чтением и записью, не стирается", async () => {
  const f = recordersDb([{ telegram_id: 1, role: "transcribe" }], (n, db) => {
    if (n === 1) db.recorders = [...(db.recorders ?? []), { telegram_id: 2, role: "challenger" }];
  });
  assert(await updateRecorders(f.client, "m", addC));
  assertEquals(f.db.recorders?.map((r) => r.telegram_id), [1, 2, 3]);
});

Deno.test("пустой список (null) пишется условием is null", async () => {
  const f = recordersDb(null);
  assert(await updateRecorders(f.client, "m", addC));
  assertEquals(f.db.recorders, [{ telegram_id: 3, role: "challenger" }]);
});

Deno.test("гонка без конца — false после ограниченного числа попыток, а не вечный цикл", async () => {
  const f = recordersDb([], (_n, db) => {
    db.recorders = [...(db.recorders ?? []), { telegram_id: 9, role: "x" }];
  });
  assertEquals(await updateRecorders(f.client, "m", addC), false);
  assertEquals(f.writes(), 0);
});

Deno.test("мутация без изменений ничего не пишет", async () => {
  const f = recordersDb([{ telegram_id: 1, role: "transcribe" }]);
  assert(await updateRecorders(f.client, "m", () => null));
  assertEquals(f.writes(), 0);
});
