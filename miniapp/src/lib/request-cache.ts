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
// TTL ЗАВЕДОМО меньше самого частого поллинга (10 с — AGENT_POLL_MS и обновление очереди
// вычитки): иначе кэш проглотил бы опрос и очередь замерла бы на экране. Кэш живёт только
// в памяти вкладки и умирает с ней — HTTP-кэш и Cache Storage тут не задействованы, так
// что запрет кэширования приватных ответов (cache: "no-store", sw.js, issue #71) в силе.
export const REQUEST_CACHE_TTL_MS = 2500;

type Entry = { value: Promise<unknown>; settledAt: number | null };

export function createRequestCache({ ttlMs, now = () => Date.now() }: { ttlMs: number; now?: () => number }) {
  const entries = new Map<string, Entry>();

  return {
    /** Отдаёт ответ из кэша/полёта либо запускает fetcher. Ошибка не кэшируется. */
    run<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      // settledAt === null — запрос ещё в полёте, присоединяемся к нему.
      if (hit && (hit.settledAt === null || now() - hit.settledAt < ttlMs)) {
        return hit.value as Promise<T>;
      }
      const entry: Entry = { value: undefined as unknown as Promise<unknown>, settledAt: null };
      const p = fetcher().then(
        (v) => { entry.settledAt = now(); return v; },
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
    invalidate(): void {
      entries.clear();
    },
  };
}
