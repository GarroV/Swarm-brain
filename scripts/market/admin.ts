// Решения админа «Анализа рынка» без входа в веб — по токену админа (market-ingest).
//   deno run -A scripts/market/admin.ts import HR ~/Documents/workbench/private/market/HR.import.json
//   deno run -A scripts/market/admin.ts accept RO,EE,RS
// import — то же, что кнопка «Импорт снимка»; accept — «Принять все» находки «новая точка»
// (точки встают как «не проверено»). Нужны MARKET_INGEST_URL и MARKET_ADMIN_TOKEN — не токен
// сборщика: тот лежит в Actions и решений принимать не может.
// Снимок ручной части лежит вне git: репозиторий публичный.
import { postIngest } from "./lib.ts";

const [cmd, countries, file] = Deno.args;
const started_at = new Date().toISOString();
if (cmd === "import" && countries && file) {
  const snapshot = JSON.parse(await Deno.readTextFile(file));
  console.log(
    JSON.stringify(
      await postIngest(
        {
          source: "snapshot",
          country: countries,
          started_at,
          snapshot,
        },
        "MARKET_ADMIN_TOKEN",
      ),
    ),
  );
} else if (cmd === "accept" && countries) {
  for (const cc of countries.toUpperCase().split(",")) {
    const r = await postIngest(
      { source: "accept_new", country: cc, started_at },
      "MARKET_ADMIN_TOKEN",
    );
    console.log(cc, JSON.stringify(r));
  }
} else {
  console.error("usage: admin.ts import <CC> <snapshot.json> | accept <CC,CC>");
  Deno.exit(2);
}
