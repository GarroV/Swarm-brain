import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Машинный отчёт прогона: приёмка читает его, а не код возврата — код одинаков
    // и при двухстах выполненных проверках, и при нуле зарегистрированных.
    reporters: ["default", ["junit", { outputFile: "../reports/check.xml" }]],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      // Программы, которые исполняются только внутри контейнера: у них верхнеуровневый
      // await, запуск браузера и ffmpeg. Их проверяет живой смоук записи, а не юнит-тест,
      // и включение их в покрытие меряло бы не логику, а наличие контейнера.
      exclude: [
        "src/container/verify-environment.ts",
        "src/container/smoke-audio.ts",
        "src/meet-adapter/smoke-meet.ts",
        // Те же основания, что выше, но для браузера: `dom.ts` исполняется В СТРАНИЦЕ
        // (Playwright передаёт функцию исходником), `meet.ts` — это Playwright вокруг уже
        // проверенных чистых функций. Их проверяет живой смоук `smoke-meet.ts` в контейнере,
        // а юнит-мера здесь мерила бы наличие браузера, а не логику.
        "src/meet-adapter/dom.ts",
        "src/meet-adapter/meet.ts",
        // Процессы вокруг уже проверенных правил блока orchestrator: точка входа контейнера
        // (Chromium, ffmpeg, сигналы), процесс ffmpeg и перевод вызовов в dockerode. Правила
        // (исходы встречи, смерть, сироты, разбор частей) живут в соседних файлах и покрыты
        // тестами; эти три проверяет живой смоук против настоящего Docker.
        "src/orchestrator/container-main.ts",
        // Точка входа службы: разбор окружения и сигналы вокруг проверенных правил
        // (invite-trigger, invite-service). Её гоняет живой смоук — сценарии invite, kontur, race.
        "src/orchestrator/orchestrator-main.ts",
        "src/orchestrator/recorder.ts",
        "src/orchestrator/docker-engine.ts",
        "src/orchestrator/smoke-orchestrator.ts",
        "src/orchestrator/smoke-notices.ts",
      ],
    },
  },
});
