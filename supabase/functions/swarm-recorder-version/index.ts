// swarm-recorder-version — источник истины «какая сборка рекордера последняя» для авто-апдейта.
// Рекордер (Updater.swift) дёргает GET и сравнивает с вшитым CFBundleVersion: сервер новее →
// тихо пересобирается из исходников и перезапускается. GitHub тут НЕ участвует (по требованию).
//
// РАСКАТКА: это наш рубильник. Подними LATEST_BUILD здесь ТОЛЬКО после того, как соответствующий
// номер уже лежит в recorder/VERSION в ветке sandbox_vas и собирается. Тогда все рекордеры
// (в т.ч. у маркетинг-команды) тихо обновятся в простое. Плохую сборку не пушим — это сломает всех.
//
// Деплой: supabase functions deploy swarm-recorder-version --no-verify-jwt (публичный GET, без секретов).

// Держать в синхроне с recorder/VERSION (ветка sandbox_vas). Поднимать ПОСЛЕ мёрджа+проверки сборки.
const LATEST_BUILD = 2;

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }
  return new Response(JSON.stringify({ build: LATEST_BUILD }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
