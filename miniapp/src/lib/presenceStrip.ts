// Полоска присутствия «кто сейчас в SWARM» — чистая логика: разбор ответа, порядок, сколько
// кружков показать, подписи раздела и подсказки (RU/EN). Без React и без window: её гоняют
// тесты. Сетевой слой и опрос — lib/presenceStripStore.ts, вид — components/presence/.
//
// Сервер отдаёт только зверя, стиль, раздел и состояние; настоящих имён у клиента нет
// (решение владельца 15.10, docs/decisions/2026-10-07-presence-avatars.md).

/** Опрос полоски, пока вкладка видна. Вместе с пульсом 15 с и окном онлайна 45 с даёт «за секунды». */
export const STRIP_POLL_MS = 5_000;
/** Сколько кружков в шапке на десктопе и на узкой мобильной шапке; остальные — «+N». */
export const STRIP_MAX_DESKTOP = 5;
export const STRIP_MAX_MOBILE = 3;

export type StripState = "active" | "idle";
export type StripPerson = { key: string; animal: number; style: number; section: string; state: StripState };
export type StripPayload = { window: number; people: StripPerson[] };

export type Lang = "ru" | "en";

/** Ответ GET /presence/strip → типизированный вид. Мусор отбрасывается, а не пробрасывается в разметку. */
export function parseStrip(raw: unknown): StripPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { window?: unknown; people?: unknown };
  if (typeof r.window !== "number" || !Array.isArray(r.people)) return null;
  const people: StripPerson[] = [];
  for (const p of r.people as unknown[]) {
    if (!p || typeof p !== "object") continue;
    const x = p as Record<string, unknown>;
    if (
      typeof x.key !== "string" || typeof x.section !== "string" ||
      !Number.isInteger(x.animal) || !Number.isInteger(x.style) ||
      (x.state !== "active" && x.state !== "idle")
    ) continue;
    people.push({
      key: x.key,
      animal: x.animal as number,
      style: x.style as number,
      section: x.section,
      state: x.state,
    });
  }
  return { window: r.window, people };
}

/** Активные первыми, «отошёл» после; внутри группы порядок сервера сохраняется. */
export function orderForStrip(people: readonly StripPerson[]): StripPerson[] {
  return [...people.filter((p) => p.state === "active"), ...people.filter((p) => p.state !== "active")];
}

/** До `max` кружков, остальные — счётчиком. */
export function splitVisible(people: readonly StripPerson[], max: number): { shown: StripPerson[]; rest: number } {
  const shown = people.slice(0, max);
  return { shown, rest: people.length - shown.length };
}

/** Отпечаток списка: меняется только когда на экране есть что перерисовать. */
export function stripSignature(payload: StripPayload): string {
  return `${payload.window}|${payload.people.map((p) => `${p.key}:${p.section}:${p.state}`).join(",")}`;
}

// Первый сегмент раздела (см. presenceSection в lib/presence.ts) → подпись человеческим языком.
const SECTION_LABELS: Record<string, readonly [ru: string, en: string]> = {
  home: ["на главной", "on Home"],
  search: ["на главной", "on Home"],
  tasks: ["в задачах", "in Tasks"],
  projects: ["в проектах", "in Projects"],
  sprints: ["в спринтах", "in Sprints"],
  market: ["в анализе рынка", "in Market analysis"],
  base: ["в базе знаний", "in the Knowledge base"],
  meetings: ["во встречах", "in Meetings"],
  more: ["в разделе «Ещё»", "in More"],
  live: ["на живой встрече", "in a live meeting"],
  settings: ["в настройках", "in Settings"],
};
const SECTION_FALLBACK: readonly [string, string] = ["в SWARM", "in SWARM"];

export function sectionLabel(section: string, lang: Lang): string {
  const first = section.split("/")[0];
  const pair = SECTION_LABELS[first] ?? SECTION_FALLBACK;
  return lang === "en" ? pair[1] : pair[0];
}

export function stateLabel(state: StripState, lang: Lang): string {
  if (state === "active") return lang === "en" ? "working" : "работает";
  return lang === "en" ? "stepped away" : "отошёл";
}

/** Текст подсказки и aria-label: «Задумчивый барсук · в задачах · работает». */
export function tooltipText(
  person: Pick<StripPerson, "section" | "state">,
  animalName: string,
  lang: Lang,
): string {
  return `${animalName} · ${sectionLabel(person.section, lang)} · ${stateLabel(person.state, lang)}`;
}
