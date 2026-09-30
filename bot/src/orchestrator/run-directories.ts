/**
 * Каталоги очередей на томе: у каждого запуска своя очередь, осиротевшие забирает следующий.
 *
 * Почему не одна очередь на человека. Живой прогон 2026-09-26: два контейнера одного
 * человека делили один корень очереди, и каждый выгружал и свою запись, и соседскую — одна
 * встреча уходила в meeting-ingest дважды. Защита `UploadQueue` от повторного входа живёт
 * внутри процесса и между контейнерами не работает.
 *
 * Поэтому корень очереди — `<том>/queue/<человек>/<запуск>`. Запуск раз в несколько секунд
 * трогает файл `alive`. Новый контейнер того же человека на старте смотрит соседей: у кого
 * `alive` давно не трогали, тот умер или закончился, и его неотправленные встречи
 * переезжают в очередь нового запуска (`rename` каталога встречи атомарен: из двух
 * одновременно стартовавших контейнеров встречу получит ровно один). Каталог `failed`
 * (dead-letter) не трогается — он для человека, а не для автоматики.
 */
import { mkdir, readdir, rename, rm, rmdir, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

const ALIVE_FILE = "alive";
const PENDING = "pending";
export const ALIVE_TOUCH_MS = 10_000;
/**
 * Сосед молчит дольше — его очередь бесхозная. С запасом над шагом касания.
 */
const ORPHAN_AFTER_MS = 5 * 60_000;

export function runQueueRoot(personDirectory: string, runId: string): string {
  return path.join(personDirectory, runId);
}

/**
 * Отметиться живым: создать или обновить `alive`.
 */
export async function touchAlive(runDirectory: string, now: Date = new Date()): Promise<void> {
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(runDirectory, ALIVE_FILE);
  try {
    await utimes(file, now, now);
  } catch {
    await writeFile(file, "", { mode: 0o600 });
    await utimes(file, now, now);
  }
}

async function lastAliveMs(runDirectory: string): Promise<number | null> {
  try {
    const info = await stat(path.join(runDirectory, ALIVE_FILE));
    return info.mtimeMs;
  } catch {
    return null;
  }
}

async function listOrEmpty(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

async function listRunDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function isOrphan(
  runDirectory: string,
  nowMs: number,
  thresholdMs: number,
): Promise<boolean> {
  const alive = await lastAliveMs(runDirectory);
  // Отметки нет вовсе — это не запуск, а что-то чужое в каталоге: не трогаем.
  return alive !== null && nowMs - alive > thresholdMs;
}

async function didMoveMeeting(
  from: string,
  to: string,
  log: (line: string) => void,
): Promise<boolean> {
  try {
    await rename(from, to);
    log(
      `очередь: встреча ${path.basename(from)} из осиротевшего запуска перенесена к себе (${from})`,
    );
    return true;
  } catch (error) {
    // Сосед-стартовавший успел первым — встреча уже у него. Это исход, а не сбой.
    log(`очередь: ${from} не перенесена: ${String(error)}`);
    return false;
  }
}

/**
 * Убрать то, что осталось от запуска после переезда: пустой `pending`, а если кроме
 * `alive` ничего нет — каталог целиком. `failed` остаётся следом для человека.
 */
async function tidyRun(runDirectory: string): Promise<void> {
  try {
    await rmdir(path.join(runDirectory, PENDING));
  } catch {
    // Не пуст (переезд встречи не удался) или его не было — оставляем как есть.
  }
  const left = await listOrEmpty(runDirectory);
  if (left.length === 1 && left[0] === ALIVE_FILE) {
    await rm(runDirectory, { recursive: true, force: true });
  }
}

async function adoptRun(
  runDirectory: string,
  ownPending: string,
  log: (line: string) => void,
): Promise<number> {
  const pending = path.join(runDirectory, PENDING);
  const meetings = await listOrEmpty(pending);
  let moved = 0;
  for (const meeting of meetings) {
    await mkdir(ownPending, { recursive: true, mode: 0o700 });
    if (await didMoveMeeting(path.join(pending, meeting), path.join(ownPending, meeting), log))
      moved += 1;
  }
  await tidyRun(runDirectory);
  return moved;
}

/**
 * Перенести неотправленные встречи осиротевших запусков в очередь своего. Возвращает,
 * сколько встреч переехало.
 */
export async function adoptOrphanedRuns(options: {
  readonly personDirectory: string;
  readonly ownRunId: string;
  readonly nowMs: number;
  readonly orphanAfterMs?: number;
  readonly log: (line: string) => void;
}): Promise<number> {
  const threshold = options.orphanAfterMs ?? ORPHAN_AFTER_MS;
  const ownPending = path.join(runQueueRoot(options.personDirectory, options.ownRunId), PENDING);
  const runs = await listRunDirectories(options.personDirectory);
  let moved = 0;
  for (const runId of runs) {
    if (runId === options.ownRunId) continue;
    const runDirectory = runQueueRoot(options.personDirectory, runId);
    if (await isOrphan(runDirectory, options.nowMs, threshold)) {
      moved += await adoptRun(runDirectory, ownPending, options.log);
    }
  }
  return moved;
}
