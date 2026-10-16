// Подделка supabase-js для тестов записи из браузера: таблица meetings в памяти + Storage-бакет.
// Не общий мок: умеет ровно то, что зовут web-recording.ts (swarm-api и _shared) — eq/is/order/limit,
// insert/update с .select(), maybeSingle/single и list/upload/remove у Storage.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Row = Record<string, unknown>;
export interface StoredFile {
  name: string;
  updated_at?: string;
}

export interface FakeSupabase {
  client: SupabaseClient;
  meetings: Row[];
  /** Пути, залитые upload, в порядке заливки. */
  uploads: { path: string; contentType?: string; bytes: number }[];
  removed: string[];
  files: StoredFile[];
}

class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private patch: Row | null = null;
  private inserted: Row | null = null;
  private wantRows = false;
  private countOnly = false;
  constructor(private db: FakeSupabase) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.countOnly = true;
    else this.wantRows = true;
    return this;
  }
  insert(row: Row) {
    this.inserted = { id: crypto.randomUUID(), summary_status: null, created_at: new Date().toISOString(), ...row };
    this.db.meetings.push(this.inserted);
    return this;
  }
  update(patch: Row) {
    this.patch = patch;
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  is(k: string, v: null) {
    this.filters.push((r) => (r[k] ?? null) === v);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  private matched(): Row[] {
    return this.db.meetings.filter((r) => this.filters.every((f) => f(r)));
  }
  private run(): Row[] {
    if (this.inserted) return [this.inserted];
    const rows = this.matched();
    if (this.patch) { for (const r of rows) Object.assign(r, this.patch); }
    return rows;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.run()[0] ?? null, error: null });
  }
  single() {
    return this.maybeSingle();
  }
  then<T>(resolve: (v: { data: Row[] | null; count: number | null; error: null }) => T) {
    const rows = this.run();
    // head:true — как в PostgREST: строк нет, есть только число подошедших.
    return Promise.resolve(resolve({
      data: this.wantRows ? rows : null,
      count: this.countOnly ? rows.length : null,
      error: null,
    }));
  }
}

export function fakeSupabase(init: { meetings?: Row[]; files?: StoredFile[] } = {}): FakeSupabase {
  const db: FakeSupabase = {
    client: undefined as unknown as SupabaseClient,
    meetings: init.meetings ?? [],
    uploads: [],
    removed: [],
    files: init.files ?? [],
  };
  db.client = {
    from: (table: string) => {
      if (table !== "meetings") throw new Error(`fake: неожиданная таблица ${table}`);
      return new Query(db);
    },
    storage: {
      from: (_bucket: string) => ({
        list: (_dir: string, opts: { limit?: number; offset?: number; search?: string } = {}) => {
          const hit = db.files.filter((f) => !opts.search || f.name.includes(opts.search));
          const off = opts.offset ?? 0;
          return Promise.resolve({ data: hit.slice(off, off + (opts.limit ?? 100)), error: null });
        },
        upload: (path: string, body: Uint8Array, o?: { contentType?: string }) => {
          db.uploads.push({ path, contentType: o?.contentType, bytes: body.byteLength });
          return Promise.resolve({ error: null });
        },
        remove: (paths: string[]) => {
          db.removed.push(...paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
  } as unknown as SupabaseClient;
  return db;
}
