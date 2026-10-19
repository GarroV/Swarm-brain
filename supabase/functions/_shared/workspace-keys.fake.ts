// Фейковая база для тестов ключей пространств и мастер-админов: в памяти, только то, что
// используют workspace-keys.ts / master-admins.ts / workspace-keys-routes.ts
// (select/eq/order/maybeSingle, upsert, delete). Считает чтения — для проверки кэша.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Row = Record<string, unknown>;
export type FakeDb = {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  /** Сколько select-запросов ушло в каждую таблицу. */
  reads: Record<string, number>;
};

const KEYS: Record<string, string[]> = {
  workspace_secrets: ["group_id", "kind"],
  master_admins: ["telegram_id"],
  workspaces: ["id"],
  ai_key_health: ["group_id", "source"],
  stalled_meeting_alerts: ["meeting_id"],
};

export function makeFakeDb(
  initial: Record<string, Row[]> = {},
  /** Таблицы, на которые база отвечает ошибкой (например, миграция не накатана: 42P01). */
  failing: Record<string, { code: string }> = {},
): FakeDb {
  const tables: Record<string, Row[]> = {
    workspaces: [],
    workspace_secrets: [],
    master_admins: [],
    ...structuredClone(initial),
  };
  const reads: Record<string, number> = {};

  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const lts: Array<[string, string]> = [];
    let op: "select" | "upsert" | "delete" | "update" | "insert" = "select";
    let payload: Row | null = null;
    let ignoreDuplicates = false;
    let returning = false;
    const rows = () => tables[table] ?? (tables[table] = []);
    const match = (r: Row) => filters.every(([c, v]) => r[c] === v) && lts.every(([c, v]) => String(r[c]) < v);
    const run = (): { data: unknown; error: { code: string } | null } => {
      if (failing[table]) return { data: null, error: failing[table] };
      if (op === "select") {
        reads[table] = (reads[table] ?? 0) + 1;
        return { data: structuredClone(rows().filter(match)), error: null };
      }
      if (op === "delete") {
        tables[table] = rows().filter((r) => !match(r));
        return { data: null, error: null };
      }
      if (op === "update") {
        const hit = rows().filter(match).map((r) => ({ ...r, ...payload! }));
        tables[table] = rows().map((r) => (match(r) ? { ...r, ...payload! } : r));
        return { data: returning ? structuredClone(hit) : null, error: null };
      }
      if (op === "insert") {
        const keyCols = KEYS[table];
        if (keyCols && rows().some((r) => keyCols.every((c) => r[c] === payload![c]))) {
          return { data: null, error: { code: "23505" } };
        }
        rows().push({ ...payload! });
        return { data: null, error: null };
      }
      const keyCols = KEYS[table];
      const i = rows().findIndex((r) => keyCols.every((c) => r[c] === payload![c]));
      if (i < 0) rows().push({ ...payload! });
      else if (!ignoreDuplicates) rows()[i] = { ...rows()[i], ...payload! };
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => ((returning = true), b),
      order: () => b,
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      is: (c: string, v: unknown) => (filters.push([c, v]), b),
      lt: (c: string, v: string) => (lts.push([c, v]), b),
      upsert: (row: Row, opts?: { ignoreDuplicates?: boolean }) => {
        op = "upsert";
        payload = row;
        ignoreDuplicates = !!opts?.ignoreDuplicates;
        return b;
      },
      delete: () => (op = "delete", b),
      insert: (row: Row) => {
        op = "insert";
        payload = row;
        return b;
      },
      update: (row: Row) => {
        op = "update";
        payload = row;
        return b;
      },
      maybeSingle: () => {
        const r = run();
        if (r.error) return Promise.resolve({ data: null, error: r.error });
        return Promise.resolve({ data: (r.data as Row[])[0] ?? null, error: null });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { client: { from } as unknown as SupabaseClient, tables, reads };
}
