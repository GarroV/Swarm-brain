// Линт с типами: единственная роль, которая ловит логику, а не стиль.
// Типизированные наборы применяются только к .ts — иначе прогон падает на первом
// нетипизированном файле (конфиге), и правило отключают целиком.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";

// Автофикс не трогает файлы тестов. Их литералы — это данные проверки, часто намеренно
// испорченный вход: 2026-09 `unicorn/prefer-https` молча переписал "http://…" в тесте
// отказа от ссылки без TLS на "https://…", и проверка стала тавтологией (issue #460).
// Процессор без `supportsAutofix` — штатный способ ESLint: замечания остаются и валят
// линт, а `--fix` их не применяет, так что решение принимает человек, а не правило.
// Охрану держит `scripts/autofix-guard.mjs` — он краснеет, если автофикс снова дотянется.
const testDataProcessor = {
  meta: { name: "scriba/no-autofix-in-tests" },
  preprocess: (text) => [text],
  postprocess: (messages) => messages.flat(),
};

export default tseslint.config(
  { ignores: ["coverage/**", "node_modules/**", "dist/**", "reports/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { sonarjs, unicorn },
    rules: {
      ...sonarjs.configs.recommended.rules,
      ...unicorn.configs.recommended.rules,
      // Имена файлов проекта — kebab-case; правило unicorn по умолчанию требует camelCase.
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      // Конфиги Playwright и ffmpeg читаются лучше с явным null, чем с undefined.
      "unicorn/no-null": "off",
    },
  },
  { files: ["src/**/*.test.ts"], processor: testDataProcessor },
);
