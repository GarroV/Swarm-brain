// Состояние связи с сервером — одно на вкладку (issue #467).
//
// Обрыв сети (нет интернета, домен режется провайдером, лёг прокси) раньше выглядел как пять
// одинаковых «Не загрузилось» по виджетам: человек читал это как «продукт сломался, данные
// пропали». Теперь api.ts сообщает сюда, дошёл ли запрос до сервера, а экран показывает ОДНУ
// честную плашку «нет связи». Любой ответ сервера — даже ошибка — значит, что связь есть.
//
// Шина устроена как у заморозки (lib/maintenance.ts): состояние в памяти + подписчики.

/** Что случилось с запросом: дошёл до сервера (любой статус) или оборвался по дороге. */
export type ConnectionEvent = "response" | "network_error";

export type ConnectionState = {
  offline: boolean;
  /** Когда связь пропала (ms epoch); null — связь есть. */
  since: number | null;
};

export const ONLINE: ConnectionState = { offline: false, since: null };

/** Следующее состояние. Повторный обрыв не сдвигает «с какого времени нет связи». */
export function nextConnection(
  prev: ConnectionState,
  event: ConnectionEvent,
  now: number,
): ConnectionState {
  if (event === "response") return prev.offline ? ONLINE : prev;
  return prev.offline ? prev : { offline: true, since: now };
}

/**
 * Обрыв ли это, а не ответ сервера. `fetch` отвергается TypeError, когда запрос не дошёл.
 * Отмена запроса самим экраном — DOMException «AbortError», не TypeError, и обрывом не считается.
 */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError;
}

let current: ConnectionState = ONLINE;
const listeners = new Set<(s: ConnectionState) => void>();

export function lastConnection(): ConnectionState {
  return current;
}

export function reportConnection(event: ConnectionEvent, now: number = Date.now()): void {
  const next = nextConnection(current, event, now);
  if (next === current) return;
  current = next;
  listeners.forEach((fn) => fn(next));
}

export function subscribeConnection(fn: (s: ConnectionState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── Сессия протухла посреди работы ───────────────────────────────────────────
// 401 от любого виджета, а не только от первого fetchMe, должен уводить на вход:
// иначе каждый виджет пишет «Не загрузилось», и человек не понимает, что надо войти заново.

const unauthorizedListeners = new Set<() => void>();

export function reportUnauthorized(): void {
  unauthorizedListeners.forEach((fn) => fn());
}

export function subscribeUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}
