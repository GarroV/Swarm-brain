// Псевдонимы полоски присутствия: кому в этом окне какой зверь и какой неоновый стиль.
// Решения владельца — docs/decisions/2026-10-07-presence-avatars.md.
//
// Раздача идёт по ВСЕМ участникам пространства, а не по тем, кто сейчас онлайн: тогда зверь
// не «прыгает», когда кто-то заходит или уходит, и у двух людей до 50 человек не бывает одного
// зверя. Сами картинки и имена живут в вебе (miniapp/src/components/presence/animals.ts) —
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

/** FNV-1a по кодовым точкам — тот же хеш, что в утверждённом макете. */
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

/** Перестановка 0..ANIMAL_COUNT-1, перемешанная сидом от окна (Фишер — Йетс). */
function animalPermutation(window: number): number[] {
  const rand = rng(hash(`w${window}`));
  const order = Array.from({ length: ANIMAL_COUNT }, (_, i) => i);
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  return order;
}

/**
 * Зверь и стиль каждому участнику на окно. Участников сортируем по хешу (id, окно), k-му
 * достаётся perm[k]: повторов нет, пока людей не больше ANIMAL_COUNT. Результат не зависит
 * от порядка входного массива.
 */
export function assignPseudonyms(memberIds: readonly number[], window: number): Map<number, Pseudonym> {
  const perm = animalPermutation(window);
  const ranked = [...new Set(memberIds)]
    .map((id) => ({ id, rank: hash(`${id}:${window}`) }))
    .sort((a, b) => a.rank - b.rank || a.id - b.id);
  const out = new Map<number, Pseudonym>();
  ranked.forEach(({ id }, k) => {
    out.set(id, { animal: perm[k % ANIMAL_COUNT], style: hash(`${id}:${window}:s`) % STYLE_COUNT });
  });
  return out;
}
