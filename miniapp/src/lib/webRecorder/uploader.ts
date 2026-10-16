// Очередь отправки кусков и завершения записи: повтор с нарастающей паузой, ожидание сети.
// Кусок удаляется из IndexedDB только после ответа сервера.
import { ApiError, finishWebRecording, startWebRecording, uploadWebRecordingSegment } from "@/lib/api";
import * as store from "./store";
import type { RecorderErrorCode, RecordingRec, SegmentRec } from "./types";

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

export interface UploaderHooks {
  /** Состояние очереди изменилось — перерисовать. */
  onChange(): void;
  /** Фатальная ошибка: досылать нечего или некуда. */
  onFatal(code: RecorderErrorCode): void;
}

/** Код 4xx, после которого повтор бессмыслен. null — сеть/5xx/заморозка, повторяем. */
export function fatalCodeOf(e: unknown): RecorderErrorCode | null {
  if (!(e instanceof ApiError)) return null;
  const code = (e.body as { code?: string } | null)?.code;
  if (code === "demo_not_allowed") return "demo";
  if (code === "too_many_open") return "too-many-open";
  if (e.status === 409) return "finished";
  if (e.status === 403 || e.status === 404) return "not-found";
  if (e.status === 413) return "too-large";
  if (e.status === 400 || e.status === 415) return "rejected";
  return null;
}

/** Пауза, которую просит сервер на заморозке (Retry-After), секунды; иначе null. */
function retryAfterMs(e: unknown): number | null {
  if (!(e instanceof ApiError) || e.status !== 503) return null;
  const sec = (e.body as { retry_after_s?: number } | null)?.retry_after_s;
  return sec && sec > 0 ? Math.min(sec, 300) * 1000 : null;
}

export class Uploader {
  readonly pending = new Map<number, SegmentRec>();
  uploaded = 0;
  failed = 0;
  private serverId: string | null;
  private pumping = false;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finishRequest: { endedAt: string; recordedSeconds: number } | null = null;
  private dead = false;
  /** Задан, когда finish прошёл: статус обработки с сервера. */
  summaryStatus: string | null = null;
  completed = false;

  constructor(
    private readonly rec: RecordingRec,
    private readonly hooks: UploaderHooks,
  ) {
    this.serverId = rec.serverId;
  }

  enqueue(seg: SegmentRec): void {
    this.pending.set(seg.n, seg);
    this.hooks.onChange();
    void this.pump();
  }

  /** Сеть вернулась или пользователь ждёт: пробуем сразу, без паузы. */
  kick(): void {
    this.attempts = 0;
    void this.pump();
  }

  /** Остановка: после того как очередь опустеет, отправим finish. */
  requestFinish(endedAt: string, recordedSeconds: number): void {
    this.finishRequest = { endedAt, recordedSeconds };
    void this.pump();
  }

  dispose(): void {
    this.dead = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async ensureServerId(): Promise<boolean> {
    if (this.serverId) return true;
    try {
      const created = await startWebRecording(this.rec.startedAt);
      this.serverId = created.id;
      void store.putRecording({ ...this.rec, serverId: created.id });
      return true;
    } catch (e) {
      return this.handleFailure(e);
    }
  }

  /** false всегда: вызывающий прерывает круг. Фатальное — наружу, остальное — повтор по таймеру. */
  private handleFailure(e: unknown): false {
    const fatal = fatalCodeOf(e);
    if (fatal) {
      this.dead = true;
      this.hooks.onFatal(fatal);
    } else {
      this.scheduleRetry(retryAfterMs(e));
    }
    return false;
  }

  private scheduleRetry(serverDelayMs: number | null = null): void {
    if (this.timer || this.dead) return;
    const delay = serverDelayMs ?? Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, delay);
  }

  private async uploadOne(seg: SegmentRec): Promise<boolean> {
    try {
      await uploadWebRecordingSegment(this.serverId as string, seg.n, seg.offset, seg.blob);
    } catch (e) {
      // Слишком большой или отклонённый кусок не лечится повтором: помечаем потерянным и идём дальше.
      const code = fatalCodeOf(e);
      if (code === "too-large" || code === "rejected") {
        this.pending.delete(seg.n);
        this.failed += 1;
        this.hooks.onChange();
        return true;
      }
      return this.handleFailure(e);
    }
    this.pending.delete(seg.n);
    this.uploaded += 1;
    this.attempts = 0;
    void store.deleteSegment(seg.rid, seg.n);
    this.hooks.onChange();
    return true;
  }

  private async tryFinish(): Promise<boolean> {
    const req = this.finishRequest;
    if (!req || this.pending.size > 0) return true;
    try {
      const res = await finishWebRecording(this.serverId as string, {
        ended_at: req.endedAt,
        recorded_seconds: Math.max(0, Math.round(req.recordedSeconds)),
      });
      this.summaryStatus = res.summary_status ?? null;
    } catch (e) {
      // 409 при завершении — сервер уже всё собрал (например, сторож брошенных записей).
      if (!(e instanceof ApiError && e.status === 409)) return this.handleFailure(e);
    }
    await store.deleteRecording(this.rec.rid);
    this.finishRequest = null;
    this.completed = true;
    this.hooks.onChange();
    return true;
  }

  /** Один проход: создать встречу → отправить куски по порядку → завершить. Одновременно не больше одного. */
  private async pump(): Promise<void> {
    if (this.pumping || this.dead) return;
    this.pumping = true;
    try {
      if (this.pending.size === 0 && !this.finishRequest && this.serverId) return;
      // Если сети нет, не жжём попытки: ждём события online (kick), таймер — страховка.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        this.scheduleRetry();
        return;
      }
      if (!(await this.ensureServerId())) return;
      // Пока шла отправка, мог закрыться следующий кусок — крутим, пока очередь не опустеет.
      while (this.pending.size > 0) {
        const seg = [...this.pending.values()].sort((a, b) => a.n - b.n)[0];
        if (!(await this.uploadOne(seg))) return;
      }
      await this.tryFinish();
    } finally {
      this.pumping = false;
      this.hooks.onChange();
      // finish/кусок мог прийти, пока круг ещё считался занятым, — не теряем его.
      const more = this.pending.size > 0 || (this.finishRequest !== null && !this.completed);
      if (more && !this.timer && !this.dead) void this.pump();
    }
  }

}
