/**
 * Самопроверка окружения при старте контейнера: запускается entrypoint'ом до того, как
 * внутрь пустят браузер. Проверяет то, что нельзя предполагать: null-sink создан, он
 * выставлен по умолчанию, monitor-source существует, XDG_RUNTIME_DIR задан.
 *
 * Отказ — громкий и с перечислением всех бед сразу: чинить по одной значит перезапускать
 * контейнер столько же раз.
 *
 *   node /app/src/container/verify-environment.ts
 */
import { readSettings } from "./environment.ts";
import { probeAudioEnvironment } from "./probe.ts";

async function main(): Promise<number> {
  const settings = readSettings(process.env);

  if (settings.display === undefined) {
    console.error("✘ DISPLAY не выставлен: Chromium в headed-режиме стартовать негде");
    return 1;
  }

  const report = await probeAudioEnvironment(settings);
  if (!report.ok) {
    console.error("✘ звуковое окружение контейнера непригодно для записи:");
    for (const problem of report.problems) console.error(`  · ${problem}`);
    return 1;
  }

  console.log(
    `✔ звук готов: sink «${settings.sinkName}», monitor-source «${report.monitorSource ?? "?"}», ` +
      `DISPLAY ${settings.display}`,
  );
  return 0;
}

process.exitCode = await main();
