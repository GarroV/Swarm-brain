// PATCH /me: разбор и проверка присланных полей профиля. Отдельный модуль: проверка входа
// тестируется без поднятия всего swarm-api. Пишутся только присланные поля.
import { normalizeCountries } from "../_shared/countries.ts";

// Задники веба (PATCH /me ui_backdrop). Зеркало `miniapp/src/lib/backdrop.ts` — добавляя вариант,
// правь оба места; null = «по умолчанию».
// "custom" — своя картинка; сама картинка живёт в IndexedDB браузера, на сервер не уходит.
export const UI_BACKDROPS: readonly string[] = [
  "galaxy",
  "none",
  "dots",
  "aurora",
  "custom",
];

// Цветовые схемы оформления (PATCH /me ui_scheme, решение 12.11.2026). Зеркало SCHEME_OPTIONS в
// `miniapp/src/lib/scheme.ts` и блоков `miniapp/src/app/schemes.css` — добавляя схему, правь все три
// места (сверяет miniapp/src/lib/schemes.test.ts); null = «по умолчанию» (swarm).
export const UI_SCHEMES: readonly string[] = [
  "swarm",
  "redakciya",
  "nuar",
  "grafit",
  "slivki",
  "kontrast",
  "laguna",
  "sumerki",
  "terminal",
  "blyuprint",
  "shveyc",
];

export type MePatch = { fields: Record<string, unknown> } | { error: string };

export function parseMePatch(body: Record<string, unknown>): MePatch {
  const fields: Record<string, unknown> = {};
  if ("role" in body) fields.role = body.role ?? null;
  if ("markets" in body && Array.isArray(body.markets)) {
    fields.markets = normalizeCountries(body.markets as string[]);
  }
  if ("ui_backdrop" in body) {
    const b = body.ui_backdrop;
    if (b !== null && !UI_BACKDROPS.includes(b as string)) return { error: "Unknown ui_backdrop" };
    fields.ui_backdrop = b;
  }
  if ("ui_scheme" in body) {
    const sc = body.ui_scheme;
    if (sc !== null && !UI_SCHEMES.includes(sc as string)) return { error: "Unknown ui_scheme" };
    fields.ui_scheme = sc;
  }
  // Авто-старт записи рекордером по календарю (#219). Только boolean: строка «false» или 0
  // молча включили бы запись встреч, поэтому всё иное — 400.
  if ("recorder_auto_start" in body) {
    if (typeof body.recorder_auto_start !== "boolean") return { error: "recorder_auto_start must be boolean" };
    fields.recorder_auto_start = body.recorder_auto_start;
  }
  return { fields };
}

/** Личные настройки вида из строки профиля для ответа GET /me (NULL = по умолчанию). */
export function meUiPrefs(p: { ui_backdrop?: string | null; ui_scheme?: string | null } | null | undefined) {
  return { ui_backdrop: p?.ui_backdrop ?? null, ui_scheme: p?.ui_scheme ?? null };
}
