// swarm-recorder-version — источник истины «какая сборка рекордера последняя» для авто-апдейта.
// Рекордер (Updater.swift) дёргает GET и сравнивает с вшитым CFBundleVersion: сервер новее →
// тихо пересобирается из исходников и перезапускается. GitHub тут НЕ участвует (по требованию).
//
// РАСКАТКА: это наш рубильник. Подними LATEST_BUILD здесь ТОЛЬКО после того, как соответствующий
// номер уже лежит в recorder/VERSION в ветке main и собирается. Тогда все рекордеры
// (в т.ч. у маркетинг-команды) тихо обновятся в простое. Плохую сборку не пушим — это сломает всех.
//
// Деплой: supabase functions deploy swarm-recorder-version --no-verify-jwt (публичный GET, без секретов).

// Держать в синхроне с recorder/VERSION (ветка main). Поднимать ПОСЛЕ мёрджа+проверки сборки.
// build 19 (2026-08-06): ОБРЕЗКА ТИШИНЫ перед Whisper (SilenceTrimmer): mic-дорожка ~85% тишины →
// −~60% Whisper-минут. Речевые блоки с offset реального старта (порядок реплик sys/mic цел, сервер
// не трогаем), fallback на весь файл при сбое/плотной дорожке, пустой mic не грузится. Проверено на
// проде: реальный бэкап 45 мин вместо 112, порядок реплик цел, тезисы качественные; живой --selftest ✅.
// ВКЛЮЧАЕТ ранее не раскатанные build 17 (календарный конец НЕ рубит активный звонок — стоп только
// по тишине) и build 18 (dismissedKeys с TTL вместо «навсегда»). Тег recorder-build-19.
// build 15 (2026-07-23): ФИКС РЕГРЕССА build 14 — recWatchTick снова тикает. В 14 startCallEndWatch
// вызывался из Task без @MainActor (после await recorder.start()) → на фоновом потоке; Timer.scheduledTimer
// садился на мёртвый фоновый run loop → авто-стоп (тишина/календарь/крышка) и чекпоинт-ротации МОЛЧАЛИ.
// Фикс: Timer(timeInterval:)+RunLoop.main.add внутри DispatchQueue.main.async — таймер всегда на main.
// Проверено ВЖИВУЮ: строки `tick` в /tmp/swarm-calldetect.log каждые 5с на реальной записи. Тег recorder-build-15.
// build 14 (2026-07-23): фикс краша на стопе (deinit-deadlock ProcessTapSystemRecorder — EXC_BREAKPOINT),
// сторож конца звонка армится ДО показа панели (иначе не было авто-стопа/ротаций/меты), meta.json
// пишется синхронно на триггере ротации (recovery видит актуальные сегменты), recovery валидирует
// сегменты через AVAudioFile вместо слепого dropLast + карантин в failed/ вместо удаления аудио.
// Включает build 12 (чекпоинты) и build 13 (авто-стоп на сон/крышку). Тег recorder-build-14.
// Проверено: чистая сборка тега, --selftest (claim→upload→done), heartbeat=14, живой тест quarantine
// (папка с аудио НЕ удаляется), адверсариал-верификация раскатки (3 линзы) → GO, 0 блокеров.
// build 6 (2026-07-15): название встречи сразу в поле панели — реальное (календарь/комната) или
// дефолт «Встреча <имя пользователя macOS> · <дата, время>» вместо пустого плейсхолдера. Тег recorder-build-6.
// build 5 (2026-07-15): надёжность записи собеседника (Фаза 1) — устранён самодедлок AudioDeviceStop
// (разделены очереди IOProc/HAL + таймаут на стоп), watchdog нулей с пересборкой и детектом смены
// формата устройства (BT-профиль) + честный сигнал «собеседник не пишется», сняты триггеры build 4.
// Тег recorder-build-5, build-app.sh + смоук --selftest ✅. Обкатано на реальной встрече (AirPods, 7+ мин).
// build 4 (2026-07-09): heartbeat-мониторинг рекордера (SwarmClient.heartbeat → meeting-heartbeat;
// сервер ловит оборванную запись / истечение токена). Тег recorder-build-4, build-app.sh ✅ (подпись валидна).
// build 3 (2026-06-30): бэкап аудио держится до публикации в базу + потолок 3 суток. Тег recorder-build-3.
const LATEST_BUILD = 19;

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
