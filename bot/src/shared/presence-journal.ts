import { isRecorderName } from "./recorder-name.ts";

interface Tile {
  readonly id?: string;
  readonly name: string | null;
  readonly self?: boolean;
  readonly speaking?: boolean;
  readonly audioLevel?: number | null;
}

interface Participant {
  readonly key: string;
  readonly name: string | null;
  readonly kind: "self_or_same_name" | "recorder_name" | "participant" | "unknown";
  readonly indicator: boolean | null;
}

const normalize = (name: string | null): string | null => {
  const cleaned = name
    ?.replaceAll(/\s+/gu, " ")
    .trim()
    .replace(/\((?:вы|you|presenting|host|организатор)\)$/iu, "")
    .trim();
  return cleaned === undefined || cleaned === "" ? null : cleaned;
};

function kindOf(tile: Tile, name: string | null, own: string | null): Participant["kind"] {
  if (tile.self === true || (own !== null && name?.toLowerCase() === own.toLowerCase())) {
    return "self_or_same_name";
  }
  if (name === null) return "unknown";
  return isRecorderName(name) || name.toLowerCase() === "scriba notetaker"
    ? "recorder_name"
    : "participant";
}

/**
 * Records visible evidence, not whether a person is at the keyboard. A partial gallery
 * cannot prove that everybody left. Speaking indicators can stick during real silence.
 * No additional browser reads, permissions, notifications or end-of-call decisions.
 */
export class PresenceJournal {
  readonly #log: (line: string) => void;
  #roster = "";
  #indicators = "";
  #lastAt = -Infinity;
  #indicatorChangedAt: number | null = null;
  #previousKeys = new Set<string>();

  constructor(log: (line: string) => void) {
    this.#log = log;
  }

  observe(
    tiles: readonly Tile[],
    total: number | null,
    selfName: string | null,
    now = Date.now(),
  ): void {
    const own = normalize(selfName);
    const occurrences = new Map<string, number>();
    const unique = new Map<string, Participant>();
    for (const tile of tiles) {
      const name = normalize(tile.name);
      const ordinal = occurrences.get(name ?? "") ?? 0;
      occurrences.set(name ?? "", ordinal + 1);
      const key = tile.id ?? `${name ?? "?"}#${String(ordinal)}`;
      unique.set(key, {
        key,
        name,
        kind: kindOf(tile, name, own),
        indicator: tile.speaking ?? (tile.audioLevel == null ? null : tile.audioLevel > 0),
      });
    }
    const participants = [...unique]
      .map(([, participant]) => participant)
      .toSorted((a, b) => a.key.localeCompare(b.key));
    const roster = JSON.stringify([
      total,
      participants.map(({ key, name, kind }) => ({ key, name, kind })),
    ]);
    const indicators = JSON.stringify(participants.map((p) => [p.key, p.indicator]));
    const hasRosterChanged = roster !== this.#roster;
    const hasIndicatorChanged = indicators !== this.#indicators;
    if (hasIndicatorChanged) this.#indicatorChangedAt = now;
    this.#indicators = indicators;
    if (!hasRosterChanged && now - this.#lastAt < (hasIndicatorChanged ? 10_000 : 60_000)) return;

    const isComplete = total !== null && total > 0 && total === participants.length;
    let state = "unknown";
    if (participants.some((p) => p.kind === "participant")) state = "participants_visible";
    else if (isComplete && participants.every((p) => p.kind !== "unknown")) {
      state = "only_self_or_recorder_names";
    }
    const keys = new Set(participants.map((p) => p.key));
    const disappeared: string[] = [];
    for (const key of this.#previousKeys) {
      if (!keys.has(key)) disappeared.push(key);
    }
    this.#log(
      `presence ${JSON.stringify({
        state,
        total,
        rosterComplete: isComplete,
        participants,
        appeared: [...keys].filter((key) => !this.#previousKeys.has(key)),
        disappeared,
        indicatorChangedAt: this.#indicatorChangedAt,
      })}`,
    );
    this.#roster = roster;
    this.#lastAt = now;
    this.#previousKeys = keys;
  }
}
