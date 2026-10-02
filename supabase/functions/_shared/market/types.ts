// «Анализ рынка» — типы снимка страны (спека docs/superpowers/specs/2026-10-02-market-analysis-design.md).
// Снимок — способ залить РУЧНЫЕ источники (то, что кодом пока не собирается). Его формат —
// данные хорватского анализа 01.10.2026, чтобы первичная заливка шла из файла без переписывания.
export type Verification = "official" | "confirmed" | "corrected" | "added" | "unverified" | "internal";
export type LocStatus = "open" | "closed" | "planned" | "paused";
export const VERIFICATIONS: Verification[] = ["official", "confirmed", "corrected", "added", "unverified", "internal"];
export const LOC_STATUSES: LocStatus[] = ["open", "closed", "planned", "paused"];
/** Записи, которые сборщик сам не переписывает — только через кандидата. */
export const TRUSTED: Verification[] = ["official", "confirmed", "corrected", "added", "internal"];

export type ChainHist = { year: number; count: number; source: string | null };
export type SnapChain = {
  key: string;
  name: string;
  slot: number;
  segment: string;
  bakery: boolean;
  origin: string | null;
  operator: string | null;
  first_entry: string | null;
  notes: string | null;
  hist: ChainHist[];
};
export type SnapLocation = {
  chain: string;
  name: string;
  city: string | null;
  address: string | null;
  lat: number;
  lng: number;
  placement: string | null;
  /** "2017" | "2017-11" | "2017-11-05" | null */
  opened: string | null;
  opened_estimated: boolean;
  status: LocStatus;
  closed: string | null;
  format: string | null;
  source: string | null;
  verification: Verification;
  verification_note: string | null;
};
export type SnapFinYear = {
  year: number;
  revenue_eur: number | null;
  net_profit_eur: number | null;
  employees: number | null;
  source: string | null;
  verification: Verification;
  note: string | null;
};
export type SnapCompany = {
  chain: string | null;
  name: string;
  reg_id: string | null;
  owner: string | null;
  notes: string | null;
  years: SnapFinYear[];
};
export type SnapPrice = {
  chain: string;
  item: string;
  item_type: string | null;
  size_cm: number | null;
  price_eur: number;
  channel: string | null;
  source: string | null;
  seen_on: string | null;
};
export type FactTopic = "delivery" | "market" | "deal" | "timeline" | "insight" | "commentary";
export type SnapFact = {
  topic: FactTopic;
  date: string | null;
  text: string;
  value: string | null;
  source: string | null;
};
export type SnapDodoMonth = {
  month: string;
  revenue_local: number | null;
  currency: string;
  revenue_eur: number | null;
  units: number | null;
  orders: Record<string, number> | null;
  complete: boolean;
};
export type Snapshot = {
  chains: SnapChain[];
  locations: SnapLocation[];
  companies: SnapCompany[];
  prices: SnapPrice[];
  facts: SnapFact[];
  dodo: SnapDodoMonth[];
};
