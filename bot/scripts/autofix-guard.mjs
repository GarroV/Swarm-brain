// Охрана данных тестов от автофикса линта (issue #460).
//
// `eslint --fix` правит не только форму, но и значения: `unicorn/prefer-https` переписывает
// "http://…" на "https://…". В тесте такой литерал — намеренно испорченный вход, и правка
// превращает проверку в тавтологию молча. Конфиг линта снимает автофикс с файлов тестов;
// этот сторож доказывает, что снятие действует, а не просто написано.
//
// Как: к настоящему файлу теста дописывается заведомо «исправимый» литерал, и ESLint
// прогоняется с `fix: true`. Красный, если
//   - правило на пробе не сработало вовсе (проба мертва — сторож ничего бы не доказал);
//   - ESLint вернул исправленный текст (автофикс снова дотягивается до данных тестов).
import { readdirSync, readFileSync } from "node:fs";
import console from "node:console";
import path from "node:path";
import process from "node:process";
import { ESLint } from "eslint";

const PROBE_RULE = "unicorn/prefer-https";
const PROBE = '\nexport const autofixGuardProbe = "http://example.com/";\n';

const eslint = new ESLint({ fix: true });
const [relative] = readdirSync("src", { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".test.ts"))
  .toSorted();
const target = relative === undefined ? undefined : path.resolve("src", relative);

if (target === undefined) {
  console.error("✘ сторож автофикса: файлов src/**/*.test.ts нет — проверять нечем");
  process.exit(1);
}

const [result] = await eslint.lintText(readFileSync(target, "utf8") + PROBE, { filePath: target });
// С `fix: true` исправленные замечания исчезают из messages, поэтому сперва — не переписан ли
// текст, и только потом — жива ли проба.
const fired = result.messages.some((m) => m.ruleId === PROBE_RULE);

if (result.output !== undefined) {
  console.error(`✘ сторож автофикса: eslint --fix переписал бы файл теста ${target}`);
  console.error(
    "  автофикс снова трогает данные проверок — верните процессор для src/**/*.test.ts",
  );
  console.error("  в bot/eslint.config.js (testDataProcessor)");
  process.exit(1);
}
if (!fired) {
  console.error(`✘ сторож автофикса: правило ${PROBE_RULE} не сработало на пробе в ${target}`);
  console.error("  проба мертва — либо правило выключено, либо файл тестов выпал из линта");
  process.exit(1);
}
console.log(
  `✔ сторож автофикса: ${PROBE_RULE} сработал на пробе, текст теста не тронут (${target})`,
);
