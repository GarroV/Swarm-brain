/**
 * Поводок: как контейнер узнаёт, что оркестратор, который его поднял, умер.
 *
 * Оркестратор раз в несколько секунд переписывает файл поводка (`{"seq": N}`), каталог с ним
 * смонтирован в каждый контейнер только на чтение. Контейнер смотрит, МЕНЯЕТСЯ ли `seq`, и
 * меряет это СВОИМИ часами — сверять время хоста и контейнера не нужно, поэтому расхождение
 * часов ложной тревоги не даёт.
 *
 * `seq` не менялся дольше порога → оркестратора нет → контейнер сам заканчивает встречу
 * штатно (выход из звонка, выгрузка записанного) и выходит. Без этого после падения
 * оркестратора контейнер жил бы без хозяина: его некому остановить и некому заметить его
 * смерть. Порог выбран с запасом на перезапуск оркестратора: успевший подняться оркестратор
 * подхватывает свои контейнеры и снова двигает `seq`.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const LEASE_FILE_NAME = "lease.json";
export const LEASE_WRITE_INTERVAL_MS = 5000;
const LEASE_STALE_MS = 90_000;

/**
 * `seq` из содержимого файла; `null` — файла нет или он не разобран.
 */
export function parseLease(text: string | null): number | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const seq = (parsed as Record<string, unknown>).seq;
    return typeof seq === "number" && Number.isSafeInteger(seq) ? seq : null;
  } catch {
    return null;
  }
}

/**
 * Решение «поводок оборван». Чистая логика: часы подаются снаружи.
 */
export class LeaseTracker {
  private lastSeq: number | null = null;

  private lastChangeAt: number;

  constructor(
    startedAt: number,
    private readonly staleMs: number = LEASE_STALE_MS,
  ) {
    // Отсчёт от старта: контейнер, которому поводок так и не показали, тоже сирота.
    this.lastChangeAt = startedAt;
  }

  /**
   * Возвращает `true`, когда `seq` не менялся дольше порога.
   */
  observe(seq: number | null, now: number): boolean {
    if (seq !== null && seq !== this.lastSeq) {
      this.lastSeq = seq;
      this.lastChangeAt = now;
    }
    return now - this.lastChangeAt > this.staleMs;
  }

  silentForMs(now: number): number {
    return now - this.lastChangeAt;
  }
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Прочитать `seq` поводка из каталога.
 */
export async function readLease(directory: string): Promise<number | null> {
  return parseLease(await readOrNull(path.join(directory, LEASE_FILE_NAME)));
}

/**
 * Записать поводок атомарно: временный файл → `rename`. Контейнер не должен увидеть
 * недописанный JSON и принять его за «поводка нет».
 */
export async function writeLease(directory: string, seq: number): Promise<void> {
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${LEASE_FILE_NAME}.${randomUUID()}`);
  // Файл читает пользователь контейнера, а не владелец каталога на хосте: 0644 намеренно.
  await writeFile(temporary, JSON.stringify({ seq }), { mode: 0o644 });
  await rename(temporary, path.join(directory, LEASE_FILE_NAME));
}
