// Задник интерфейса — личная настройка пользователя (решение владельца 24.09.2026,
// docs/decisions/2026-09-24-backdrop.md).
//
// Источник истины — профиль на сервере (`user_profiles.ui_backdrop`, GET/PATCH /me), чтобы выбор
// ехал между устройствами. Копия в localStorage нужна для первой отрисовки: инлайн-скрипт в layout
// ставит `data-backdrop` на <html> до гидратации, и фон не мигает.
//
// Список вариантов зеркалит `UI_BACKDROPS` в swarm-api/index.ts — добавляя вариант, правь оба.

export const BACKDROP_IDS = ["galaxy", "none", "dots", "aurora", "custom"] as const;
export type BackdropId = (typeof BACKDROP_IDS)[number];

/** По умолчанию — галактика: так было в проде, и владелец решил её оставить. */
export const DEFAULT_BACKDROP: BackdropId = "galaxy";

export const BACKDROP_STORAGE_KEY = "swarm-backdrop";
export const BACKDROP_CHANGE_EVENT = "swarm-backdrop-change";
/** Своя картинка или её затемнение/размытие поменялись — слой перечитывает IndexedDB. */
export const CUSTOM_BACKDROP_EVENT = "swarm-backdrop-custom-change";

export interface BackdropOption {
  id: BackdropId;
  ru: string;
  en: string;
  hintRu: string;
  hintEn: string;
}

export const BACKDROP_OPTIONS: readonly BackdropOption[] = [
  { id: "galaxy", ru: "Галактика", en: "Galaxy", hintRu: "В тёмной теме; в светлой — чистый фон", hintEn: "Dark theme; plain in light" },
  { id: "none", ru: "Без фона", en: "None", hintRu: "Чистый цвет темы", hintEn: "Plain background" },
  { id: "dots", ru: "Точки", en: "Dots", hintRu: "Тихая сетка точек", hintEn: "Quiet dot grid" },
  { id: "aurora", ru: "Сияние", en: "Aurora", hintRu: "Мягкий цветной свет по краям", hintEn: "Soft colour glow at the edges" },
  { id: "custom", ru: "Своя картинка", en: "Your image", hintRu: "Любое фото — хранится в этом браузере", hintEn: "Any photo — kept in this browser" },
];

/** Сообщить слою фона, что своя картинка/её настройки сохранены. */
export function notifyCustomBackdropChanged(): void {
  window.dispatchEvent(new Event(CUSTOM_BACKDROP_EVENT));
}

export function isBackdropId(v: unknown): v is BackdropId {
  return typeof v === "string" && (BACKDROP_IDS as readonly string[]).includes(v);
}

/** Значение профиля → задник; null/незнакомое — по умолчанию. */
export function resolveBackdrop(v: unknown): BackdropId {
  return isBackdropId(v) ? v : DEFAULT_BACKDROP;
}

export function readCachedBackdrop(): BackdropId {
  try {
    return resolveBackdrop(localStorage.getItem(BACKDROP_STORAGE_KEY));
  } catch {
    return DEFAULT_BACKDROP; // приватное окно / заблокированное хранилище
  }
}

/** Применить задник в этой вкладке: атрибут на <html>, кэш и событие для слоя фона. */
export function applyBackdrop(id: BackdropId): void {
  document.documentElement.dataset.backdrop = id;
  try {
    localStorage.setItem(BACKDROP_STORAGE_KEY, id);
  } catch {
    // без кэша выбор всё равно применён; с сервера он придёт при следующем входе
  }
  window.dispatchEvent(new CustomEvent<BackdropId>(BACKDROP_CHANGE_EVENT, { detail: id }));
}

/** Инлайн-скрипт для <head>/<body>: ставит data-backdrop из кэша до первой отрисовки. */
export const BACKDROP_SCRIPT = `!function(){try{var v=localStorage.getItem(${JSON.stringify(BACKDROP_STORAGE_KEY)});document.documentElement.dataset.backdrop=${JSON.stringify(BACKDROP_IDS)}.indexOf(v)>=0?v:${JSON.stringify(DEFAULT_BACKDROP)}}catch(e){document.documentElement.dataset.backdrop=${JSON.stringify(DEFAULT_BACKDROP)}}}()`;
