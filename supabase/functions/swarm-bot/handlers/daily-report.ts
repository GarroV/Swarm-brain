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
  metadata?: Record<string, unknown> | null;
  content?: string | null;
}

export interface SectionCounts {
  total: number;
  byWorkspace: Record<string, number>;
  bySource: Record<string, number>;
}

export interface ReportData {
  meetings: SectionCounts;
  notes: SectionCounts;
  addedTitles: string[]; // названия всего, что добавлено в базу за день (встречи + заметки)
}

const MEETING_SOURCE_LABEL: Record<string, string> = {
  "desktop-agent": "рекордер",
  granola: "granola",
  read_ai: "read.ai",
};

// Ярлык источника встречи. Новые встречи — desktop-agent/granola/read_ai.
// Легаси-встречи иногда несут в `source` заголовок/имя файла — сводим в «📦 прочее»,
// а не печатаем сырьё.
function meetingSourceLabel(source: string): string {
  return MEETING_SOURCE_LABEL[source] ?? "📦 прочее";
}

// Источник заметки НЕ enum: бот/веб пишут в `source` то канал (telegram/note/link/mini_app),
// то медиа-тип (pdf/image/file/document), то само ИМЯ ФАЙЛА (напр. "IMF_Analytics.xlsx").
// Поэтому классифицируем, а не матчим точно.
const NOTE_CHAT_SOURCES = new Set(["telegram", "note", "mini_app"]);
const NOTE_FILE_SOURCES = new Set(["pdf", "image", "file", "document"]);
const FILE_EXT_RE = /\.[a-z0-9]{2,6}$/i; // "….pptx"/"….xlsx"/"….pdf" → файл

function noteSourceLabel(source: string): string {
  if (source === "link") return "🔗 ссылки";
  if (source === "voice") return "🎤 голосовые";
  if (NOTE_CHAT_SOURCES.has(source)) return "💬 чат";
  if (NOTE_FILE_SOURCES.has(source) || FILE_EXT_RE.test(source)) return "📄 файлы";
  return "📦 прочее";
}

function wsLabel(groupId: string | null): string {
  return groupId ? groupId.toUpperCase() : "Без воркспейса";
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

function emptySection(): SectionCounts {
  return { total: 0, byWorkspace: {}, bySource: {} };
}

// Название записи для списка «Добавлено в базу»: сначала metadata.title (его ставит
// рекордер/правка названия), иначе первая непустая строка content без markdown-решёток.
function rowTitle(r: EntryRow): string {
  const meta = r.metadata as { title?: unknown } | null | undefined;
  const metaTitle = typeof meta?.title === "string" ? meta.title.trim() : "";
  if (metaTitle) return metaTitle;
  const firstLine = (r.content ?? "").split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  const cleaned = firstLine.replace(/^#+\s*/, "").trim();
  if (cleaned) return cleaned.length > 60 ? `${cleaned.slice(0, 59)}…` : cleaned;
  return "(без названия)";
}

// Экранирование для HTML-parse-mode Telegram (названия — пользовательский текст).
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function aggregateActivity(rows: EntryRow[]): ReportData {
  const meetings = emptySection();
  const notes = emptySection();
  const addedTitles: string[] = [];
  for (const r of rows) {
    if (r.entry_type === "meeting") {
      meetings.total++;
      bump(meetings.byWorkspace, wsLabel(r.group_id));
      bump(meetings.bySource, meetingSourceLabel(r.source));
      addedTitles.push(rowTitle(r));
    } else if (r.entry_type === "note") {
      notes.total++;
      bump(notes.byWorkspace, wsLabel(r.group_id));
      bump(notes.bySource, noteSourceLabel(r.source));
      addedTitles.push(rowTitle(r));
    }
  }
  return { meetings, notes, addedTitles };
}

// Формат по запросу владельца 2026-07-25: «Добавлено в базу: N» (+ список названий, если N>0)
// и «На вычитке: M» — встречи, записанные вчера и ещё не опубликованные (status=awaiting_review).
// «Тихий день» — ТОЛЬКО когда и добавленных, и висящих на вычитке ноль (иначе прод-день с
// кучей записей, но без ревью, ошибочно выглядел «тихим» — разбор 2026-07-25). reviewCount
// приходит из таблицы meetings отдельным запросом (см. daily-report-send.ts), не из entries.
const MAX_TITLES = 15;

export function formatReport(data: ReportData, dateLabel: string, reviewCount = 0): string {
  const header = `📊 <b>Свод за ${dateLabel}</b> (вчера)`;
  const addedTotal = data.meetings.total + data.notes.total;
  if (addedTotal === 0 && reviewCount === 0) {
    return `${header}\n\nЗа вчера ничего не добавили — тихий день.`;
  }
  const lines = [header, "", `📥 Добавлено в базу: <b>${addedTotal}</b>`];
  if (addedTotal > 0) {
    for (const t of data.addedTitles.slice(0, MAX_TITLES)) lines.push(`• ${esc(t)}`);
    if (data.addedTitles.length > MAX_TITLES) {
      lines.push(`…и ещё ${data.addedTitles.length - MAX_TITLES}`);
    }
  }
  lines.push("", `📋 На вычитке: <b>${reviewCount}</b>`);
  return lines.join("\n");
}
