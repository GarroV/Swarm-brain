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
    },
  },
});
