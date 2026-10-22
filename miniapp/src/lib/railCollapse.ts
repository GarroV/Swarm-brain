// Свёрнутость левого меню (RoyRail) — выбор владельца 22.10.2026: «научим складывать левый
// блок… тонкая полоска по ширине значка». Помнится в localStorage этого браузера; нет
// хранилища — меню развёрнуто. Хранилище внешнее, поэтому читается через useSyncExternalStore.

export const RAIL_COLLAPSED_KEY = "swarm.rail.collapsed";

// Запасное значение в памяти вкладки — когда localStorage недоступен: кнопка всё равно работает.
let fallback = false;

const listeners = new Set<() => void>();

export function readRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
  } catch {
    // Приватный режим может запретить localStorage — тогда меню развёрнуто, пока не нажали кнопку.
    return fallback;
  }
}

export function saveRailCollapsed(collapsed: boolean): void {
  fallback = collapsed;
  try {
    if (collapsed) localStorage.setItem(RAIL_COLLAPSED_KEY, "1");
    else localStorage.removeItem(RAIL_COLLAPSED_KEY);
  } catch {
    // Не запомнится между визитами.
  }
  listeners.forEach((l) => l());
}

export function subscribeRailCollapsed(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (e.key === RAIL_COLLAPSED_KEY) listener(); };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
