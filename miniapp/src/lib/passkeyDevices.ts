// «Добавить устройство» для ключей входа (решение владельца 17.10.2026,
// docs/decisions/2026-10-17-passkey-add-device.md), чистая логика без браузерных API.
// Устройство, где вход подтверждён ключом, выдаёт одноразовую ссылку `/add-device#t=<токен>` и QR;
// телефон открывает её под своей сессией и заводит свой ключ (Face ID). Токен — во фрагменте `#`:
// фрагмент не уходит на сервер и в Referer. Пока человек входит, токен ждёт в localStorage.

export const ADD_DEVICE_PATH = "/add-device";
/** Токен ждёт входа не дольше, чем живёт ссылка на сервере. */
export const PENDING_TTL_MS = 10 * 60 * 1000;
export const PENDING_KEY = "swarm.passkey.addDevice";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Адрес, который показывают ссылкой и QR. */
export function deviceLinkUrl(origin: string, token: string): string {
  return `${origin}${ADD_DEVICE_PATH}#t=${token}`;
}

/** Токен из `#t=…`; мусор и отсутствие — null. */
export function tokenFromHash(hash: string): string | null {
  const t = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  return t && TOKEN_RE.test(t) ? t : null;
}

/** Запись для localStorage: токен и до какого момента он годен. */
export function encodePending(token: string, nowMs: number): string {
  return JSON.stringify({ t: token, exp: nowMs + PENDING_TTL_MS });
}

/** Сохранённый токен, если он ещё годен; иначе null. */
export function readPending(raw: string | null, nowMs: number): string | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { t?: unknown; exp?: unknown };
    if (typeof p.t !== "string" || !TOKEN_RE.test(p.t) || typeof p.exp !== "number" || p.exp <= nowMs) return null;
    return p.t;
  } catch {
    return null;
  }
}

/** Что показать после неудачной попытки сохранить ключ на телефоне. */
export type EnrollFailure = "invalid" | "exists" | "cancelled" | "failed";

/**
 * Ответ сервера на запрос вызова: 410 — ссылка истекла, использована или выдана другому человеку.
 * Ошибка окна устройства: InvalidStateError — ключ этого человека на устройстве уже есть
 * (сработал excludeCredentials); NotAllowedError — окно закрыли или отказали, ссылка цела.
 */
export function enrollFailure(where: "options" | "device" | "verify", status: number, errorName?: string): EnrollFailure {
  if (where === "options") return status === 410 ? "invalid" : "failed";
  if (where === "device") return errorName === "InvalidStateError" ? "exists" : "cancelled";
  // Приём гасит ссылку до разбора ответа: повторить ей нельзя.
  return "invalid";
}

/** «12 окт. 2026» — короткая дата для списка ключей. */
export function keyDate(iso: string | null, lang: "ru" | "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
}
