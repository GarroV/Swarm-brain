/**
 * Кто говорит и сколько людей в звонке — по снимку страницы.
 *
 * Сигнал говорящего берётся из СЕМАНТИЧЕСКОГО атрибута `data-audio-level`, а не из
 * обфусцированных классов Meet (`Oaajhc` и родня): классы меняются вместе с релизом
 * интерфейса и делают это молча. У Vexa (Apache-2.0) на классах построено именно это место,
 * и в их же коде записано, чем оно кончилось — «самообучение» класса привязало всю встречу
 * к одному имени. Поэтому здесь правило жёсткое: нет семантического сигнала —
 * `activeSpeaker` возвращает `null`, а адаптер об этом ГРОМКО сообщает. Таймлайн тогда
 * деградирует мягко (сервер без поля `speakers` ведёт себя ровно как раньше), но мы знаем,
 * что он деградировал, а не думаем, что все молчали.
 */
import type { MeetSnapshot } from "./types.ts";

/** Пометки Meet рядом с именем: частью имени они не являются. */
const NAME_SUFFIXES = [/\s*\(you\)$/iu, /\s*\(presenting\)$/iu, /\s*\(host\)$/iu];

export function normalizeParticipantName(raw: string | null): string | null {
  if (raw === null) return null;
  let name = raw.replaceAll(/\s+/gu, " ").trim();
  for (const suffix of NAME_SUFFIXES) {
    name = name.replace(suffix, "");
  }
  name = name.trim();
  return name === "" ? null : name;
}

/** Есть ли на странице сам сигнал громкости (а не тишина). */
export function hasSpeakerSignal(snapshot: MeetSnapshot): boolean {
  return snapshot.tiles.some((tile) => tile.audioLevel !== null);
}

/**
 * Имя говорящего или `null`. Своя плитка исключается всегда: бот молчит, и назвать его
 * говорящим значило бы подписать его именем чужую реплику.
 */
export function pickActiveSpeaker(snapshot: MeetSnapshot, selfName?: string): string | null {
  const own = normalizeParticipantName(selfName ?? null);
  let best: { name: string; level: number } | null = null;

  for (const tile of snapshot.tiles) {
    if (tile.self) continue;
    const level = tile.audioLevel;
    if (level === null || level <= 0) continue;

    const name = normalizeParticipantName(tile.name);
    if (name === null) continue;
    if (own !== null && name.toLowerCase() === own.toLowerCase()) continue;

    if (best === null || level > best.level) {
      best = { name, level };
    }
  }

  return best?.name ?? null;
}

/**
 * Сколько людей в звонке. Панель участников точнее плиток: в галерее Meet показывает
 * не всех. `null` — посчитать не по чему.
 */
export function countParticipants(snapshot: MeetSnapshot): number | null {
  if (snapshot.panelParticipantCount !== null) return snapshot.panelParticipantCount;
  if (snapshot.tiles.length === 0) return null;
  return new Set(snapshot.tiles.map((tile) => tile.id)).size;
}

/**
 * Бот в звонке один? `null` значит «сигнала нет» — и это отдельный исход: уйти по ошибке
 * значит потерять запись живой встречи, поэтому неизвестность одиночеством не считается.
 */
export function isAloneSnapshot(snapshot: MeetSnapshot): boolean | null {
  const count = countParticipants(snapshot);
  if (count === null) return null;
  return count <= 1;
}
