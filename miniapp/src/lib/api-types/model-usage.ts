import type { UsageCell } from "../usageCube";

export type UsageSlice = {
  key: string;
  usd: number;
  calls: number;
  unpriced: number;
  tokens: number;
};

export type ModelUsage = {
  /** Период, дни по Белграду, обе границы включительно (#822). */
  from: string;
  to: string;
  truncated: boolean;
  total_usd: number;
  calls: number;
  unpriced_calls: number;
  tokens: number;
  audio_minutes: number;
  by_purpose: UsageSlice[];
  by_model: UsageSlice[];
  by_day: Array<{ day: string; usd: number; calls: number }>;
  top_meetings: Array<
    { meeting_id: string; usd: number; calls: number; title: string | null }
  >;
  /** Клетки день × назначение × модель × встреча (#822). Нет у функции до раскатки #836. */
  cells?: UsageCell[];
  /** Последние вызовы периода, новые сверху (до 300). */
  recent?: UsageCall[];
  /** Названия всех встреч из `cells`. */
  meeting_titles?: Record<string, string | null>;
};

export type UsageCall = {
  at: string;
  purpose: string;
  model: string;
  meeting_id: string | null;
  /** null — модель не в прайсе. */
  usd: number | null;
  tokens: number;
  audio_seconds: number;
};
