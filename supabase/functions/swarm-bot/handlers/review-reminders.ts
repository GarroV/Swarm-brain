// Напоминания владельцам про невычитанные встречи. Чистая логика (без БД/Telegram) —
// отбор «пора напомнить», группировка по владельцу и формат сообщения. БД+отправка — в
// review-reminders-send.ts, крон-триггер — swarm-bot/index.ts (review_reminders_cron).
//
// Правило (согласовано с владельцем 2026-07-25): встреча висит невычитанной > 48 ч → первое
// напоминание; дальше каждые 24 ч, пока не вычитают. Только в рабочие часы по Белграду (будни
// 9–19), чтобы не пинговать ночью/в выходные. Кнопка ведёт в веб (уводим из Telegram в веб).

export const REMINDER_TZ = "Europe/Belgrade";
export const STALE_HOURS = 48; // сколько встреча висит до ПЕРВОГО напоминания
export const REPEAT_HOURS = 24; // как часто напоминать дальше
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 19;
const MAX_BUTTONS = 10; // Telegram: не вываливаем сотню кнопок — верх списка + «…ещё N»

export interface ReminderRow {
  id: string;
  owner_id: number | null;
  title: string;
  meetingDate: string; // YYYY-MM-DD для показа
  created_at: string; // ISO — от него считаем «висит > 48ч»
  last_review_reminded_at: string | null;
}

export interface InlineUrlButton {
  text: string;
  url: string;
}

// Рабочие часы по Белграду: будни, 9:00–19:00. Устойчиво к DST (смещение берём из Intl).
export function isWorkingHours(now: Date, tz: string = REMINDER_TZ): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const isWeekday = weekday !== "Sat" && weekday !== "Sun";
  return isWeekday && hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

// Встречи, по которым пора напомнить: висят > STALE_HOURS и (ещё не напоминали ИЛИ прошло >= REPEAT_HOURS).
export function selectDueReminders(rows: ReminderRow[], now: Date): ReminderRow[] {
  const staleBefore = now.getTime() - STALE_HOURS * 3_600_000;
  const repeatBefore = now.getTime() - REPEAT_HOURS * 3_600_000;
  return rows.filter((r) => {
    if (r.owner_id == null) return false;
    if (new Date(r.created_at).getTime() > staleBefore) return false; // ещё свежая (< 48ч)
    if (r.last_review_reminded_at == null) return true; // ни разу не напоминали
    return new Date(r.last_review_reminded_at).getTime() <= repeatBefore; // прошли сутки с прошлого
  });
}

export function groupByOwner(rows: ReminderRow[]): Map<number, ReminderRow[]> {
  const byOwner = new Map<number, ReminderRow[]>();
  for (const r of rows) {
    if (r.owner_id == null) continue;
    const arr = byOwner.get(r.owner_id) ?? [];
    arr.push(r);
    byOwner.set(r.owner_id, arr);
  }
  return byOwner;
}

function pluralMeetings(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "встреча ждёт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "встречи ждут";
  return "встреч ждут";
}

function ruShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

// Сообщение владельцу: текст + по кнопке на встречу (ссылка в веб `/?meeting=<id>`).
// Если webBaseUrl пуст (env не задан) — без кнопок, названия в тексте.
export function formatReminder(
  rows: ReminderRow[],
  webBaseUrl: string,
): { text: string; keyboard: InlineUrlButton[][] } {
  const n = rows.length;
  const header = `🔔 У тебя ${n} ${pluralMeetings(n)} вычитки (висят больше 2 дней)`;
  const shown = rows.slice(0, MAX_BUTTONS);
  const rest = n - shown.length;

  if (!webBaseUrl) {
    const list = shown.map((r) => `• ${r.title} · ${ruShortDate(r.meetingDate)}`).join("\n");
    const tail = rest > 0 ? `\n…и ещё ${rest}` : "";
    return { text: `${header}\nОткрой /meetings и подтверди:\n${list}${tail}`, keyboard: [] };
  }

  const keyboard: InlineUrlButton[][] = shown.map((r) => {
    const title = r.title.length > 40 ? `${r.title.slice(0, 39)}…` : r.title;
    return [{ text: `${title} · ${ruShortDate(r.meetingDate)}`, url: `${webBaseUrl}/?meeting=${r.id}` }];
  });
  const tail = rest > 0 ? `\n…и ещё ${rest} — в /meetings` : "";
  return { text: `${header}\nОткрой, проверь тезисы и подтверди:${tail}`, keyboard };
}
