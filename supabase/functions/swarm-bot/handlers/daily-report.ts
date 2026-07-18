export const REPORT_TZ = "Europe/Belgrade";

export interface DayWindow {
  sinceISO: string;
  untilISO: string;
  dateLabel: string;
}

// UTC-инстант локальной полуночи даты `localDate` (YYYY-MM-DD) в таймзоне `tz`.
// Смещение tz читается из Intl на этот момент → устойчиво к переходу на летнее время.
function tzMidnightUTC(localDate: string, tz: string): Date {
  const guess = new Date(`${localDate}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = asUTC - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

export function yesterdayWindow(tz: string = REPORT_TZ, now: Date = new Date()): DayWindow {
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const todayLocal = dateFmt.format(now);
  const todayMidnightUTC = tzMidnightUTC(todayLocal, tz);
  // Шаг на 12ч назад гарантированно попадает во «вчера» даже в 23/25-часовые DST-сутки.
  const yProbe = new Date(todayMidnightUTC.getTime() - 12 * 3_600_000);
  const yLocal = dateFmt.format(yProbe);
  const sinceUTC = tzMidnightUTC(yLocal, tz);
  const [, mm, dd] = yLocal.split("-");
  return {
    sinceISO: sinceUTC.toISOString(),
    untilISO: todayMidnightUTC.toISOString(),
    dateLabel: `${dd}.${mm}`,
  };
}

export interface EntryRow {
  entry_type: string;
  source: string;
  group_id: string | null;
}

export interface SectionCounts {
  total: number;
  byWorkspace: Record<string, number>;
  bySource: Record<string, number>;
}

export interface ReportData {
  meetings: SectionCounts;
  notes: SectionCounts;
}

const MEETING_SOURCE_LABEL: Record<string, string> = {
  "desktop-agent": "рекордер",
  granola: "granola",
  read_ai: "read.ai",
};

const NOTE_SOURCE_LABEL: Record<string, string> = {
  telegram: "💬 чат",
  note: "💬 чат",
  link: "🔗 ссылки",
  voice: "🎤 голосовые",
  document: "📄 файлы",
  file: "📄 файлы",
};

function wsLabel(groupId: string | null): string {
  return groupId ? groupId.toUpperCase() : "Без воркспейса";
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

function emptySection(): SectionCounts {
  return { total: 0, byWorkspace: {}, bySource: {} };
}

export function aggregateActivity(rows: EntryRow[]): ReportData {
  const meetings = emptySection();
  const notes = emptySection();
  for (const r of rows) {
    if (r.entry_type === "meeting") {
      meetings.total++;
      bump(meetings.byWorkspace, wsLabel(r.group_id));
      bump(meetings.bySource, MEETING_SOURCE_LABEL[r.source] ?? r.source);
    } else if (r.entry_type === "note") {
      notes.total++;
      bump(notes.byWorkspace, wsLabel(r.group_id));
      bump(notes.bySource, NOTE_SOURCE_LABEL[r.source] ?? "📦 прочее");
    }
  }
  return { meetings, notes };
}

function subLine(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

function renderSection(emoji: string, title: string, c: SectionCounts): string {
  let out = `${emoji} <b>${title}: ${c.total}</b>`;
  if (c.total > 0) {
    out += `\n   ${subLine(c.byWorkspace)}`;
    out += `\n   ${subLine(c.bySource)}`;
  }
  return out;
}

export function formatReport(data: ReportData, dateLabel: string): string {
  const header = `📊 <b>Свод за ${dateLabel}</b> (вчера)`;
  if (data.meetings.total === 0 && data.notes.total === 0) {
    return `${header}\n\nЗа вчера ничего не добавили — тихий день.`;
  }
  return [
    header,
    renderSection("🎙", "Встречи", data.meetings),
    renderSection("📝", "Новые данные", data.notes),
  ].join("\n\n");
}
