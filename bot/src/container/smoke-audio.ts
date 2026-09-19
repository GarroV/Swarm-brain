/**
 * Смоук записи звука — главная проверка блока.
 *
 * Контейнер, который «работает», но пишет тишину, неотличим от работающего, пока не станет
 * поздно. Поэтому смоук делает всё то же, что делает бот на встрече: поднимает Chromium в
 * том самом окружении, даёт странице издать звук, пишет его ffmpeg'ом с monitor-source,
 * режет на части и меряет каждую. Тишина, непрочитанная часть и часть сверх лимита — отказ.
 *
 * Запускается внутри контейнера:
 *   node /app/src/container/smoke-audio.ts
 *
 * Ручки самопроверки (в бою не нужны, перечислены в bot/container/.env.example):
 *   SCRIBA_SMOKE_PAGE        — какую страницу открыть (по умолчанию звучащая tone.html);
 *   SCRIBA_SMOKE_EXPECT      — `sound` (по умолчанию) или `silence`: что считать успехом;
 *   SCRIBA_SMOKE_FORCE_MUTE  — `1`: запустить Chromium с аргументами Playwright по умолчанию,
 *                              то есть с --mute-audio. Нужна ровно для одного: доказать, что
 *                              смоук ловит ту самую граблю, ради которой существует.
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { chromiumLaunchOptions } from "./browser.ts";
import { readSettings } from "./environment.ts";
import { judgeLoudness } from "./loudness.ts";
import { measureLoudness, probeAudioEnvironment, probeAudioFile } from "./probe.ts";
import { INGEST_PART_MAX_BYTES, buildRecordArguments } from "./segments.ts";
import { run } from "./shell.ts";

class SmokeFailure extends Error {}

const fail = (message: string): never => {
  throw new SmokeFailure(message);
};

async function measureParts(directory: string): Promise<number> {
  const names = await readdir(directory);
  const parts = names
    .filter((name) => name.endsWith(".m4a"))
    .toSorted((left, right) => left.localeCompare(right));
  if (parts.length === 0) fail("ffmpeg не создал ни одной части");
  console.log(`· частей: ${String(parts.length)} (${parts.join(", ")})`);

  let loudest = -Infinity;
  for (const name of parts) {
    const file = path.join(directory, name);

    const facts = await probeAudioFile(file);
    if (facts === null) {
      fail(`часть «${name}» не открывается самостоятельно: ffprobe её не прочитал`);
      continue;
    }
    if (facts.bytes > INGEST_PART_MAX_BYTES) {
      fail(
        `часть «${name}» — ${String(facts.bytes)} байт, больше лимита meeting-ingest ` +
          `(${String(INGEST_PART_MAX_BYTES)}): сервер её отобьёт`,
      );
    }
    if (facts.durationSeconds <= 0) fail(`часть «${name}» нулевой длины`);

    const stats = await measureLoudness(file);
    const verdict = judgeLoudness(stats);
    console.log(
      `  · ${name}: ${String(facts.bytes)} Б, ${facts.durationSeconds.toFixed(2)} с, ` +
        `${facts.codec} — ${verdict.reason}`,
    );
    if (stats !== null && stats.maxDb > loudest) loudest = stats.maxDb;
  }

  return loudest;
}

async function main(): Promise<number> {
  const settings = readSettings(process.env);
  const page = process.env.SCRIBA_SMOKE_PAGE ?? "file:///opt/scriba/tone.html";
  const shouldExpectSilence = process.env.SCRIBA_SMOKE_EXPECT === "silence";
  const shouldForceMute = process.env.SCRIBA_SMOKE_FORCE_MUTE === "1";
  const seconds = Number(process.env.SCRIBA_SMOKE_SECONDS ?? "9");
  const segment = Number(process.env.SCRIBA_SMOKE_SEGMENT_SECONDS ?? "3");

  const directory = path.join(settings.outputDirectory, "smoke");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  // 1. Окружение: проверять запись в заведомо сломанном окружении бессмысленно.
  const environmentReport = await probeAudioEnvironment(settings);
  const monitorSource = environmentReport.monitorSource;
  if (monitorSource === null || !environmentReport.ok) {
    fail(`звуковое окружение непригодно:\n  · ${environmentReport.problems.join("\n  · ")}`);
    return 1;
  }
  console.log(`· окружение: sink «${settings.sinkName}», monitor-source «${monitorSource}»`);

  // 2. Браузер — ровно так, как его будет поднимать адаптер площадки.
  const planned = chromiumLaunchOptions();
  console.log(
    shouldForceMute
      ? "· браузер: НАМЕРЕННО с аргументами Playwright по умолчанию (--mute-audio на месте)"
      : "· браузер: --mute-audio снят через ignoreDefaultArgs",
  );
  const browser = await chromium.launch({
    headless: planned.headless,
    args: [...planned.args],
    // Пустой список = ничего не игнорируем, то есть Playwright оставляет свой --mute-audio.
    ignoreDefaultArgs: shouldForceMute ? [] : [...planned.ignoreDefaultArgs],
  });

  let loudest: number;
  try {
    const tab = await browser.newPage();
    await tab.goto(page);
    // Звук должен успеть пойти до того, как ffmpeg начнёт писать.
    await tab.waitForTimeout(1000);

    // 3. Запись — теми же аргументами, которыми будет писаться встреча.
    console.log(`· пишу ${String(seconds)} с частями по ${String(segment)} с`);
    const recording = await run(
      "ffmpeg",
      buildRecordArguments({
        monitorSource,
        outputPattern: path.join(directory, "part-%03d.m4a"),
        bitrateKbps: settings.bitrateKbps,
        segmentSeconds: segment,
        durationSeconds: seconds,
        segmentListPath: path.join(directory, "parts.csv"),
      }),
    );
    if (recording.code !== 0) {
      fail(`ffmpeg вышел с кодом ${String(recording.code)}: ${recording.stderr.trim()}`);
    }

    // 4. Части: каждая обязана открываться сама и влезать в лимит сервера.
    loudest = await measureParts(directory);
  } finally {
    await browser.close();
  }

  // 5. Вердикт по всей записи.
  const overall = judgeLoudness(
    loudest === -Infinity ? null : { meanDb: loudest, maxDb: loudest, samples: 1 },
  );

  if (shouldExpectSilence) {
    if (overall.ok) {
      fail(
        `ждали тишину, а звук есть — контейнер слышит то, чего слышать не должен: ${overall.reason}`,
      );
    }
    console.log(`✔ тишина подтверждена, как и ожидалось: ${overall.reason}`);
    return 0;
  }

  if (!overall.ok) fail(overall.reason);
  console.log(`✔ СМОУК ЗАПИСИ ПРОЙДЕН: ${overall.reason}`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✘ СМОУК ЗАПИСИ НЕ ПРОЙДЕН: ${message}`);
  process.exitCode = 1;
}
