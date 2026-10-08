/**
 * Процесс одной встречи внутри контейнера: точка входа, которую поднимает оркестратор.
 *
 *   node /app/src/orchestrator/container-main.ts
 *
 * Собирает настоящие зависимости вокруг `runMeeting`: Chromium с адаптером площадки,
 * клиент Swarm с очередью на томе, ffmpeg с monitor-source, поводок и сигналы остановки.
 * Решений здесь нет — они в `run-meeting.ts` и покрыты тестами; этот файл проверяется
 * живым прогоном контейнера (`smoke-orchestrator.ts`).
 *
 * Код выхода — договор с оркестратором: 0 — встреча закончилась одним из штатных исходов
 * (о каждом отказе уже ушла нотиса), не 0 — непредвиденный сбой, то есть смерть контейнера.
 */
import path from "node:path";

import { type Browser, type BrowserContext, chromium } from "playwright";

import { monitorSourceName } from "../container/audio.ts";
import { readSettings } from "../container/environment.ts";
import { SILENCE_MAX_VOLUME_DB, parseVolumeDetect } from "../container/loudness.ts";
import { probeAudioEnvironment } from "../container/probe.ts";
import { segmentSeconds } from "../container/segments.ts";
import { KonturAdapter, konturLaunchOptions } from "../kontur-adapter/kontur.ts";
import { MeetAdapter, meetLaunchOptions } from "../meet-adapter/meet.ts";
import { SwarmClient } from "../swarm-client/client.ts";
import { UploadQueue } from "../swarm-client/queue.ts";
import { RecordingSession } from "../swarm-client/session.ts";
import { SpeakerTimelineCollector } from "../swarm-client/speakers.ts";
import { claimFor } from "./claim-request.ts";
import { type MeetingConfig, readMeetingConfig } from "./config.ts";
import { LeaseTracker, readLease } from "./lease.ts";
import { BOT_PROFILE } from "./profile.ts";
import { inBackground } from "./background.ts";
import { NoticeClient } from "./notice-client.ts";
import { JournaledNotifier } from "./notices.ts";
import { ALIVE_TOUCH_MS, adoptOrphanedRuns, runQueueRoot, touchAlive } from "./run-directories.ts";
import { FfmpegRecorder } from "./recorder.ts";
import { type MeetingRecorder, runMeeting } from "./run-meeting.ts";
import { formatStateLine } from "./state-line.ts";
import { run } from "../container/shell.ts";

const LEASE_CHECK_MS = 10_000;
/**
Длина одного замера громкости для сторожа тишины.
*/
const LOUDNESS_SAMPLE_SECONDS = 5;

const log = (line: string): void => {
  console.log(`[scriba ${new Date().toISOString()}] ${line}`);
};

/**
 * Остановка по любой из трёх причин: SIGTERM от оркестратора, оборванный поводок,
 * потолок длительности. Все три кончаются одинаково — штатным выходом с выгрузкой.
 */
function stopSignals(config: MeetingConfig): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const stop = (reason: string): void => {
    if (controller.signal.aborted) return;
    log(`остановка: ${reason}`);
    controller.abort(reason);
  };

  process.on("SIGTERM", () => {
    stop("SIGTERM от оркестратора");
  });
  process.on("SIGINT", () => {
    stop("SIGINT");
  });

  const cap = setTimeout(() => {
    stop(`потолок длительности встречи ${String(config.maxMeetingMs / 60_000)} мин`);
  }, config.maxMeetingMs);

  const tracker = new LeaseTracker(Date.now());
  const checkLease = async (): Promise<void> => {
    const seq = await readLease(config.leaseDir);
    const now = Date.now();
    if (!tracker.observe(seq, now)) return;
    const silentMs = String(tracker.silentForMs(now));
    stop(
      `поводок оркестратора не двигается ${silentMs} мс — ` +
        "оркестратора нет, контейнер заканчивает встречу сам, чтобы не остаться сиротой",
    );
  };
  const leaseCheck = setInterval(() => {
    inBackground(checkLease, (error) => {
      log(`поводок не прочитан: ${String(error)}`);
    });
  }, LEASE_CHECK_MS);

  return {
    signal: controller.signal,
    dispose: (): void => {
      clearTimeout(cap);
      clearInterval(leaseCheck);
    },
  };
}

