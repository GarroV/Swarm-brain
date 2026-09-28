/**
 * Выгрузка входа аккаунта бота из окна входа (T175). Запускается в контейнере окна входа
 * (`bot/container/login/login.sh`) после того, как человек вошёл в Google и закрыл браузер:
 *
 *   node /app/src/orchestrator/login-export.ts <каталог профиля> <файл входа>
 *
 * Пароль и второй фактор сюда не попадают никогда: их человек вводит в окне браузера сам, а
 * этот процесс только читает из профиля куки уже вошедшей сессии. Значения кук не печатаются:
 * в журнал уходят лишь их число и вердикт.
 *
 * Громкие отказы, а не «сохранено»: в профиле нет сессии Google (окно закрыли, не войдя) или
 * Meet под этим входом всё равно предлагает войти. Файл пишется атомарно (временный → rename),
 * права 0600, прежний вход заменяется только удачной выгрузкой.
 */
import { chmod, rename, writeFile } from "node:fs/promises";

import { chromium } from "playwright";

import { SNAPSHOT_CSS, collectMeetSnapshot } from "../meet-adapter/dom.ts";
import { meetLaunchOptions } from "../meet-adapter/meet.ts";
import { hasGoogleSession } from "./account.ts";

const MEET_HOME = "https://meet.google.com/?hl=en";
const NAVIGATION_TIMEOUT_MS = 60_000;
const SETTLE_MS = 3000;
const OWNER_ONLY = 0o600;

const say = (line: string): void => {
  console.log(`[login-export] ${line}`);
};

async function main(profileDirectory: string, outFile: string): Promise<number> {
  const options = meetLaunchOptions();
  const context = await chromium.launchPersistentContext(profileDirectory, {
    ...options,
    // Тот же способ хранения кук, что у окна входа: иначе профиль не расшифруется.
    args: [...(options.args ?? []), "--password-store=basic"],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(MEET_HOME, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    const snapshot = await page.evaluate(collectMeetSnapshot, SNAPSHOT_CSS);

    const state = await context.storageState();
    if (!hasGoogleSession(state.cookies)) {
      say("✘ в профиле нет сессии Google — окно закрыли, не войдя. Вход НЕ сохранён");
      return 1;
    }
    if (snapshot.host === "accounts.google.com" || snapshot.hasSignInPrompt) {
      say(`✘ Meet под этим входом предлагает войти (${snapshot.host}). Вход НЕ сохранён`);
      return 1;
    }

    const temporary = `${outFile}.new`;
    await writeFile(temporary, JSON.stringify(state), { mode: OWNER_ONLY });
    await chmod(temporary, OWNER_ONLY);
    await rename(temporary, outFile);
    say(`✔ вход сохранён: ${String(state.cookies.length)} кук, Meet открывается без «Sign in»`);
    return 0;
  } finally {
    await context.close();
  }
}

const [profileDirectory, outFile] = process.argv.slice(2);
if (profileDirectory === undefined || outFile === undefined) {
  say("использование: login-export.ts <каталог профиля> <файл входа>");
  process.exitCode = 2;
} else {
  try {
    process.exitCode = await main(profileDirectory, outFile);
  } catch (error) {
    // Сообщение Playwright не содержит кук; стек — чтобы было что чинить.
    say(`✘ СБОЙ выгрузки: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
