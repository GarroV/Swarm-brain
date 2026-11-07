import type { Entry } from "@/types";
import type { AutojoinCalendarCheck } from "../autojoinNotice";

export type UpdateMeetingInput = {
  confirmed?: boolean;
  summary?: string | null;
  countries?: string[];
  content?: string;
  is_private?: boolean;
  entry_type?: string;
  title?: string;
};

// ── Встречи сегодня из календаря (issue #218) ────────────────────────────────
// Панель правой колонки главной. Календарь читает СЕРВЕР по OAuth-интеграции — у браузера
// доступа к календарю нет. Пояс шлём свой: сервер живёт в UTC и не знает, какие у нас сутки.
export type TodayMeeting = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  join_url: string | null;
  is_now: boolean;
  is_past: boolean;
  attendees: number;
  /** Ты сам в этом звонке прямо сейчас (сигнал рекордера) — строка показывает `ON AIR`. */
  on_call: boolean;
  /** …и рекордер его пишет — рядом с `ON AIR` встаёт `REC`. */
  recording: boolean;
};

/** `reason` различает причины пустоты: панель по ним рисует РАЗНОЕ (кнопка vs пустое состояние). */
export type TodayMeetings = {
  meetings: TodayMeeting[];
  reason?: "not_connected" | "token_expired" | "calendar_error";
};

/** Параметры страницы списка встреч (`GET /meetings?light=1`, swarm-api/meetings-list.ts). */
export type MeetingsPageQuery = {
  confirmed?: boolean;
  limit?: number;
  offset?: number;
  q?: string;
  /** День встречи YYYY-MM-DD, границы включительно. */
  from?: string;
  to?: string;
  storage?: "shared" | "personal";
};

export type MeetingsPage = {
  rows: Entry[];
  /** Сколько строк подходит под запрос БЕЗ лимита (X-Total-Count). */
  total: number | null;
  /** Сколько встреч всего, без фильтров экрана (X-Unfiltered-Count). */
  unfilteredTotal: number | null;
};

// ── Запись встречи из браузера (офлайн-встречи; docs/decisions/2026-10-16-web-recorder.md) ──

export type WebRecordingStart = { id: string; started_at: string };

export type WebRecordingActive = {
  id: string;
  started_at: string;
  segments: number[];
};

export type WebRecordingFinish = {
  ok: boolean;
  summary_status?: string;
  already?: boolean;
};

export interface AutojoinState {
  enabled: boolean;
  calendar?: AutojoinCalendarCheck;
}
