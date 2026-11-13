// Дедупликация GET-запросов веба. Без зависимостей — чтобы тест гонялся на Deno тем же
// раннером, что sw.test.ts и edge-функции:  deno test miniapp/src/lib/request-cache.test.ts
//
// Зачем: общего слоя данных у экрана нет — каждый компонент грузит своё в useEffect, и одна
// и та же ручка дёргается по 2–8 раз за открытие (issue #103). На одном открытии дашборда
// это 13 запросов, из которых /meetings, /tasks, /projects и /notifications — дубли:
// useDashboardData и SearchScreen монтируются одновременно и просят одно и то же, а
// NotificationsBell вообще рендерится в пяти местах, каждое со своим fetch на маунте.
//
// Два механизма:
//   1) склейка «в полёте» — одновременные одинаковые GET-ы делят один сетевой запрос;
//   2) короткий TTL — повтор сразу после ответа берётся из памяти (гасит шторм маунтов
//      при переходе между экранами).
//
// Третий механизм — stale-while-revalidate для тяжёлых «справочных» чтений (issue #492, `swr` в run):
//   3) свежее окно `freshMs` — ответ из памяти без сети; дальше до `maxStaleMs` — устаревший ответ
//      отдаётся СРАЗУ, а в фоне идёт перечитывание; если данные изменились, подписчики
//      (`subscribe`) узнают, чтобы экран перерисовался, а не остался на старом молча. Старше
//      `maxStaleMs` — обычный запрос с ожиданием. Любая мутация, выход и смена личности
//      (`invalidate`) выбрасывают всё, включая перечитывание, которое ещё в полёте.
//
// TTL ЗАВЕДОМО меньше самого частого поллинга (10 с — AGENT_POLL_MS и обновление очереди
// вычитки): иначе кэш проглотил бы опрос и очередь замерла бы на экране. Кэш живёт только
// в памяти вкладки и умирает с ней — HTTP-кэш и Cache Storage тут не задействованы, так
// что запрет кэширования приватных ответов (cache: "no-store", sw.js, issue #71) в силе.
export const REQUEST_CACHE_TTL_MS = 2500;
// Окна для stale-while-revalidate (#492). 20 с — ровно столько, чтобы возврат в раздел за пару
// переходов не стоил сети; дальше старое показывается сразу, но перечитывается. 10 минут — потолок,
// после него устаревшее уже не отдаётся вовсе.
export const SWR_FRESH_MS = 20_000;
export const SWR_MAX_STALE_MS = 10 * 60_000;

type Entry = { value: Promise<unknown>; settledAt: number | null; data?: unknown };

export type SwrPolicy = { freshMs: number; maxStaleMs: number };
type Listener = (key: string) => void;

export function createRequestCache({ ttlMs, now = () => Date.now() }: { ttlMs: number; now?: () => number }) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<Listener>();
  // Номер «эпохи»: invalidate его двигает, и перечитывание, начатое в прошлой эпохе, свой
  // (уже устаревший) ответ в кэш не кладёт.
  let epoch = 0;

  function revalidate<T>(key: string, fetcher: () => Promise<T>, old: Entry): void {
    const started = epoch;
    // Запись «в полёте»: повторные заходы не плодят запросы, пока идёт перечитывание.
    entries.set(key, { ...old, settledAt: null });
    fetcher().then(
      (v) => {
        if (epoch !== started) return;
        const changed = JSON.stringify(v) !== JSON.stringify(old.data);
        entries.set(key, { value: Promise.resolve(v), settledAt: now(), data: v });
        if (changed) listeners.forEach((l) => l(key));
      },
      (e) => {
        if (epoch !== started) return;
        // Фоновая ошибка не роняет экран и не прячется: запись остаётся устаревшей, следующий
        // заход попробует снова, а когда она перешагнёт maxStaleMs — запрос пойдёт с ожиданием
        // и покажет ошибку как обычно.
        entries.set(key, old);
        console.warn("[request-cache] фоновое обновление не удалось", key, e);
      },
    );
  }

  return {
    /** Отдаёт ответ из кэша/полёта либо запускает fetcher. Ошибка не кэшируется. */
    run<T>(key: string, fetcher: () => Promise<T>, swr?: SwrPolicy): Promise<T> {
      const hit = entries.get(key);
      if (swr && hit && hit.data !== undefined && hit.settledAt !== null) {
        const age = now() - hit.settledAt;
        if (age < swr.freshMs) return hit.value as Promise<T>;
        if (age < swr.maxStaleMs) {
          revalidate(key, fetcher, hit);
          return hit.value as Promise<T>;
        }
      }
      // settledAt === null — запрос ещё в полёте (или идёт фоновое перечитывание, у записи
      // тогда уже есть данные): присоединяемся.
      if (hit && (hit.settledAt === null || now() - hit.settledAt < ttlMs)) {
        return hit.value as Promise<T>;
      }
      const entry: Entry = { value: undefined as unknown as Promise<unknown>, settledAt: null };
      const p = fetcher().then(
        (v) => { entry.settledAt = now(); if (swr) entry.data = v; return v; },
        (e) => {
          // Провал не кэшируем: следующий вызов должен пойти в сеть, а не переполучить ошибку.
          // Снимаем только СВОЮ запись — invalidate мог уже поставить на этот ключ новую.
          if (entries.get(key) === entry) entries.delete(key);
          throw e;
        },
      );
      entry.value = p;
      entries.set(key, entry);
      return p;
    },

    /** Сбрасывает всё: после мутации данные обязаны перечитаться, а не прийти из памяти. */
    invalidate(notify = false): void {
      epoch++;
      entries.clear();
      // notify: данные на экранах уже могли быть чужими (сменилась личность) — пусть перечитаются.
      if (notify) listeners.forEach((l) => l("*"));
    },

    /** Подписка на «фоновое перечитывание принесло другие данные»; возвращает отписку. */
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
