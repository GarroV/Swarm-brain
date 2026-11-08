import type { BackdropId } from "../backdrop";

export type UpdateMeInput = {
  role?: string | null;
  markets?: string[];
  ui_backdrop?: BackdropId | null;
  recorder_auto_start?: boolean;
};

// ── Присутствие (#751) ───────────────────────────────────────────────────────
// Пульс веба (components/PresencePulse.tsx): раздел и был ли ввод. Свой fetch, а не apiFetch:
// пульс раз в 15 с не должен сбрасывать кэш чтения, будить плашку
// «нет связи», уводить на вход по 401 или включать заглушку работ по 503 — это фон, а не
// действие человека. keepalive: запрос `away` на закрытии вкладки должен уйти и после выгрузки
// страницы (sendBeacon не умеет заголовок tma, а в Telegram авторизация — именно он).
export type PresencePing = { section: string; active: boolean; away?: boolean };

// ── Статистика по людям (GET /stats/people) ─────────────────────────────────
// Форма — зеркало `PersonStats` из supabase/functions/_shared/stats/people.ts.
export type PersonStats = {
  telegram_id: number;
  name: string;
  tasks: {
    open: number;
    inProgress: number;
    overdue: number;
    closed: number;
    closedRecent: number;
    onTimeRate: number | null;
    onTimeBase: number;
    avgCloseDays: number | null;
  };
  /** inReview — сколько встреч человека ждут вычитки; только число, содержимое черновиков не отдаётся. */
  meetings: { published: number; inReview: number };
  activity: {
    activeDays: number;
    strip: number[];
    lastActiveAt: string | null;
  };
};

export type PeopleStatsResponse = {
  people: PersonStats[];
  activityDays: number;
  closedWindowDays: number;
  tasksTruncated: boolean;
};
