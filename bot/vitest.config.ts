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
      exclude: ["src/container/verify-environment.ts", "src/container/smoke-audio.ts"],
    },
  },
});
