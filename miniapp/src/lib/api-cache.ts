// Кэш чтения веба — всё, что решает, ПОЙДЁТ ли GET в сеть (issues #103, #492). Сам механизм —
// request-cache.ts, здесь политика: какие ручки кэшируются между экранами и когда кэш выбрасывается.
import { createRequestCache, REQUEST_CACHE_TTL_MS, SWR_FRESH_MS, SWR_MAX_STALE_MS } from "./request-cache";

// Кэш ТОЛЬКО в памяти вкладки и только для чтения; любая мутация его сбрасывает, чтобы экран не
// показал данные «на шаг назад».
const requestCache = createRequestCache({ ttlMs: REQUEST_CACHE_TTL_MS });

// Тяжёлые «справочные» чтения: полный список задач, проекты, записи и т.п. Раздел, который
// каждый раз монтируется заново (Проекты, Спринты), качал их по 400 кБ при каждом заходе. Для них
// кэш работает как stale-while-revalidate: свежее окно — из памяти, дальше старое сразу и
// перечитывание в фоне с оповещением (`subscribeDataRevalidated`). Только ТОЧНЫЕ ключи: опросы
// (дельта `since=`, очередь вычитки, уведомления) сюда не попадают и всегда ходят в сеть.
const SWR_PATHS: ReadonlySet<string> = new Set([
  "/tasks?confirmed=true",
  "/projects",
  "/projects?sprint_groups=1",
  "/sprints?kind=board_tab",
  "/entries",
  "/users",
  "/task-labels",
]);

/** Чтение через кэш: SWR для `SWR_PATHS`, иначе склейка «в полёте» + короткий TTL. */
export async function cachedRead<T>(path: string, fetcher: () => Promise<T>): Promise<T> {
  if (!SWR_PATHS.has(path)) return requestCache.run(path, fetcher);
  const data = await requestCache.run(path, fetcher, { freshMs: SWR_FRESH_MS, maxStaleMs: SWR_MAX_STALE_MS });
  // Копия: экраны правят полученные списки на месте (оптимистичный append), а кэш общий.
  return structuredClone(data);
}

/** Сбросить кэш чтения: мутация, выход, 401. */
export function invalidateReadCache(): void {
  requestCache.invalidate();
}

/** Подписка на «фоновое перечитывание принесло другие данные» — экран перерисуется, а не останется на старом. */
export function subscribeDataRevalidated(listener: (path: string) => void): () => void {
  return requestCache.subscribe(listener);
}

// Личность последнего /me: сменилась (другой человек или пространство) — кэш чужих данных долой,
// а экраны оповещаются, чтобы перечитать.
let lastIdentity: string | null = null;
export function noteIdentity(me: { telegram_id?: number; group_id?: string }): void {
  const id = `${me.telegram_id ?? ""}|${me.group_id ?? ""}`;
  if (lastIdentity !== null && lastIdentity !== id) requestCache.invalidate(true);
  lastIdentity = id;
}

/** Выход из аккаунта: забываем и кэш, и личность. */
export function resetIdentity(): void {
  requestCache.invalidate();
  lastIdentity = null;
}
