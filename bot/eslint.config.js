// Линт с типами: единственная роль, которая ловит логику, а не стиль.
// Типизированные наборы применяются только к .ts — иначе прогон падает на первом
// нетипизированном файле (конфиге), и правило отключают целиком.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";

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
);
