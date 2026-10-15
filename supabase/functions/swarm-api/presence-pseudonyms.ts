// Псевдонимы полоски присутствия: кому в этом окне какой зверь и какой неоновый стиль.
// Решения владельца — docs/decisions/2026-10-07-presence-avatars.md.
//
// Раздача идёт по ВСЕМ участникам пространства, а не по тем, кто сейчас онлайн: тогда зверь
// не «прыгает», когда кто-то заходит или уходит, и у двух людей до 50 человек не бывает одного
// зверя. Раздача зависит от серверного ключа (HMAC): по одному telegram_id и номеру окна, которые
// не секрет, вычислить, кто есть какой зверь, нельзя. Сами картинки и имена живут в вебе (miniapp/src/components/presence/animals.ts) —
// сервер отдаёт только индексы.

/** Сколько зверей в наборе (веб держит столько же иконок и имён). */
export const ANIMAL_COUNT = 50;
/** Сколько неоновых стилей (веб: components/presence/neonStyles.ts). */
export const STYLE_COUNT = 5;
/** Зверь закрепляется за человеком на окно в 4 часа. */
export const PSEUDONYM_WINDOW_MS = 4 * 60 * 60 * 1000;

export type Pseudonym = { animal: number; style: number };

/** Номер окна: floor(epoch_ms / 4 ч). */
export function pseudonymWindow(nowMs: number): number {
  return Math.floor(nowMs / PSEUDONYM_WINDOW_MS);
}

const encoder = new TextEncoder();

/** Метка вывода ключа: смена версии перетасует всех, не трогая исходный секрет. */
const KEY_LABEL = "presence-pseudonym-v1";

/**
 * Ключ раздачи выводится из уже существующего серверного секрета (WEB_JWT_SECRET) с меткой
 * назначения, а не берётся как есть: новый секрет заводить не нужно, а сам секрет в раздачу
 * напрямую не попадает. Секрет не логируется и наружу не выходит.
 */
export async function derivePseudonymKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("presence: пустой секрет для псевдонимов");
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode(KEY_LABEL));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/** HMAC-SHA256(ключ, сообщение) → первые 4 байта как uint32. */
async function mac32(key: CryptoKey, message: string): Promise<number> {
  const sig = new DataView(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return sig.getUint32(0);
}

/** Детерминированный PRNG (mulberry32) — равномерное число в [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Перестановка 0..ANIMAL_COUNT-1, перемешанная сидом от окна и ключа (Фишер — Йетс). */
async function animalPermutation(key: CryptoKey, window: number): Promise<number[]> {
  const rand = rng(await mac32(key, `w:${window}`));
  const order = Array.from({ length: ANIMAL_COUNT }, (_, i) => i);
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  return order;
}

/**
 * Зверь и стиль каждому участнику на окно. Участников сортируем по HMAC(id, окно), k-му
 * достаётся perm[k]: повторов нет, пока людей не больше ANIMAL_COUNT. Результат не зависит
 * от порядка входного массива; другой ключ даёт другую раздачу.
 */
export async function assignPseudonyms(
  memberIds: readonly number[],
  window: number,
  key: CryptoKey,
): Promise<Map<number, Pseudonym>> {
  const perm = await animalPermutation(key, window);
  const unique = [...new Set(memberIds)];
  const ranked = await Promise.all(
    unique.map(async (id) => ({
      id,
      rank: await mac32(key, `${id}:${window}`),
      style: await mac32(key, `${id}:${window}:s`),
    })),
  );
  ranked.sort((a, b) => a.rank - b.rank || a.id - b.id);
  const out = new Map<number, Pseudonym>();
  ranked.forEach(({ id, style }, k) => {
    out.set(id, { animal: perm[k % ANIMAL_COUNT], style: style % STYLE_COUNT });
  });
  return out;
}
