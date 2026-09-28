// Адрес swarm-api для прокси и входа. В проде задан переменной SWARM_API_URL в Cloudflare Pages;
// у превью веток переменных окружения нет, поэтому берём публичный адрес прода — он не секрет
// (виден в любом запросе веба). Превью ветки так работает с той же базой, что и прод
// (решение владельца 24.09.2026: витрина нового интерфейса — на живой базе, без копий).
export const PROD_SWARM_API_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-api";
export const PROD_HOST = "swarm-brain.pages.dev";

export const swarmApiUrl = (env: { SWARM_API_URL?: string }): string =>
  (env.SWARM_API_URL || PROD_SWARM_API_URL).replace(/\/$/, "");

// Корень edge-функций (…/functions/v1) — для соседних функций вроде meeting-webtoken.
export const functionsBase = (env: { SWARM_API_URL?: string }): string =>
  swarmApiUrl(env).replace(/\/swarm-api$/, "");
