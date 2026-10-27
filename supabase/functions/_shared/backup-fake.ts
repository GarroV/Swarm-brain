// Фейк supabase-клиента для тестов серверных бэкапов: таблица meeting_audio_backups в памяти и
// хранилище путей. Поддерживает ровно те вызовы, которыми ходят meeting-ingest/backup.ts и
// meeting-backup-retention.ts (eq / is / or по expires_at и replaced_at / order / limit / single).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface FakeRow {
  id: string;
  meeting_id: string;
  source: string;
  parts: Array<{ path: string }>;
  expires_at: string;
  replaced_at: string | null;
  purged_at: string | null;
  [k: string]: unknown;
}

export interface FakeBackupDb {
  client: SupabaseClient;
  rows: FakeRow[];
  files: Set<string>;
  /** Пути, на которых upload/remove должны падать. */
  failUpload: Set<string>;
  failRemove: Set<string>;
  /** Следующая вставка падает (код ошибки). */
  failInsert: { code?: string } | null;
}

export function fakeBackupDb(): FakeBackupDb {
  const db: FakeBackupDb = {
    rows: [],
    files: new Set(),
    failUpload: new Set(),
    failRemove: new Set(),
    failInsert: null,
    client: null as unknown as SupabaseClient,
  };
  let seq = 0;

  const from = (table: string) => {
    if (table !== "meeting_audio_backups") throw new Error(`фейк не знает таблицу ${table}`);
    const filters: Array<(r: FakeRow) => boolean> = [];
    let patch: Record<string, unknown> | null = null;
    let insertRow: Record<string, unknown> | null = null;
    let limit = Infinity;
    let orderBy: string | null = null;
    let selected = false;

    const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
      if (insertRow) {
        if (db.failInsert) return { data: null, error: { message: "insert failed", ...db.failInsert } };
        const dup = db.rows.some((r) =>
          r.meeting_id === insertRow!.meeting_id && r.source === insertRow!.source && !r.purged_at && !r.replaced_at
        );
        if (dup) {
          return { data: null, error: { message: "duplicate key meeting_audio_backups_active_uq", code: "23505" } };
        }
        const row: FakeRow = {
          expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
          replaced_at: null,
          purged_at: null,
          ...insertRow,
          id: `b${++seq}`,
        } as FakeRow;
        db.rows.push(row);
        return { data: row, error: null };
      }
      let hit = db.rows.filter((r) => filters.every((f) => f(r)));
      if (patch) {
        hit.forEach((r) => Object.assign(r, patch));
        return { data: hit, error: null };
      }
      if (orderBy) hit = [...hit].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
      return { data: hit.slice(0, limit), error: null };
    };

    const q: Record<string, unknown> = {
      select: () => {
        selected = true;
        return q;
      },
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      is: (col: string, v: null) => (filters.push((r) => (r[col] ?? null) === v), q),
      or: (expr: string) => {
        const m = expr.match(/^expires_at\.lt\.(.+),replaced_at\.not\.is\.null$/);
        if (!m) throw new Error(`фейк не знает фильтр or(${expr})`);
        filters.push((r) => Date.parse(r.expires_at) < Date.parse(m[1]) || r.replaced_at !== null);
        return q;
      },
      order: (col: string) => ((orderBy = col), q),
      limit: (n: number) => ((limit = n), q),
      update: (p: Record<string, unknown>) => ((patch = p), q),
      insert: (r: Record<string, unknown>) => ((insertRow = r), q),
      single: () => Promise.resolve(run()),
      maybeSingle: () => {
        const r = run();
        const first = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return Promise.resolve({ data: first, error: r.error });
      },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    void selected;
    return q;
  };

  const storage = {
    from: () => ({
      upload: (path: string) => {
        if (db.failUpload.has(path) || [...db.failUpload].some((p) => path.endsWith(p))) {
          return Promise.resolve({ error: { message: "upload failed" } });
        }
        db.files.add(path);
        return Promise.resolve({ error: null });
      },
      remove: (paths: string[]) => {
        if (paths.some((p) => db.failRemove.has(p))) return Promise.resolve({ error: { message: "remove failed" } });
        paths.forEach((p) => db.files.delete(p));
        return Promise.resolve({ error: null });
      },
    }),
  };

  db.client = { from, storage } as unknown as SupabaseClient;
  return db;
}
