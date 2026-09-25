// Тема интерфейса: «как в системе» (по умолчанию), светлая или тёмная. Выбор — per-устройство,
// в localStorage (решение владельца 2026-09-25: «переключение темы надо дать, над настройками слева
// снизу»). Первую отрисовку делает инлайн-скрипт THEME_SCRIPT в app/layout.tsx — он читает тот же
// ключ, поэтому тема не мигает при загрузке. Здесь — выбор из рейки и живое применение.

export const THEME_IDS = ["system", "light", "dark"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const THEME_STORAGE_KEY = "swarm-theme";
export const THEME_CHANGE_EVENT = "swarm-theme-change";

export function readTheme(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    // Приватный режим может запретить localStorage — тогда просто следуем системе.
    return "system";
  }
}

export function systemIsDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: ThemeId): void {
  const dark = theme === "dark" || (theme === "system" && systemIsDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function saveTheme(theme: ThemeId): void {
  try {
    if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Не запомнится между визитами, но в этой вкладке тема сменится.
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
