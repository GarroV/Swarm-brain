/**
 * Вход аккаунта бота в контейнер встречи (T175).
 *
 * Бот заходит в Meet под своим аккаунтом Google: гостя без аккаунта домен с доступом «Trusted»
 * не пускает даже в лобби. Владелец один раз входит за бота сам (пароль и второй фактор бот не
 * видит никогда, см. `bot/container/login/`), вход сохраняется файлом Playwright storageState в
 * каталоге состояния стенда — вне git и вне образа.
 *
 * Здесь — как этот файл попадает в контейнер, и только это:
 *  - в каждый контейнер едет СВОЯ копия, смонтированная одним файлом только на чтение: каталог
 *    состояния контейнер не видит вовсе, а копии соседей — тем более;
 *  - копии живут в отдельном каталоге, а не рядом с поводком: каталог поводка монтируется в
 *    каждый контейнер целиком, и копия в нём досталась бы всем;
 *  - копия убирается с выходом контейнера, а оставшиеся от упавшего оркестратора — при
 *    следующем старте;
 *  - файла нет — бот идёт гостем, как до T175. Файл есть, но не читается как вход — громкий
 *    отказ запуска: молча пойти гостем значило бы получить «не пустили» вместо «почините вход».
 *
 * Содержимое файла — доступ к чужому аккаунту. Оно не попадает ни в журнал, ни в текст ошибки.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
Куда копия входа монтируется внутри контейнера встречи.
*/
export const ACCOUNT_STATE_TARGET = "/run/scriba-account/google-state.json";

/**
Имя запуска — это имя файла копии, поэтому только безопасные символы.
*/
const RUN_ID_PATTERN = /^[\w-]{1,80}$/u;
const COPY_SUFFIX = ".json";
/**
Копия только на чтение: контейнеру её хватает, а переписать вход ему незачем.
*/
const COPY_MODE = 0o444;
const COPIES_DIRECTORY_MODE = 0o700;

export interface AccountCopies {
  /**
   * Копия входа для запуска: путь к ней (тот, что монтируется в контейнер) или `null`, если
   * вход не сохранён и бот идёт гостем.
   */
  prepare(runId: string): Promise<string | null>;
  release(runId: string): Promise<void>;
  /**
   * Убрать копии запусков, которых больше нет (оркестратор упал, не успев прибрать).
   */
  sweep(liveRunIds: ReadonlySet<string>): Promise<void>;
}

export interface FileAccountCopiesOptions {
  /**
  Сохранённый вход (storageState). Читается, но не меняется.
  */
  readonly stateFile: string;
  /**
   * Каталог копий. Путь обязан совпадать с тем, каким его видит демон Docker: копия
   * монтируется в контейнер по этому же пути (тот же приём, что у поводка).
   */
  readonly copiesDirectory: string;
  readonly log?: (line: string) => void;
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}

function validRunId(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`имя запуска «${runId}» не годится в имя файла копии входа`);
  }
  return runId;
}

/**
 * Файл похож на вход Playwright: объект с непустым списком cookies. Большего не проверить без
 * Google, а меньшего хватит, чтобы не подложить Chromium обрезок или чужой файл.
 */
function isSignInShaped(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { cookies?: unknown };
    return Array.isArray(parsed.cookies) && parsed.cookies.length > 0;
  } catch {
    return false;
  }
}

export class FileAccountCopies implements AccountCopies {
  readonly #options: FileAccountCopiesOptions;

  constructor(options: FileAccountCopiesOptions) {
    this.#options = options;
  }

  #copyPath(runId: string): string {
    return path.join(this.#options.copiesDirectory, `${validRunId(runId)}${COPY_SUFFIX}`);
  }

  async prepare(runId: string): Promise<string | null> {
    const target = this.#copyPath(runId);
    let raw: string;
    try {
      raw = await readFile(this.#options.stateFile, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        this.#options.log?.("вход аккаунта бота не сохранён — бот идёт гостем");
        return null;
      }
      throw new Error("сохранённый вход аккаунта бота не читается", { cause: error });
    }
    if (!isSignInShaped(raw)) {
      // Текст ошибки уходит человеку в «scriba could not start…»: без содержимого файла.
      throw new Error("the bot's saved Google sign-in is damaged — sign the bot in again");
    }

    await mkdir(this.#options.copiesDirectory, { recursive: true, mode: COPIES_DIRECTORY_MODE });
    await writeFile(target, raw, { mode: COPY_MODE, flag: "wx" });
    return target;
  }

  async release(runId: string): Promise<void> {
    await rm(this.#copyPath(runId), { force: true });
  }

  async sweep(liveRunIds: ReadonlySet<string>): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.#options.copiesDirectory);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    for (const name of names) {
      if (!name.endsWith(COPY_SUFFIX)) continue;
      const runId = name.slice(0, -COPY_SUFFIX.length);
      if (liveRunIds.has(runId)) continue;
      await rm(path.join(this.#options.copiesDirectory, name), { force: true });
      this.#options.log?.(`убрана копия входа запуска ${runId}: контейнера больше нет`);
    }
  }
}
