/**
 * Очередь выгрузки и локальный бэкап записи.
 *
 * Задача у неё одна: между «ffmpeg дописал часть» и «сервер принял» запись встречи не
 * должна пропасть. Поэтому часть сначала ложится на диск и только потом уезжает, а
 * неудачная отправка оставляет её лежать дальше, а не исчезает вместе с процессом.
 *
 * Устройство повторяет `UploadQueue.swift` рекордера, потому что оно проверено жизнью:
 *   pending/<meetingId>/meta.json + файлы частей   — запись ждёт отправки;
 *   sealed=false                                   — встреча ещё идёт, грузить рано;
 *   постоянный сбой или исчерпанные попытки        — failed/ (dead-letter), не удаление;
 *   успешные 202                                   — бэкап ОСТАЁТСЯ: 202 ≠ «обработано»;
 *   опубликовано в базу (`in_base`)                — вот теперь бэкап не нужен;
 *   старше потолка                                 — сметается, чтобы диск не рос.
 *
 * ⚠️ Каталог очереди обязан переживать контейнер: внутри эфемерного контейнера бэкап
 * умирает вместе с ним. Монтирование тома — забота оркестратора.
 */
import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { INGEST_PART_MAX_BYTES, PUBLISHED_STATUS, type SpeakerSpan } from "./contract.ts";
import type { SwarmClient, UploadPart } from "./client.ts";
import { SwarmHttpError, isTransient } from "./errors.ts";

const PENDING_DIR = "pending";
const FAILED_DIR = "failed";
const META_FILE = "meta.json";
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BACKUP_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Часть дорожки, лежащая на диске.
 */
export interface QueuedPart {
  readonly name: string;
  readonly file: string;
  readonly offset: number;
}

/**
 * Сайдкар одной встречи. Пишется атомарно: временный файл → `rename`.
 */
export interface QueueEntry {
  readonly meetingId: string;
  readonly parts: readonly QueuedPart[];
  readonly speakers: readonly SpeakerSpan[] | null;
  /**
   * Запись закончена и готова к отправке. Незапечатанная — это встреча, которая ещё идёт.
   */
  readonly sealed: boolean;
  readonly uploaded: boolean;
  readonly attempts: number;
  readonly createdAt: string;
}

export type QueueEventKind =
  "staged" | "sealed" | "uploaded" | "retry" | "dead-letter" | "released" | "expired";

interface QueueEvent {
  readonly kind: QueueEventKind;
  readonly meetingId: string;
  readonly detail?: string;
}

export interface UploadQueueOptions {
  /**
   * Каталог очереди. Должен переживать перезапуск процесса — в этом весь смысл.
   */
  readonly root: string;
  readonly client: SwarmClient;
  /**
   * Сколько раз пробовать между прогонами, прежде чем признать запись безнадёжной.
   */
  readonly maxAttempts?: number;
  readonly backupTtlMs?: number;
  readonly now?: () => number;
  /**
   * События очереди наружу: молчаливая очередь — это очередь, про которую никто не знает.
   */
  readonly onEvent?: (event: QueueEvent) => void;
}

export interface DrainResult {
  /**
   * Приняты сервером в этот прогон.
   */
  readonly uploaded: string[];
  /**
   * Остались ждать следующего прогона: сбой временный.
   */
  readonly retryable: string[];
  /**
   * Переехали в dead-letter: повторять бессмысленно.
   */
  readonly deadLettered: string[];
  /**
   * Бэкап отпущен: встреча опубликована в базу.
   */
  readonly released: string[];
}

function emptyResult(): DrainResult {
  return { uploaded: [], retryable: [], deadLettered: [], released: [] };
}

/**
 * Имя каталога встречи. `meeting_id` приходит с сервера, и подставлять его в путь как есть
 * нельзя: `../` в идентификаторе увёл бы запись куда угодно за пределы очереди.
 */
function safeDirectoryName(meetingId: string): string {
  const cleaned = meetingId.replaceAll(/[^\w.-]/gu, "_");
  const digest = createHash("sha256").update(meetingId).digest("hex").slice(0, 8);
  return `${cleaned.slice(0, 80)}-${digest}`;
}

