// Публичный адрес API Swarm — один источник для всех ссылок, которые функции отдают наружу
// (скрипты установки, MCP-адрес, сборки рекордера). С 13.10.2026 Swarm живёт на своём сервере
// за фронтом Cloudflare (docs/decisions/2026-10-13-move-to-own-server.md); до этого адрес был
// зашит облачным в семи местах. Переопределяется переменной SWARM_PUBLIC_URL.
const DEFAULT_PUBLIC_URL = "https://api.swarm-team.app";

export const SWARM_PUBLIC_URL = (Deno.env.get("SWARM_PUBLIC_URL") || DEFAULT_PUBLIC_URL).replace(/\/+$/, "");

/** Корень edge-функций: `<адрес>/functions/v1`. */
export const FUNCTIONS_BASE_URL = `${SWARM_PUBLIC_URL}/functions/v1`;

/** Публичные объекты хранилища: `<адрес>/storage/v1/object/public`. */
export const STORAGE_PUBLIC_URL = `${SWARM_PUBLIC_URL}/storage/v1/object/public`;
