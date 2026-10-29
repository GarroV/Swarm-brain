// swarm-setup — отдаёт bash-скрипт авто-подключения Claude Desktop и Claude Code (macOS).
// Запускается пользователем командой из веба (Настройки → Claude Desktop): скрипт скачивается во
// временный файл, сверяется его SHA-256 (`shasum -a 256 -c`) и только потом запускается, токен — в
// окружении (`SWARM_TOKEN=…`), не в аргументах. Строку собирает buildSetupOneLiner (_shared/mcp-token.ts).
//
// Скрипт ставит мост bash+curl в ~/.swarm-brain, безопасно мёржит блок swarm-brain в
// claude_desktop_config.json, прописывает сервер в Claude Code (если есть CLI) и перезапускает Desktop.
// Текст скрипта — в ../_shared/mcp-setup-script.ts (вынесен для проверки bash -n и тестов мёржа).
//
// Адреса (публичные GET, без секретов; без кэша — отпечаток в команде должен совпадать с телом):
//   …/swarm-setup          — установщик;
//   …/swarm-setup/bridge   — текст моста (его тянет само-обновление моста при старте);
//   …/swarm-setup/version  — {"version":N,"sha256":"…"} моста.
//
// Деплой: supabase functions deploy swarm-setup --no-verify-jwt.

import { BRIDGE_SCRIPT, BRIDGE_VERSION, SETUP_SCRIPT, sha256Hex } from "../_shared/mcp-setup-script.ts";

const CORS = { "Access-Control-Allow-Origin": "*" };
const NO_CACHE = { "Cache-Control": "no-cache" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  }
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path.endsWith("/version")) {
    const body = JSON.stringify({ version: BRIDGE_VERSION, sha256: await sha256Hex(BRIDGE_SCRIPT) });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json", ...NO_CACHE, ...CORS } });
  }
  if (path.endsWith("/bridge")) {
    return new Response(BRIDGE_SCRIPT, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_CACHE, ...CORS },
    });
  }
  return new Response(SETUP_SCRIPT, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_CACHE, ...CORS },
  });
});