/**
 * ffmpeg поднимается только после самопроверки звука: писать в заведомо сломанном
 * окружении — это и есть запись тишины.
 */
function audioRecorder(
  config: MeetingConfig,
  session: RecordingSession,
  partsDirectory: string,
): MeetingRecorder {
  const settings = readSettings(process.env);
  let recorder: FfmpegRecorder | null = null;
  return {
    start: async (): Promise<void> => {
      const report = await probeAudioEnvironment(settings);
      if (!report.ok || report.monitorSource === null) {
        throw new Error(`звуковое окружение непригодно: ${report.problems.join("; ")}`);
      }
      recorder = new FfmpegRecorder({
        monitorSource: report.monitorSource,
        directory: partsDirectory,
        bitrateKbps: settings.bitrateKbps,
        segmentSeconds: config.segmentSeconds ?? segmentSeconds(settings.bitrateKbps),
        onPart: async (part, offset) => session.pushAudioPart(part, offset),
        log,
      });
      await recorder.start();
    },
    stop: async (): Promise<number> => (recorder === null ? 0 : recorder.stop()),
  };
}

/**
 * Тише ли порога то, что сейчас пишется: 5 с `volumedetect` по monitor-source параллельно с
 * ffmpeg записи (pulse отдаёт монитор нескольким читателям). `null` — замер не удался.
 */
