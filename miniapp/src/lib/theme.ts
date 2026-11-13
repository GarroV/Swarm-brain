// Тема интерфейса: «как в системе» (по умолчанию), светлая или тёмная. Выбор — per-устройство,
// в localStorage (решение владельца 2026-09-25: «переключение темы надо дать, над настройками слева
// снизу»). Первую отрисовку делает инлайн-скрипт schemeThemeScript (lib/scheme.ts) в app/layout.tsx — он читает тот же
// ключ, поэтому тема не мигает при загрузке. Здесь — выбор из рейки и живое применение.
// Поверх режима лежит цветовая схема (lib/scheme.ts): схема с одним режимом навязывает его.

import { forcedMode, readCachedScheme, resolveScheme, SCHEME_CHANGE_EVENT, SCHEME_STORAGE_KEY, type SchemeId } from "./scheme";

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

/** Тёмный ли интерфейс при выбранном режиме и схеме: схема с одним режимом перебивает выбор. */
export function isDarkFor(theme: ThemeId, scheme: SchemeId): boolean {
  const forced = forcedMode(scheme);
  if (forced) return forced === "dark";
  return theme === "dark" || (theme === "system" && systemIsDark());
}

/**
 * Цвет шапки браузера / строки состояния PWA (<meta name="theme-color">). Статические значения в
 * layout.tsx — это «Swarm»; у цветной схемы подставляем её фон. Полупрозрачный фон (своя картинка
 * в качестве задника) в мету не годится — тогда остаётся прежний цвет.
 */
export function syncBrowserChrome(): void {
  const root = document.documentElement;
  const bg = getComputedStyle(root).getPropertyValue("--background").trim();
  const useScheme = root.dataset.scheme !== undefined && bg !== "" && !bg.includes("/");
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.dataset.swarmOrig ??= m.content;
    m.content = useScheme ? bg : m.dataset.swarmOrig;
  });
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.classList.toggle("dark", isDarkFor(theme, readCachedScheme()));
  syncBrowserChrome();
}

/** Применить схему в этой вкладке: атрибут на <html>, кэш, класс `.dark` и событие для меню. */
export function applyScheme(scheme: SchemeId): void {
  const root = document.documentElement;
  if (scheme === "swarm") delete root.dataset.scheme;
  else root.dataset.scheme = scheme;
  try {
    if (scheme === "swarm") localStorage.removeItem(SCHEME_STORAGE_KEY);
    else localStorage.setItem(SCHEME_STORAGE_KEY, scheme);
  } catch {
    // без кэша схема всё равно применена; с сервера она придёт при следующем входе
  }
  applyTheme(readTheme());
  window.dispatchEvent(new CustomEvent<SchemeId>(SCHEME_CHANGE_EVENT, { detail: resolveScheme(scheme) }));
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