// Аудио разговора и имена говорящих — только процессу бота.
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export class UploadQueue {
  private readonly root: string;

  private readonly client: SwarmClient;

  private readonly maxAttempts: number;

  private readonly backupTtlMs: number;

  private readonly now: () => number;

  // Идущий прогон: второй вызов присоединяется к нему, иначе запись уйдёт дважды.
  private running: Promise<DrainResult> | null = null;

  constructor(private readonly options: UploadQueueOptions) {
    this.root = options.root;
    this.client = options.client;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backupTtlMs = options.backupTtlMs ?? DEFAULT_BACKUP_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  private dir(meetingId: string, base: string = PENDING_DIR): string {
    return path.join(this.root, base, safeDirectoryName(meetingId));
  }

  private emit(kind: QueueEventKind, meetingId: string, detail?: string): void {
    this.options.onEvent?.({ kind, meetingId, ...(detail !== undefined && { detail }) });
  }

  private async readEntry(directory: string): Promise<QueueEntry | null> {
    try {
      const raw = await readFile(path.join(directory, META_FILE), "utf8");
      return JSON.parse(raw) as QueueEntry;
    } catch {
      return null;
    }
  }

  private async writeEntry(entry: QueueEntry): Promise<void> {
    const directory = this.dir(entry.meetingId);
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIR_MODE });
    const target = path.join(directory, META_FILE);
    const temporary = `${target}.tmp`;
    // Атомарно: полусайдкар после падения посреди записи не отличить от целого.
    await writeFile(temporary, JSON.stringify(entry, null, 2), {
      encoding: "utf8",
      mode: PRIVATE_FILE_MODE,
    });
    await rename(temporary, target);
  }

  private async moveToDeadLetter(meetingId: string, reason: string): Promise<void> {
    const from = this.dir(meetingId);
    const to = this.dir(meetingId, FAILED_DIR);
    await mkdir(path.join(this.root, FAILED_DIR), { recursive: true, mode: PRIVATE_DIR_MODE });
    await rm(to, { recursive: true, force: true });
    await rename(from, to);
    this.emit("dead-letter", meetingId, reason);
  }

  private async uploadEntry(entry: QueueEntry): Promise<void> {
    const directory = this.dir(entry.meetingId);
    const parts: UploadPart[] = [];
    for (const part of entry.parts) {
      parts.push({
        name: part.name,
        offset: part.offset,
        body: await openAsBlob(path.join(directory, part.file)),
      });
    }
    await this.client.ingest({
      meetingId: entry.meetingId,
      system: parts,
      ...(entry.speakers && entry.speakers.length > 0 && { speakers: entry.speakers }),
    });
  }

  /**
   * Смести устаревшие бэкапы одного каталога. Отдельным методом, а не вложенным циклом:
   * `continue` во вложенном цикле читается хуже, чем отдельная понятная функция.
   */
  private async sweepDir(base: string): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(path.join(this.root, base));
    } catch {
      return [];
    }
    const swept: string[] = [];
    for (const name of names) {
      const directory = path.join(this.root, base, name);
      let info;
      try {
        info = await stat(directory);
      } catch {
        continue;
      }
      if (!info.isDirectory()) continue;
      if (this.now() - info.mtimeMs <= this.backupTtlMs) continue;
      await rm(directory, { recursive: true, force: true });
      swept.push(name);
      this.emit("expired", name);
    }
    return swept;
  }

  /**
   * Одна запись за прогон: отправить, а на сбое решить — ждать следующего прогона или
   * признать безнадёжной. Постоянный сбой (401/403/413) повторять нечем.
   */
  private async drainEntry(
    entry: QueueEntry,
    result: DrainResult,
    uploadedIds: string[],
  ): Promise<void> {
    if (entry.uploaded) {
      uploadedIds.push(entry.meetingId);
      return;
    }
    try {
      await this.uploadEntry(entry);
      await this.writeEntry({ ...entry, uploaded: true });
      uploadedIds.push(entry.meetingId);
      result.uploaded.push(entry.meetingId);
      this.emit("uploaded", entry.meetingId);
      return;
    } catch (error) {
      const attempts = entry.attempts + 1;
      const isPermanent = error instanceof SwarmHttpError && !isTransient(error);
      await this.writeEntry({ ...entry, attempts });
      if (isPermanent || attempts >= this.maxAttempts) {
        await this.moveToDeadLetter(
          entry.meetingId,
          isPermanent ? `постоянный сбой: ${String(error)}` : "попытки исчерпаны",
        );
        result.deadLettered.push(entry.meetingId);
        return;
      }
      result.retryable.push(entry.meetingId);
      this.emit("retry", entry.meetingId, `попытка ${String(attempts)}: ${String(error)}`);
    }
  }

  /**
   * Отпустить бэкап тех встреч, что уже опубликованы в базу. Сбой опроса статусов — не
   * повод удалять: лучше лишний бэкап, чем потерянная запись.
   */
  private async releasePublished(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const released: string[] = [];
    let statuses;
    try {
      statuses = await this.client.statuses(ids);
    } catch {
      return [];
    }
    for (const id of ids) {
      if (statuses.get(id)?.status !== PUBLISHED_STATUS) continue;
      await rm(this.dir(id), { recursive: true, force: true });
      released.push(id);
      this.emit("released", id);
    }
    return released;
  }

  private async runDrain(): Promise<DrainResult> {
    const result = emptyResult();
    await this.sweepExpired();

    const uploadedIds: string[] = [];
    const entries = await this.entries();
    for (const entry of entries) {
      if (!entry.sealed) continue;
      await this.drainEntry(entry, result, uploadedIds);
    }

    result.released.push(...(await this.releasePublished(uploadedIds)));
    return result;
  }

  private async runDrainOnce(): Promise<DrainResult> {
    try {
      return await this.runDrain();
    } finally {
      this.running = null;
    }
  }

  /**
   * Положить часть записи на диск. Это и есть локальный бэкап: дальше её потеря возможна
   * только вместе с диском.
   */
  async stagePart(meetingId: string, part: Blob, offset: number): Promise<QueuedPart> {
    // Часть больше лимита сервер отобьёт 413 навсегда. Узнать об этом лучше здесь, у
    // источника, чем через шесть попыток выгрузки и dead-letter.
    if (part.size > INGEST_PART_MAX_BYTES) {
      throw new RangeError(
        `часть ${String(part.size)} Б больше предела ${String(INGEST_PART_MAX_BYTES)} Б — сервер её не примет`,
      );
    }
    if (part.size === 0) {
      throw new RangeError("часть пустая — отправлять нечего");
    }

    const directory = this.dir(meetingId);
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIR_MODE });
    const existing = await this.readEntry(directory);
    if (existing?.sealed) {
      throw new Error(`встреча ${meetingId} уже запечатана — часть после finish не принимается`);
    }

    const name = `sys_${String(existing?.parts.length ?? 0)}`;
    const file = `${name}.m4a`;
    await writeFile(path.join(directory, file), Buffer.from(await part.arrayBuffer()), {
      mode: PRIVATE_FILE_MODE,
    });

    const queued: QueuedPart = { name, file, offset };
    await this.writeEntry({
      meetingId,
      parts: [...(existing?.parts ?? []), queued],
      speakers: existing?.speakers ?? null,
      sealed: false,
      uploaded: false,
      attempts: existing?.attempts ?? 0,
      createdAt: existing?.createdAt ?? new Date(this.now()).toISOString(),
    });
    this.emit("staged", meetingId, name);
    return queued;
  }

  /**
   * Запись закончена: записать таймлайн и разрешить выгрузку.
   */
  async seal(meetingId: string, speakers: readonly SpeakerSpan[]): Promise<void> {
    const entry = await this.readEntry(this.dir(meetingId));
    if (!entry) throw new Error(`встреча ${meetingId} не найдена в очереди — печатать нечего`);
    await this.writeEntry({
      ...entry,
      speakers: speakers.length > 0 ? [...speakers] : null,
      sealed: true,
    });
    this.emit("sealed", meetingId, `частей ${String(entry.parts.length)}`);
  }

  /**
   * Все записи очереди, включая незапечатанные и уже отправленные.
   */
  async entries(): Promise<QueueEntry[]> {
    let names: string[];
    try {
      names = await readdir(path.join(this.root, PENDING_DIR));
    } catch {
      return [];
    }
    const found: QueueEntry[] = [];
    for (const name of names) {
      const entry = await this.readEntry(path.join(this.root, PENDING_DIR, name));
      if (entry) found.push(entry);
    }
    return found;
  }

  /**
   * Смести бэкапы старше потолка — и отправленные, и безнадёжные. Диск не должен расти
   * бесконечно, но неопубликованная запись обязана дожить до того, как её заметят.
   */
  async sweepExpired(): Promise<string[]> {
    const pending = await this.sweepDir(PENDING_DIR);
    const failed = await this.sweepDir(FAILED_DIR);
    return [...pending, ...failed];
  }

  /**
   * Прогон очереди: отправить запечатанное, спросить статусы отправленного, отпустить
   * опубликованное. Зовётся после записи и периодически — пока сеть не вернётся, запись
   * просто лежит. Вызовы внахлёст (таймер оркестратора и `finish()` сессии) получают
   * один и тот же прогон.
   */
  drain(): Promise<DrainResult> {
    this.running ??= this.runDrainOnce();
    return this.running;
  }
}
