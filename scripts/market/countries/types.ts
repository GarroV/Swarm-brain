// Конфиг страны «Анализа рынка» — единственное место, где страна описана: сети, их теги в OSM,
// юрлица операторов с рег. номерами и источники данных. Добавить страну = написать такой файл
// и вписать его в countries/index.ts; добавить сеть = строка в chains.
import type { ConfigSource } from "../../../supabase/functions/market-ingest/types.ts";

export type CountryChain = {
  key: string;
  name: string;
  segment:
    | "pizza"
    | "burger"
    | "chicken"
    | "bakery"
    | "coffee"
    | "grill"
    | "asian"
    | "sandwich"
    | "other";
  bakery?: boolean;
  /** Значения тега brand в OpenStreetMap. Пусто — сеть в OSM не ищем (локальная, её там нет). */
  osmBrands?: string[];
};
export type CountryCompany = {
  chain: string | null;
  name: string;
  regId: string;
};
export type CountryConfig = {
  country: string;
  dodoCode: string;
  chains: CountryChain[];
  companies: CountryCompany[];
  sources: ConfigSource[];
};
