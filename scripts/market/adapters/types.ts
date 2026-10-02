import type { IngestPayload } from "../../../supabase/functions/market-ingest/types.ts";
import type { CountryConfig } from "../countries/types.ts";

export type CollectOpts = {
  /** Первый день, за который берём заказы Dodo (YYYY-MM-DD). По умолчанию — 8 дней назад. */
  since?: string;
  /** Сегодня (UTC, YYYY-MM-DD) — в тестах подменяется. */
  today: string;
};
/** Адаптер собирает один источник одной страны. Сбой не бросается наружу, а возвращается
 *  нагрузкой { failed } — его запишет журнал запусков, остальные источники страны продолжат. */
export type Adapter = {
  id: string;
  collect(cfg: CountryConfig, opts: CollectOpts): Promise<IngestPayload>;
};
