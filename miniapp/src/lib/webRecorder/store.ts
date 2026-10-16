// IndexedDB-слой движка записи: фрагменты кусков и закрытые куски живут здесь, пока сервер
// не подтвердил приём. Любая ошибка хранилища (приватное окно, квота) — тихий возврат пустого:
// запись продолжается из памяти, просто без защиты от закрытия вкладки.
import type { ChunkRec, RecordingRec, SegmentRec } from "./types";

const DB_NAME = "swarm-web-recorder";
const DB_VERSION = 1;
const RECORDINGS = "recordings";
const SEGMENTS = "segments";
const CHUNKS = "chunks";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(RECORDINGS, { keyPath: "rid" });
        db.createObjectStore(SEGMENTS, { keyPath: ["rid", "n"] });
        db.createObjectStore(CHUNKS, { keyPath: ["rid", "n", "i"] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** Одна транзакция; false, если хранилище недоступно или транзакция упала. */
async function run(
  stores: string[],
  mode: IDBTransactionMode,
  op: (tx: IDBTransaction) => void,
): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(stores, mode);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      op(tx);
    } catch {
      resolve(false);
    }
  });
}

async function readAll<T>(store: string, range?: IDBKeyRange): Promise<T[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).getAll(range);
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export const putRecording = (r: RecordingRec) =>
  run([RECORDINGS], "readwrite", (tx) => { tx.objectStore(RECORDINGS).put(r); });

export const listRecordings = () => readAll<RecordingRec>(RECORDINGS);

export const putChunk = (c: ChunkRec) =>
  run([CHUNKS], "readwrite", (tx) => { tx.objectStore(CHUNKS).put(c); });

/** Закрытый кусок записывается и в той же транзакции стирает свои фрагменты. */
export const putSegment = (s: SegmentRec) =>
  run([SEGMENTS, CHUNKS], "readwrite", (tx) => {
    tx.objectStore(SEGMENTS).put(s);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([s.rid, s.n, 0], [s.rid, s.n, Infinity]));
  });

export const deleteSegment = (rid: string, n: number) =>
  run([SEGMENTS], "readwrite", (tx) => { tx.objectStore(SEGMENTS).delete([rid, n]); });

export const deleteRecording = (rid: string) =>
  run([RECORDINGS, SEGMENTS, CHUNKS], "readwrite", (tx) => {
    tx.objectStore(RECORDINGS).delete(rid);
    tx.objectStore(SEGMENTS).delete(IDBKeyRange.bound([rid, 0], [rid, Infinity]));
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([rid, 0, 0], [rid, Infinity, Infinity]));
  });

/**
 * Всё, что осталось на диске по записи: закрытые куски как есть, а фрагменты незакрытого куска
 * склеены по порядку в один blob (целиком он читается, одиночные фрагменты — нет).
 */
export async function loadLeftovers(rid: string): Promise<SegmentRec[]> {
  const closed = await readAll<SegmentRec>(SEGMENTS, IDBKeyRange.bound([rid, 0], [rid, Infinity]));
  const chunks = await readAll<ChunkRec>(CHUNKS, IDBKeyRange.bound([rid, 0, 0], [rid, Infinity, Infinity]));
  const closedN = new Set(closed.map((s) => s.n));
  const byN = new Map<number, ChunkRec[]>();
  for (const c of chunks) {
    if (closedN.has(c.n)) continue;
    byN.set(c.n, [...(byN.get(c.n) ?? []), c]);
  }
  const assembled: SegmentRec[] = [...byN.entries()].map(([n, list]) => {
    const sorted = [...list].sort((a, b) => a.i - b.i);
    return {
      rid,
      n,
      offset: sorted[0].offset,
      mime: sorted[0].mime,
      blob: new Blob(sorted.map((c) => c.blob), { type: sorted[0].mime }),
    };
  });
  return [...closed, ...assembled].sort((a, b) => a.n - b.n);
}
