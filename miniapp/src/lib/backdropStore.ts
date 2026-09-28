// Своя картинка фона — хранится в IndexedDB ЭТОГО браузера (docs/decisions/2026-09-24-backdrop.md).
// На сервер не уходит: личное фото не должно лежать по открытой ссылке, а закрытого хранилища
// файлов пока нет. Профиль знает только, что выбран вариант «custom».

export interface CustomBackdrop {
  blob: Blob;
  /** Затемнение поверх картинки, 0–80 (%) — чтобы интерфейс читался на любой фотке. */
  dim: number;
  /** Размытие картинки, 0–24 (px). */
  blur: number;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
}

export const DIM_MAX = 80;
export const BLUR_MAX = 24;
export const DEFAULT_DIM = 40;
export const DEFAULT_BLUR = 0;

const DB_NAME = "swarm-ui";
const STORE = "backdrop";
const KEY = "custom";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));

/** Прочитать сохранённую картинку; нет её или хранилище недоступно — null (громко в консоль). */
export async function loadCustomBackdrop(): Promise<CustomBackdrop | null> {
  try {
    const rec = await run<CustomBackdrop | undefined>("readonly", (s) => s.get(KEY));
    if (!rec || !(rec.blob instanceof Blob)) return null;
    return { ...rec, dim: clamp(rec.dim, DIM_MAX), blur: clamp(rec.blur, BLUR_MAX) };
  } catch (e) {
    console.error("[backdropStore] load failed", e);
    return null;
  }
}

/** Сохранить картинку/настройки. Ошибка (квота, приватное окно) — наружу: её надо показать. */
export async function saveCustomBackdrop(rec: CustomBackdrop): Promise<void> {
  const clean = { ...rec, dim: clamp(rec.dim, DIM_MAX), blur: clamp(rec.blur, BLUR_MAX) };
  await run<IDBValidKey>("readwrite", (s) => s.put(clean, KEY));
}

export async function deleteCustomBackdrop(): Promise<void> {
  await run<undefined>("readwrite", (s) => s.delete(KEY));
}
