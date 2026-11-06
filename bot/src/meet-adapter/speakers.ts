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

/**
Пометки Meet рядом с именем: частью имени они не являются.
*/
const NAME_SUFFIX = /\((?:you|presenting|host)\)$/iu;

// Имена из #872 и стандартные формы поставщиков (ссылки в docs/QUICK_REF.md).
// Бренд внутри имени человека сам по себе не признак бота.
const RECORDER_NAMES = new Set([
  "tl;dv",
  "tl;dv ai notetaker",
  "read.ai",
  "read.ai meeting notes",
  "meeting analytics from read",
  "fireflies",
  "fireflies.ai notetaker",
  "otter",
]);
const OTTER_NOTETAKER = /^.+['’]s (?:AI )?Notetaker \(Otter\.ai\)$/iu;

export function normalizeParticipantName(raw: string | null): string | null {
  if (raw === null) return null;
  const name = raw.replaceAll(/\s+/gu, " ").trim().replace(NAME_SUFFIX, "").trim();
  return name === "" ? null : name;
}

/**
Есть ли на странице сам сигнал громкости (а не тишина).
*/
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
  // В галерее видны не все: из полного числа панели вычитаем только доказанных рекордеров.
  // Одна и та же плитка (в том числе показ экрана) не должна вычесть скрытого человека.
  const recorders = new Set(
    snapshot.tiles
      .filter((tile) => {
        if (tile.self) return false;
        const name = normalizeParticipantName(tile.name);
        return (
          name !== null && (RECORDER_NAMES.has(name.toLowerCase()) || OTTER_NOTETAKER.test(name))
        );
      })
      .map((tile) => tile.id),
  );
  const visibleCount = new Set(snapshot.tiles.map((tile) => tile.id)).size;
  return Math.max(count, visibleCount) - recorders.size <= 1;
}
