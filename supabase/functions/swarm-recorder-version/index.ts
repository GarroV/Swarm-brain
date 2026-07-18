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
// build 6 (2026-07-15): название встречи сразу в поле панели — реальное (календарь/комната) или
// дефолт «Встреча <имя пользователя macOS> · <дата, время>» вместо пустого плейсхолдера. Тег recorder-build-6.
// build 5 (2026-07-15): надёжность записи собеседника (Фаза 1) — устранён самодедлок AudioDeviceStop
// (разделены очереди IOProc/HAL + таймаут на стоп), watchdog нулей с пересборкой и детектом смены
// формата устройства (BT-профиль) + честный сигнал «собеседник не пишется», сняты триггеры build 4.
// Тег recorder-build-5, build-app.sh + смоук --selftest ✅. Обкатано на реальной встрече (AirPods, 7+ мин).
// build 4 (2026-07-09): heartbeat-мониторинг рекордера (SwarmClient.heartbeat → meeting-heartbeat;
// сервер ловит оборванную запись / истечение токена). Тег recorder-build-4, build-app.sh ✅ (подпись валидна).
// build 3 (2026-06-30): бэкап аудио держится до публикации в базу + потолок 3 суток. Тег recorder-build-3.
const LATEST_BUILD = 11;

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "GET, OPTIONS", "Access-Control-Allow-Origin": "*" } });
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
