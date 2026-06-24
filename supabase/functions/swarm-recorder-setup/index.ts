// swarm-recorder-setup — отдаёт bash-скрипт авто-установки SwarmRecorder (macOS, сборка из исходников).
// Запускается пользователем так (токен подставляет бот в /recordertoken):
//   curl -fsSL https://<proj>.supabase.co/functions/v1/swarm-recorder-setup | SWARM_TOKEN='smcp_...' bash
//
// Скрипт ставит Command Line Tools (если нужно), клонирует публичный репозиторий,
// создаёт+доверяет стабильному self-signed cert (./setup-signing.sh), собирает и подписывает
// приложение (./install.sh), кладёт его в /Applications и прописывает config.json с токеном.
// Текст скрипта — в ./script.ts (вынесен для проверки bash -n и тестов).
//
// Деплой: supabase functions deploy swarm-recorder-setup --no-verify-jwt (публичный GET, без секретов).

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
