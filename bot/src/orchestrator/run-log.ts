/**
 * Журнал каждого запуска бота встреч на диске службы (#832).
 *
 * Журнал контейнера встречи живёт только в самом контейнере, а тот удаляется по выходе
 * (`AutoRemove`). В журнале службы остаются две строки — «поднят» и «закончил», — и разобрать
 * потом, что бот видел на встрече, нечем: так 07.10.2026 не удалось доказать, почему бот записал
 * 44 минуты тишины (#825). Поэтому каждая строка контейнера дописывается в `<runId>.log` с
 * отметкой времени, а по выходе — итоговая строка с кодом, исходом и встречей.
 *
 * Хранится `keep` последних файлов, старые удаляются. Диск журнала — не повод сорвать встречу:
 * любая ошибка записи сообщается в журнал службы один раз и дальше молча пропускается.
 */
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const DEFAULT_KEEP_RUN_LOGS = 500;
const SUFFIX = ".log";

export interface RunLogWriter {
  line: (text: string) => void;
}

export interface RunLogsOptions {
  readonly directory: string;
  readonly keep?: number;
  readonly log?: (line: string) => void;
  readonly now?: () => Date;
}

function ignore(): void {
  // журнал службы не задан — сообщать некуда
}

export class RunLogs {
  private readonly directory: string;
  private readonly keep: number;
  private readonly log: (line: string) => void;
  private readonly now: () => Date;

  constructor(options: RunLogsOptions) {
    this.directory = options.directory;
    this.keep = options.keep ?? DEFAULT_KEEP_RUN_LOGS;
    this.log = options.log ?? ignore;
    this.now = options.now ?? (() => new Date());
    mkdirSync(this.directory, { recursive: true });
  }

  /**
  Путь журнала запуска — его же печатает служба, чтобы от встречи дойти до файла.
  */
  pathFor(runId: string): string {
    return path.join(this.directory, `${path.basename(runId)}${SUFFIX}`);
  }

  open(runId: string): RunLogWriter {
    const file = this.pathFor(runId);
    let isBroken = false;
    return {
      line: (text: string) => {
        if (isBroken) return;
        try {
          appendFileSync(file, `${this.now().toISOString()} ${text}\n`);
        } catch (error) {
          isBroken = true;
          this.log(`журнал запуска ${runId} не пишется (${file}): ${String(error)}`);
        }
      },
    };
  }

  /**
  Оставить `keep` самых свежих журналов.
  */
  prune(): void {
    try {
      const files = readdirSync(this.directory)
        .filter((name) => name.endsWith(SUFFIX))
        .map((name) => {
          const full = path.join(this.directory, name);
          return { full, mtime: statSync(full).mtimeMs };
        })
        .toSorted((a, b) => b.mtime - a.mtime);
      for (const old of files.slice(this.keep)) unlinkSync(old.full);
    } catch (error) {
      this.log(`журналы запусков не чистятся (${this.directory}): ${String(error)}`);
    }
  }
}
