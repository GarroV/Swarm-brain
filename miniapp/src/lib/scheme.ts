// Цветовая схема оформления — личная настройка (решение владельца 12.11.2026:
// docs/decisions/2026-11-12-color-themes.md). Схема ЛЕЖИТ ПОВЕРХ режима «светлая / тёмная»
// (lib/theme.ts): режим выбирает набор значений схемы, а схема с одним режимом (Сливки, Терминал,
// Блюпринт, Швейцарка) фиксирует свой — тогда выбор режима в меню не действует.
//
// Источник истины — профиль (`user_profiles.ui_scheme`, GET/PATCH /me), копия в localStorage — для
// первой отрисовки: инлайн-скрипт в layout ставит data-scheme на <html> до гидратации (без вспышки
// чужой схемы). «Swarm» — прежняя тема из globals.css, атрибута у неё нет.
//
// Значения схем — app/schemes.css. Список зеркалит UI_SCHEMES в swarm-api/me-fields.ts и блоки
// schemes.css — добавляя схему, правь все три места (сверяет schemes.test.ts).

export type SchemeMode = "light" | "dark";

export interface SchemeOption {
  id: string;
  ru: string;
  en: string;
  /** Короткое имя для плитки меню. */
  tileRu: string;
  tileEn: string;
  /** Какие режимы у схемы есть; один режим — схема фиксирует его. */
  modes: readonly SchemeMode[];
}

const BOTH: readonly SchemeMode[] = ["light", "dark"];

export const SCHEME_OPTIONS = [
  { id: "swarm", ru: "Swarm", en: "Swarm", tileRu: "Swarm", tileEn: "Swarm", modes: BOTH },
  { id: "redakciya", ru: "Редакция", en: "Editorial", tileRu: "Редакция", tileEn: "Editorial", modes: BOTH },
  { id: "nuar", ru: "Нуар", en: "Noir", tileRu: "Нуар", tileEn: "Noir", modes: BOTH },
  { id: "grafit", ru: "Графит · лайм", en: "Graphite · lime", tileRu: "Графит · лайм", tileEn: "Graphite · lime", modes: BOTH },
  { id: "slivki", ru: "Сливки", en: "Cream", tileRu: "Сливки", tileEn: "Cream", modes: ["light"] },
  { id: "kontrast", ru: "Высокий контраст", en: "High contrast", tileRu: "Контраст", tileEn: "Contrast", modes: BOTH },
  { id: "laguna", ru: "Лагуна", en: "Lagoon", tileRu: "Лагуна", tileEn: "Lagoon", modes: BOTH },
  { id: "sumerki", ru: "Сумерки", en: "Dusk", tileRu: "Сумерки", tileEn: "Dusk", modes: BOTH },
  { id: "terminal", ru: "Терминал", en: "Terminal", tileRu: "Терминал", tileEn: "Terminal", modes: ["dark"] },
  { id: "blyuprint", ru: "Блюпринт", en: "Blueprint", tileRu: "Блюпринт", tileEn: "Blueprint", modes: ["dark"] },
  { id: "shveyc", ru: "Швейцарка", en: "Swiss", tileRu: "Швейцарка", tileEn: "Swiss", modes: ["light"] },
] as const satisfies readonly SchemeOption[];

export type SchemeId = (typeof SCHEME_OPTIONS)[number]["id"];
export const SCHEME_IDS = SCHEME_OPTIONS.map((s) => s.id) as readonly SchemeId[];

/** По умолчанию — «Swarm»: у тех, кто ничего не выбирал, интерфейс не меняется. */
export const DEFAULT_SCHEME: SchemeId = "swarm";

export const SCHEME_STORAGE_KEY = "swarm-scheme";
export const SCHEME_CHANGE_EVENT = "swarm-scheme-change";

export function isSchemeId(v: unknown): v is SchemeId {
  return typeof v === "string" && (SCHEME_IDS as readonly string[]).includes(v);
}

/** Значение профиля → схема; null/незнакомое — по умолчанию. */
export function resolveScheme(v: unknown): SchemeId {
  return isSchemeId(v) ? v : DEFAULT_SCHEME;
}

export function schemeOption(id: SchemeId): SchemeOption {
  return SCHEME_OPTIONS.find((s) => s.id === id) ?? SCHEME_OPTIONS[0];
}

/** Режим, который схема навязывает (у неё один режим), либо null — выбирает человек. */
export function forcedMode(id: SchemeId): SchemeMode | null {
  const m = schemeOption(id).modes;
  return m.length === 1 ? m[0] : null;
}

export function readCachedScheme(): SchemeId {
  try {
    return resolveScheme(localStorage.getItem(SCHEME_STORAGE_KEY));
  } catch {
    return DEFAULT_SCHEME; // приватное окно / заблокированное хранилище
  }
}

/**
 * Инлайн-скрипт для <body>: схема из кэша и класс `.dark` до первой отрисовки. Заменяет прежний
 * скрипт одной темы: класс зависит от схемы (схема с одним режимом его навязывает). Без выбора —
 * режим как в системе (prefers-color-scheme), смена темы ОС ловится вживую.
 */
export function schemeThemeScript(themeKey: string): string {
  const forced: Record<string, string> = {};
  for (const s of SCHEME_OPTIONS) forced[s.id] = (forcedMode(s.id) ?? "");
  return `!function(){try{var m=matchMedia("(prefers-color-scheme: dark)"),F=${JSON.stringify(forced)},` +
    `a=function(){var t=null,s=null,d=document.documentElement;` +
    `try{t=localStorage.getItem(${JSON.stringify(themeKey)});s=localStorage.getItem(${JSON.stringify(SCHEME_STORAGE_KEY)})}catch(e){}` +
    `if(!F.hasOwnProperty(s))s=${JSON.stringify(DEFAULT_SCHEME)};` +
    `if(s===${JSON.stringify(DEFAULT_SCHEME)})delete d.dataset.scheme;else d.dataset.scheme=s;` +
    `d.classList.toggle("dark",F[s]?F[s]==="dark":(t==="dark"||(t!=="light"&&m.matches)))};` +
    `a();m.addEventListener("change",a)}catch(e){}}()`;
}
