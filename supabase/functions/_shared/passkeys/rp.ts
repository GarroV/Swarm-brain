// Доверенная сторона WebAuthn (relying party) Swarm: какие адреса веба вправе предъявлять ключ.
// Проверка origin СТРОГО по списку: чужой адрес — отказ, а не «лишь бы совпал домен».
// Боевые адреса те же, что в miniapp/src/lib/prodHosts.ts (единственное место списка в вебе, #753);
// edge-функции выкладываются отдельно от веба и не могут импортировать его файл — тест
// `rp.test.ts` держит обе копии равными.

export const RP_NAME = "Swarm Brain";

/** Основной адрес: на нём живёт RP ID боевых ключей (решение #955). */
export const PRIMARY_HOST = "swarm-team.app";

/** Прежний боевой адрес: переадресует на основной и держит старые ссылки. */
export const LEGACY_HOST = "swarm-brain.pages.dev";

/** Превью веток — `<ветка>.swarm-brain.pages.dev`: свой хост, чтобы ключ можно было проверить до раскатки. */
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.swarm-brain\.pages\.dev$/;

/** Вызов живёт 2 минуты и снимается при первом предъявлении. */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

/** Подсказка браузеру для окна: платформенный ключ устройства (Touch ID), а не QR и телефон. */
export const CLIENT_DEVICE_HINTS = ["client-device"] as const;

/** Не больше стольких вызовов на человека за окно — иначе 429 (ограничитель попыток). */
export const MAX_CHALLENGES_PER_WINDOW = 12;
export const THROTTLE_WINDOW_MS = 10 * 60 * 1000;

export type RelyingParty = { rpID: string; origin: string };

/** origin → доверенная сторона; чужой, кривой или не-https адрес — null. */
export function relyingPartyFor(origin: unknown): RelyingParty | null {
  if (typeof origin !== "string") return null;
  const isPrimary = origin === `https://${PRIMARY_HOST}` || origin === `https://${LEGACY_HOST}`;
  if (!isPrimary && !PREVIEW_ORIGIN.test(origin)) return null;
  return { rpID: new URL(origin).hostname, origin };
}
