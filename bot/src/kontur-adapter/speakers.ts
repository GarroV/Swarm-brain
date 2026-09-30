/**
 * Кто говорит и сколько людей в звонке Толка — по снимку страницы.
 *
 * Сигнал говорящего — класс `active-speaker` на плитке `conference-participant` (живой звонок
 * владельца, 30.09.2026). Толк снимает его не сразу: с одним говорящим класс держится и в паузах.
 * Это нормально — таймлайн тогда показывает одну длинную реплику, а не выдумывает смену
 * говорящих. Плиток нет — сигнала нет (`null`), имя наугад не подставляется. Формат наружу тот
 * же, что у Meet (`meet-adapter/speakers.ts`, D034): имя говорящего или `null`.
 */
import type { KonturSnapshot } from "./types.ts";

/**
Пометки Толка рядом с именем: частью имени они не являются.
*/
const NAME_SUFFIX = /\((?:вы|you|организатор|host)\)$/iu;

function normalizeKonturName(raw: string | null): string | null {
  if (raw === null) return null;
  const name = raw.replaceAll(/\s+/gu, " ").trim().replace(NAME_SUFFIX, "").trim();
  return name === "" ? null : name;
}

/**
 * Имя говорящего или `null`. Своя плитка исключается: бот молчит, и назвать его говорящим
 * значило бы подписать его именем чужую реплику.
 */
export function pickKonturSpeaker(snapshot: KonturSnapshot, selfName?: string): string | null {
  const own = normalizeKonturName(selfName ?? null)?.toLowerCase() ?? null;
  for (const tile of snapshot.tiles) {
    if (!tile.speaking) continue;
    const name = normalizeKonturName(tile.name);
    if (name === null) continue;
    if (own !== null && name.toLowerCase() === own) continue;
    return name;
  }
  return null;
}

/**
 * Сколько людей в звонке. Число на кнопке «Участники» точнее плиток: плиток на экране может быть
 * меньше, чем людей. `null` — посчитать не по чему.
 */
export function countKonturParticipants(snapshot: KonturSnapshot): number | null {
  if (snapshot.participantCount !== null) return snapshot.participantCount;
  if (snapshot.tiles.length === 0) return null;
  return snapshot.tiles.length;
}

/**
 * Бот в звонке один? `null` — сигнала нет: уйти по ошибке значит потерять запись живой встречи,
 * поэтому неизвестность одиночеством не считается. Правило выхода — общее с Meet (`alone.ts`).
 */
export function isAloneKonturSnapshot(snapshot: KonturSnapshot): boolean | null {
  const count = countKonturParticipants(snapshot);
  if (count === null) return null;
  return count <= 1;
}
