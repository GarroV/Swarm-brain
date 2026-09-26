/**
 * ffmpeg, пишущий встречу с monitor-source: процесс и его остановка.
 *
 * Аргументы записи не выдумываются здесь — их собирает `buildRecordArguments` блока
 * container, тот же, которым пишет смоук записи звука. Здесь только процесс: запустить,
 * убедиться, что он не умер сразу, по ходу отдавать закрытые части в очередь, в конце
 * остановить SIGINT'ом (ffmpeg по нему дописывает последнюю часть и закрывает список).
 *
 * Проверяется живым прогоном в контейнере, а не юнит-тестом: логика разбора списка и
 * однократной отдачи частей вынесена в `parts.ts` и покрыта там.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { openAsBlob } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { buildRecordArguments } from "../container/segments.ts";
import { inBackground } from "./background.ts";
import { PartStager } from "./parts.ts";
import type { MeetingRecorder } from "./run-meeting.ts";

const STARTUP_GRACE_MS = 2000;
const STAGE_POLL_MS = 10_000;
const STOP_TIMEOUT_MS = 20_000;
const STDERR_TAIL = 2000;

export interface FfmpegRecorderOptions {
  readonly monitorSource: string;
  readonly directory: string;
  readonly bitrateKbps: number;
  readonly segmentSeconds: number;
  readonly onPart: (part: Blob, offset: number) => Promise<void>;
  readonly log: (line: string) => void;
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

export class FfmpegRecorder implements MeetingRecorder {
  private child: ChildProcess | null = null;

  private exited: Promise<number | null> = Promise.resolve(null);

  private stderr = "";

  private poll: NodeJS.Timeout | undefined;

  private readonly stager: PartStager;

  private readonly listPath: string;

  constructor(private readonly options: FfmpegRecorderOptions) {
    this.listPath = path.join(options.directory, "parts.csv");
    this.stager = new PartStager({
      readList: async () => readOrNull(this.listPath),
      stage: async (entry) => {
        const file = path.join(options.directory, entry.file);
        await options.onPart(await openAsBlob(file), entry.start);
        // Часть скопирована в очередь — второй экземпляр на томе не нужен.
        await rm(file, { force: true });
      },
    });
  }

  async start(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true });
    const argv = buildRecordArguments({
      monitorSource: this.options.monitorSource,
      outputPattern: path.join(this.options.directory, "part-%03d.m4a"),
      bitrateKbps: this.options.bitrateKbps,
      segmentSeconds: this.options.segmentSeconds,
      segmentListPath: this.listPath,
    });
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- ffmpeg в PATH — контракт образа блока container
    const child = spawn("ffmpeg", argv, { stdio: ["ignore", "ignore", "pipe"] });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL);
    });
    this.exited = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => {
        resolve(code);
      });
    });

    // ffmpeg с неверным источником умирает за доли секунды. Узнать это здесь — значит
    // сказать «звук не пишется» сразу, а не после встречи.
    const early = await Promise.race([
      this.exited,
      new Promise<"alive">((resolve) => {
        setTimeout(() => {
          resolve("alive");
        }, STARTUP_GRACE_MS);
      }),
    ]);
    if (early !== "alive") {
      throw new Error(`ffmpeg вышел сразу (код ${String(early)}): ${this.stderr.trim()}`);
    }
    this.options.log(
      `ffmpeg пишет ${this.options.monitorSource} частями по ${String(this.options.segmentSeconds)} с`,
    );

    this.poll = setInterval(() => {
      inBackground(
        async () => this.stager.flush(),
        (error) => {
          this.options.log(`часть не отдана в очередь, повторим: ${String(error)}`);
        },
      );
    }, STAGE_POLL_MS);
  }

  async stop(): Promise<number> {
    clearInterval(this.poll);
    const child = this.child;
    if (child !== null && child.exitCode === null) {
      child.kill("SIGINT");
      const killer = setTimeout(() => {
        child.kill("SIGKILL");
      }, STOP_TIMEOUT_MS);
      const code = await this.exited;
      clearTimeout(killer);
      this.options.log(`ffmpeg остановлен, код ${String(code)}`);
    } else if (child !== null) {
      // ffmpeg умер сам посреди встречи: закрытые части спасаем, но молчать об этом нельзя.
      this.options.log(
        `ffmpeg завершился сам посреди записи (код ${String(child.exitCode)}): ${this.stderr.trim()}`,
      );
    }
    await this.stager.flush();
    return this.stager.count;
  }
}
