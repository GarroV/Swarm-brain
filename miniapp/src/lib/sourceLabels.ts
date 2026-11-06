import { recordedByOf } from "./agentMeeting";

type Translate = (ru: string, en: string) => string;
type SourceRecord = {
  source: string;
  recorded_by?: string | null;
  agent_version?: string | null;
  metadata?: Record<string, unknown> | null;
};

// Stable source keys own both locales. Components never translate a rendered RU label.
const LABELS: Record<string, { ru: string; en: string }> = {
  granola: { ru: "Granola", en: "Granola" },
  read_ai: { ru: "Read.ai", en: "Read.ai" },
  "web-recorder": { ru: "Swarm Brain", en: "Swarm Brain" },
  bumblebee: { ru: "bumblebee", en: "bumblebee" },
  scriba: { ru: "scriba", en: "scriba" },
  meeting: { ru: "Встреча", en: "Meeting" },
  telegram: { ru: "Бот (Telegram)", en: "Bot (Telegram)" },
  link: { ru: "Ссылка", en: "Link" },
  note: { ru: "Заметка", en: "Note" },
  pdf: { ru: "PDF", en: "PDF" },
  image: { ru: "Изображение", en: "Image" },
  claude_desktop: { ru: "Claude Desktop", en: "Claude Desktop" },
  manual: { ru: "Вручную", en: "Manual" },
  digest: { ru: "Дайджест", en: "Digest" },
};

export function sourceKeyLabel(key: string, dt: Translate): string {
  const label = Object.hasOwn(LABELS, key) ? LABELS[key] : undefined;
  return label ? dt(label.ru, label.en) : key || "—";
}

function recordedBy(record: SourceRecord) {
  const fromMeta = record.metadata?.recorded_by;
  return recordedByOf({
    source: record.source,
    recorded_by: record.recorded_by ??
      (typeof fromMeta === "string" ? fromMeta : null),
    agent_version: record.agent_version,
  });
}

/** Meeting filters group legacy recorder sources by the recording actually used. */
export function meetingSourceKey(record: SourceRecord): string {
  if (
    record.source === "granola" || record.source === "read_ai" ||
    record.source === "web-recorder"
  ) return record.source;
  return recordedBy(record) ?? "meeting";
}

export function meetingSourceLabel(
  record: SourceRecord,
  dt: Translate,
): string {
  return sourceKeyLabel(meetingSourceKey(record), dt);
}

/** Knowledge-base records also include non-meeting sources; retain unknown provenance. */
export function entrySourceLabel(record: SourceRecord, dt: Translate): string {
  return sourceKeyLabel(recordedBy(record) ?? record.source, dt);
}

/** The recorder review surface historically defaults missing provenance to bumblebee. */
export function recorderSourceLabel(
  record: SourceRecord,
  dt: Translate,
): string {
  return sourceKeyLabel(recordedBy(record) ?? "bumblebee", dt);
}

const MEETING_KEYS = [
  "granola",
  "read_ai",
  "web-recorder",
  "bumblebee",
  "scriba",
  "meeting",
];
// Only compatibility with already-saved labels reads translations; display and filtering use keys.
const LEGACY_FILTER_KEYS = new Map(MEETING_KEYS.flatMap((key) =>
  [
    [LABELS[key].ru, key],
    [LABELS[key].en, key],
  ] as [string, string][]
));

export function normalizeSourceFilterKeys(keys: string[]): string[] {
  return [...new Set(keys.map((key) => LEGACY_FILTER_KEYS.get(key) ?? key))];
}