async function sampleSilent(sinkName: string): Promise<boolean | null> {
  const result = await run("ffmpeg", [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-f",
    "pulse",
    "-i",
    monitorSourceName(sinkName),
    "-t",
    String(LOUDNESS_SAMPLE_SECONDS),
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const stats = parseVolumeDetect(result.stderr);
  return stats === null ? null : stats.maxDb < SILENCE_MAX_VOLUME_DB;
}

/**
 * Только для смоука: страница-двойник вместо настоящей площадки. Подменяется хост ссылки на
 * встречу — у Meet это meet.google.com, у Толка пространство `<имя>.ktalk.ru`.
 */
function smokeRoute(config: MeetingConfig): ((context: BrowserContext) => Promise<void>) | null {
  const page = config.smokeMeetPage;
  if (page === null) return null;
  const origin = new URL(config.joinUrl).origin;
  return async (context): Promise<void> => {
    log(`СМОУК: ${origin} подменён страницей ${page}`);
    await context.route(`${origin}/**`, async (route) =>
      route.fulfill({ path: page, contentType: "text/html; charset=utf-8" }),
    );
  };
}

/**
Адаптер площадки встречи: у каждой площадки свой, контракт у всех один.
*/
function adapterFor(
  config: MeetingConfig,
  browser: Browser,
  stop: AbortSignal,
): MeetAdapter | KonturAdapter {
  const prepareContext = smokeRoute(config);
  if (config.platform === "kontur") {
    log("вход в Контур.Толк — гостем, без микрофона и камеры");
    return new KonturAdapter({
      browser,
      guestRoom: BOT_PROFILE.guestRoom,
      stop,
      log: (line) => {
        log(`kontur: ${line}`);
      },
      ...(prepareContext !== null && { prepareContext }),
    });
  }
  if (config.accountStatePath !== null) log("вход в Meet — под аккаунтом бота");
  return new MeetAdapter({
    browser,
    ...(config.accountStatePath !== null && { storageStatePath: config.accountStatePath }),
    log: (line) => {
      log(`meet: ${line}`);
    },
    ...(prepareContext !== null && { prepareContext }),
  });
}

async function main(): Promise<number> {
  const config = readMeetingConfig(process.env);
  const settings = readSettings(process.env);
  const notifier = new JournaledNotifier(
    new NoticeClient({
      baseUrl: config.swarmUrl,
      token: config.token,
      onBehalfOf: config.onBehalfOf,
    }),
    log,
  );
  const client = new SwarmClient({
    baseUrl: config.swarmUrl,
    token: config.token,
    onBehalfOf: config.onBehalfOf,
  });
  // Очередь — на томе, у каждого запуска своя (см. run-directories.ts): общая на человека давала
  // двойную выгрузку, когда у него шли две встречи сразу.
  const personDirectory = path.join(settings.outputDirectory, "queue", String(config.onBehalfOf));
  const queueRoot = runQueueRoot(personDirectory, config.runId);
  await touchAlive(queueRoot);
  const aliveTimer = setInterval(() => {
    inBackground(
      async () => touchAlive(queueRoot),
      (error) => {
        log(`очередь: отметка alive не обновлена — ${String(error)}`);
      },
    );
  }, ALIVE_TOUCH_MS);
  const queue = new UploadQueue({
    root: queueRoot,
    client,
    onEvent: (event) => {
      const detail = event.detail === undefined ? "" : ` — ${event.detail}`;
      log(`очередь: ${event.kind} ${event.meetingId}${detail}`);
      if (event.kind === "dead-letter") {
        inBackground(
          async () =>
            notifier.notify({
              kind: "recording_lost",
              meetingId: event.meetingId,
              detail: event.detail ?? "dead-letter",
            }),
          (error) => {
            log(`нотиса recording_lost не ушла: ${String(error)}`);
          },
        );
      }
    },
  });
  // Хвосты прошлых встреч этого человека — в фоне, встречу они не задерживают.
  inBackground(
    async () => {
      await adoptOrphanedRuns({ personDirectory, ownRunId: config.runId, nowMs: Date.now(), log });
      await queue.drain();
    },
    (error) => {
      log(`очередь: прогон хвостов не удался — ${String(error)}`);
    },
  );

  const session = new RecordingSession({
    client,
    queue,
    version: config.version,
    // Основание встречи едет в заявку: событие календаря (T100) — календарной заявкой, приглашение
    // из веба (D017) — ручной.
    claim: claimFor({
      runId: config.runId,
      version: config.version,
      startedAt: new Date().toISOString(),
      basis: config.calendar ?? config.invite,
    }),
  });

  const stop = stopSignals(config);
  const browser = await chromium.launch(
    config.platform === "kontur" ? konturLaunchOptions() : meetLaunchOptions(),
  );
  const adapter = adapterFor(config, browser, stop.signal);
  try {
    const outcome = await runMeeting({
      joinUrl: config.joinUrl,
      displayName: config.displayName,
      adapter,
      session,
      recorder: audioRecorder(
        config,
        session,
        path.join(settings.outputDirectory, "parts", config.runId),
      ),
      timeline: new SpeakerTimelineCollector(adapter, {
        onError: (error) => {
          log(`опрос говорящего не удался: ${String(error)}`);
        },
      }),
      notifier,
      finalHeartbeat: async (meetingId, recordedSeconds) =>
        client.heartbeat({
          recording: false,
          version: config.version,
          on_call: false,
          ...(meetingId !== null && { meeting_id: meetingId }),
          // Вся длина записи — последнее слово бота в арбитраже meeting-claim (T155).
          ...(meetingId !== null &&
            recordedSeconds !== null && { recorded_seconds: recordedSeconds }),
        }),
      stop: stop.signal,
      timing: config.timing,
      log,
      reportMeetingId: (meetingId) => {
        console.log(formatStateLine({ meetingId }));
      },
      audioWatch: {
        sampleSilent: async () => sampleSilent(settings.sinkName),
        report: (audio) => {
          const title = config.calendar?.title;
          console.log(
            formatStateLine({
              audio,
              platform: config.platform,
              ...(title !== undefined && { title }),
            }),
          );
        },
      },
    });
    console.log(formatStateLine({ outcome }));
    return 0;
  } finally {
    stop.dispose();
    clearInterval(aliveTimer);
    await browser.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  // Непредвиденный сбой: код выхода не 0, и оркестратор прочитает это как смерть.
  log(`СБОЙ: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exitCode = 1;
}
// Таймеры очереди и ретраев не должны держать контейнер после конца встречи: это процесс
// одной встречи, и его выход — сигнал оркестратору.
// eslint-disable-next-line unicorn/no-process-exit -- процесс встречи и есть CLI контейнера
process.exit();
