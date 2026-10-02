// Полезная нагрузка сборщиков «Анализа рынка» (scripts/market/*) для функции market-ingest.
export type DodoUnit = {
  name: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  opened: string | null;
  open: boolean;
  organization: string | null;
};
export type OsmPoint = {
  chain: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  address: string | null;
  osm_id: string;
};
export type RegistryYear = {
  reg_id: string;
  year: number;
  revenue_eur: number | null;
  net_profit_eur: number | null;
  employees: number | null;
  source: string;
};
export type SourceFeed =
  | "locations"
  | "financials"
  | "dodo"
  | "prices"
  | "facts";
export type ConfigSource = {
  adapter: string;
  feeds: SourceFeed;
  chain?: string;
  cadence: "weekly" | "monthly" | "yearly" | "manual";
  mode: "auto" | "manual" | "blocked";
  reason?: string;
  /** Только для реестра источников (docs/market/SOURCES.md), на сервер не уходят: откуда берём
   *  вручную, что именно и когда человек последний раз сверял источник (YYYY-MM-DD). */
  url?: string;
  note?: string;
  checked?: string;
};
export type ConfigChain = {
  key: string;
  name: string;
  segment: string;
  bakery?: boolean;
  slot?: number;
};
export type ConfigCompany = {
  chain: string | null;
  name: string;
  regId: string;
};

type Base = { country: string; started_at: string };
export type IngestPayload =
  | Base & {
    source: "config";
    chains: ConfigChain[];
    companies: ConfigCompany[];
    sources: ConfigSource[];
  }
  | Base & {
    source: "dodo";
    units: DodoUnit[];
    days: Array<{ date: string; counts: Record<string, number> }>;
    /** rates — единиц валюты за 1 € в этом месяце (ЕЦБ), когда страна платит не в евро. */
    revenue: {
      month: string;
      amount: number;
      currency: string;
      units: number | null;
      rates?: Record<string, number>;
    } | null;
  }
  | Base & { source: "osm"; points: OsmPoint[] }
  | Base & { source: "registry"; adapter: string; years: RegistryYear[] }
  | Base & { source: string; adapter?: string; failed: string };
