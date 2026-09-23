/**
 * Сессия записи — то, чем пользуется оркестратор: заявиться, складывать части, закончить.
 *
 * Здесь же стоят ворота, ради которых блок и существует: **если арбитраж ответил `defer`,
 * аудио не отправляется вообще**. Не «отправляется и отбивается 403», не «кладётся в
 * очередь на потом» — не отправляется. Встречу уже пишет тот, у кого запись полнее, и
 * второй загрузчик здесь — это лишние деньги за транскрибацию и дубль в очереди вычитки.
 */
import type { ClaimDecision, ClaimRequest, SpeakerSpan } from "./contract.ts";
import type { SwarmClient } from "./client.ts";
import { SwarmDeferredError } from "./errors.ts";
import type { UploadQueue } from "./queue.ts";

/**
 * Контракт блока для оркестратора (`docs/furca/blocks/swarm-client.md`).
 */
export interface RecordingSessionContract {
  claim(): Promise<ClaimDecision>;
  pushAudioPart(part: Blob, offset: number): Promise<void>;
  finish(timeline: readonly SpeakerSpan[]): Promise<void>;
  heartbeat(): Promise<void>;
}

export interface RecordingSessionOptions {
  readonly client: SwarmClient;
  readonly queue: UploadQueue;
  /**
   * Чем заявляемся на встречу. `identity_key` приходит из `meeting-current`.
   */
  readonly claim: ClaimRequest;
  /**
   * Версия сборки бота — уезжает в heartbeat, по ней видно, что именно работает.
   */
  readonly version: number;
}

export class RecordingSession implements RecordingSessionContract {
  private decision: ClaimDecision | null = null;

  private meetingId: string | null = null;

  private heldBy: number | null = null;

  constructor(private readonly options: RecordingSessionOptions) {}

  /**
   * Бросает, если запись отклонена или ещё не заявлена. Один вход для обоих запретов:
   * ворота, размазанные по вызовам, однажды забывают закрыть.
   */
  private gate(): string {
    if (this.decision === null || this.meetingId === null) {
      throw new Error("claim не вызван — заявиться на встречу нужно до записи");
    }
    if (this.decision === "defer") {
      throw new SwarmDeferredError(this.meetingId, this.heldBy);
    }
    return this.meetingId;
  }

  /**
   * Идентификатор встречи, выданный сервером. До `claim()` его нет.
   */
  get id(): string | null {
    return this.meetingId;
  }

  /**
   * Право транскрибации, полученное на `claim()`.
   */
  get claimDecision(): ClaimDecision | null {
    return this.decision;
  }

  /**
   * Застолбить транскрибацию. `defer` — это нормальный исход, а не ошибка: пишет кто-то
   * другой, и боту остаётся выйти.
   */
  async claim(): Promise<ClaimDecision> {
    const response = await this.options.client.claim(this.options.claim);
    this.meetingId = response.meeting_id;
    this.decision = response.decision;
    this.heldBy = response.held_by;
    return response.decision;
  }

  /**
   * Положить очередную часть записи в очередь (то есть на диск).
   */
  async pushAudioPart(part: Blob, offset: number): Promise<void> {
    const meetingId = this.gate();
    await this.options.queue.stagePart(meetingId, part, offset);
  }

  /**
   * Закончить запись: запечатать её вместе с таймлайном говорящих и попытаться выгрузить.
   * Пустой таймлайн выгрузке не мешает — поле просто не отправляется.
   */
  async finish(timeline: readonly SpeakerSpan[]): Promise<void> {
    const meetingId = this.gate();
    await this.options.queue.seal(meetingId, timeline);
    await this.options.queue.drain();
  }

  /**
   * «Бот жив» — для серверного watchdog. Идёт в строку служебного агента, а не человека.
   */
  async heartbeat(): Promise<void> {
    await this.options.client.heartbeat({
      recording: this.decision === "transcribe",
      version: this.options.version,
      on_call: true,
      meeting_key: this.options.claim.identity_key,
    });
  }
}
