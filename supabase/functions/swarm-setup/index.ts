// swarm-setup — отдаёт bash-скрипт авто-подключения Claude Desktop (macOS).
// Запускается пользователем так (токен подставляет бот в /setup):
//   curl -fsSL https://<proj>.supabase.co/functions/v1/swarm-setup | SWARM_TOKEN='smcp_...' bash
//
// Скрипт ставит Node в ~/.swarm-brain (без sudo, если в системе его нет), безопасно
// мёржит блок swarm-brain в claude_desktop_config.json и перезапускает Claude Desktop.
// Текст скрипта — в ./script.ts (вынесен для проверки bash -n и тестов мёржа).
//
// Деплой: supabase functions deploy swarm-setup --no-verify-jwt (публичный GET, без секретов).

import { SETUP_SCRIPT } from "./script.ts";

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }
  return new Response(SETUP_SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
