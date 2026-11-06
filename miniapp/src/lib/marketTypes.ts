// Data contracts for market sales and public ratings. Runtime API calls stay in api.ts.

/** Строка выручки Dodo, как её читает главная (подмножество `MarketBundle.dodo`). */
export type MarketSalesRow = {
  month: string;
  revenue_eur: number | null;
  complete: boolean;
};

/** Выручка с 1-го числа по сегодня (GET /market/sales → mtd). `source`: сумма пиццерий из Dodo IS через Децимус
 *  или публичный API Dodo (по стране, без разбивки); старые функции поля не отдают. */
export type MarketMtd = {
  as_of: string;
  revenue_eur: number;
  source?: "decimus" | "dodo_public";
};

/** Выручка пиццерий с 1-го числа, € (GET /market/sales → unit_sales): ключ — код пиццерии (как `id` в /quality),
 *  `loaded` — когда Децимус загрузил продажи страны (ISO UTC). Страны без данных Децимуса в нём нет. */
export type MarketUnitSales = {
  month: string;
  loaded: Record<string, string>;
  units: Record<string, number>;
};

export interface MapsStat {
  avg: number | null;
  reviews: number;
  branches: number;
  delta: number | null;
}

export interface MapsUnitStat {
  avg: number | null;
  reviews: number;
  prev_avg: number | null;
}

export interface MapsCountry {
  cc: string;
  as_of: string | null;
  maps: { google: MapsStat; yandex: MapsStat };
}

export interface MapsUnit {
  id: string;
  name: string;
  cc: string;
  city: string | null;
  maps: { google: MapsUnitStat | null; yandex: MapsUnitStat | null };
}

export interface MapsData {
  on: string;
  compare: string | null;
  countries: MapsCountry[];
  units: MapsUnit[];
  loaded_at: string | null;
}

export interface AggregatorInfo {
  key: string;
  title: string;
  scale: number;
}

export interface AggregatorScore {
  avg: number | null;
  scale: number;
  votes: number;
  pizzerias: number;
  delta: number | null;
}

export interface AggregatorsCountry {
  cc: string;
  as_of: string | null;
  scores: Record<string, AggregatorScore>;
}

export interface AggregatorsData {
  on: string;
  compare: string | null;
  aggregators: AggregatorInfo[];
  countries: AggregatorsCountry[];
  loaded_at: string | null;
}
