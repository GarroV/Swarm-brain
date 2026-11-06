/**
 * Пробный заход в Meet под аккаунтом бота (#1140): процесс в контейнере встречи, без встречи.
 * Открывает лендинг Meet с копией входа, выносит вердикт (`login-probe.ts`) и, если вход жив,
 * выгружает обновлённый — так же, как конец встречи. Поднимает оркестратор раз в сутки.
 *
 *   node /app/src/orchestrator/probe-main.ts
 *
 * Исход идёт строкой состояния в журнал (единственный канал контейнер → оркестратор). Код
 * выхода: 0 — вердикт вынесен (в том числе «вход слетел»), не 0 — проба не состоялась.
 * Значения кук не печатаются.
 */
import { chmod } from "node:fs/promises";

import { chromium } from "playwright";

import { SNAPSHOT_CSS, collectMeetSnapshot } from "../meet-adapter/dom.ts";
import { meetLaunchOptions } from "../meet-adapter/meet.ts";
import { MEETING_ENV } from "./config.ts";
import { probeVerdict } from "./login-probe.ts";
import { formatStateLine } from "./state-line.ts";

const MEET_HOME = "https://meet.google.com/?hl=en";
const NAVIGATION_TIMEOUT_MS = 60_000;
const SETTLE_MS = 5000;
const OWNER_ONLY = 0o600;

const log = (line: string): void => {
  console.log(`[probe ${new Date().toISOString()}] ${line}`);
};

async function main(): Promise<number> {
  const statePath = (process.env[MEETING_ENV.accountState] ?? "").trim();
  const outPath = (process.env[MEETING_ENV.accountOutput] ?? "").trim();
  if (statePath === "" || outPath === "") {
    log("нет SCRIBA_GOOGLE_STATE или SCRIBA_GOOGLE_STATE_OUT — пробовать нечего");
    return 1;
  }
  const browser = await chromium.launch(meetLaunchOptions());
  try {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1280, height: 720 },
      storageState: statePath,
    });
    const page = await context.newPage();
    await page.goto(MEET_HOME, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    const verdict = probeVerdict(await page.evaluate(collectMeetSnapshot, SNAPSHOT_CSS));
    log(`проба: ${verdict.outcome} — ${verdict.reason}`);
    if (verdict.outcome === "probe_ok") {
      await context.storageState({ path: outPath });
      await chmod(outPath, OWNER_ONLY);
    }
    console.log(formatStateLine({ outcome: verdict.outcome }));
    return verdict.outcome === "probe_inconclusive" ? 1 : 0;
  } finally {
    await browser.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  log(`СБОЙ пробы: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
// eslint-disable-next-line unicorn/no-process-exit -- процесс пробы и есть CLI контейнера
process.exit();
