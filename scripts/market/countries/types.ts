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
  /** Начала тега name, если тега brand у сети в OSM нет (локальные сети; можно кириллицей). */
  osmNames?: string[];
};
export type CountryCompany = {
  chain: string | null;
  name: string;
  regId: string;
  /** Страница юрлица в CompanyWall (адаптер companywall): /firma/<slug>/<id>. */
  url?: string;
};
export type CountryConfig = {
  country: string;
  dodoCode: string;
  /** Валюта отчётности юрлиц, если не евро (RSD — курс НБС, остальные — ЕЦБ). */
  currency?: string;
  /** Письменность городов: «sr-Latn» — сербскую кириллицу из OSM переводить в латиницу. */
  cityScript?: "sr-Latn";
  chains: CountryChain[];
  companies: CountryCompany[];
  sources: ConfigSource[];
};
