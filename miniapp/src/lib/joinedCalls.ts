// «Я уже нажал Подключиться» — память браузера на время слота.
//
// Зачем: серверный флаг `on_call` приходит от рекордера (heartbeat), то есть с задержкой до
// пары минут. Строка панели обязана переключиться на `ON AIR` сразу по нажатию — иначе она
// продолжает звать в звонок, из которого человек только что ушёл в соседнюю вкладку.
// Серверный флаг ГЛАВНЕЕ: он знает про звонок, в который зашли не отсюда (и с телефона).
//
// Хранилище — сессия вкладки: память нужна на часы, а не на дни, и не должна переезжать на
// другое устройство. Все обращения обёрнуты — в приватном окне и при отключённых site data
// доступ к storage бросает исключение, и панель не имеет права из-за этого упасть.

/** Минимум от Storage, который нам нужен — чтобы тесты не тащили DOM. */
export type JoinStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const PREFIX = "swarm.joined.";

function defaultStore(): JoinStore | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;   // приватное окно / site data отключены
  }
}

/** Запомнить нажатие: запись живёт до конца слота встречи. */
export function markJoined(id: string, endsAt: string, store: JoinStore | null = defaultStore()): void {
  try {
    store?.setItem(PREFIX + id, endsAt);
  } catch { /* нет памяти — просто не запомним, панель работает дальше */ }
}

/** Нажимали ли «Подключиться» по этой встрече и не кончился ли её слот. */
export function hasJoined(
  id: string,
  endsAt: string,
  now: Date = new Date(),
  store: JoinStore | null = defaultStore(),
): boolean {
  try {
    const saved = store?.getItem(PREFIX + id);
    if (!saved) return false;
    // Слот кончился → запись бесполезна, убираем сразу: иначе за день их накопится десяток.
    if (Date.parse(saved) <= now.getTime()) {
      store?.removeItem(PREFIX + id);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
