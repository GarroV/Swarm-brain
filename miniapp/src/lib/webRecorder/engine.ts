// Движок записи встречи из браузера. Без React: экран подписывается через subscribe/getSnapshot.
// Механика проверена на живом iPhone (miniapp/public/rec-probe.html) — переносится, не придумывается:
//  - формат: audio/mp4 первым; новый MediaRecorder на каждый кусок на ТОМ ЖЕ потоке; start(5000);
//  - AudioContext создаётся и будится синхронно в нажатии, ДО await getUserMedia (иначе iOS оставит
//    его спящим);
//  - Wake Lock перезапрашивается при возврате на страницу; mute/unmute/ended трека — события.
import { ownedRecordings, recordedSeconds } from "./logic";
import * as store from "./store";
import { Uploader, fatalCodeOf } from "./uploader";
import {
  SEGMENT_SECONDS,
  type Interruption,
  type RecorderErrorCode,
  type RecorderSnapshot,
  type RecoverableRecording,
  type RecordingRec,
  type SegmentRec,
} from "./types";
import { fetchActiveWebRecording } from "@/lib/api";

const MIME_CANDIDATES = ["audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm"];
const TIMESLICE_MS = 5000;
const AUDIO_BITS_PER_SECOND = 64_000;
const TICK_MS = 120;
export const LEVEL_SAMPLES = 60;
/** Чувствительность индикатора: пик речи в комнате редко выше трети шкалы. */
const LEVEL_GAIN = 3;

export interface EngineOptions {
  segmentSeconds?: number;
  /** telegram_id текущего пользователя: запись привязывается к нему. Нет — записывать нельзя. */
  ownerId: number | null;
}

export function isRecordingSupported(): boolean {
  return typeof window !== "undefined"
    && typeof MediaRecorder !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia;
}

function pickMime(): string {
  try {
    return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  } catch {
    return "";
  }
}

function micErrorCode(e: unknown): RecorderErrorCode {
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission-denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-mic";
  return "mic-failed";
}

const newRid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const INITIAL: RecorderSnapshot = {
  state: "idle", elapsedSec: 0, levels: [], segmentsUploaded: 0, segmentsPending: 0, segmentsFailed: 0,
  online: true, muted: false, wakeLock: false, interruptions: [], lastGapSec: null, error: null,
  summaryStatus: null,
};

type Listener = () => void;

export class WebRecorder {
  private snap: RecorderSnapshot = { ...INITIAL, online: typeof navigator === "undefined" ? true : navigator.onLine };
  private listeners = new Set<Listener>();
  private readonly segmentSeconds: number;
  private readonly ownerId: number | null;
  private disposed = false;
  private continuing = false;

  private rec: RecordingRec | null = null;
  private uploader: Uploader | null = null;
  private startedMs = 0;
  private mime = "";
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private segN = 0;
  private segStartMs = 0;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Uint8Array<ArrayBuffer> | null = null;
  private levels: number[] = [];
  private wakeLock: WakeLockSentinel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private muteStartMs = 0;
  private endedStartMs = 0;
  private gapMs = 0;
  private interruptions: Interruption[] = [];
  /** Закрытие каждого куска идёт своим промисом: следующий кусок стартует, не дожидаясь предыдущего. */
  private readonly closings = new Set<Promise<void>>();
  private currentClosing: Promise<void> | null = null;
  private recorderErrors = 0;

  constructor(opts: EngineOptions) {
    this.segmentSeconds = opts.segmentSeconds ?? SEGMENT_SECONDS;
    this.ownerId = opts.ownerId;
  }

  /** Экран смонтирован (в том числе повторно, StrictMode): движок снова живой. */
  attach(): void {
    this.disposed = false;
  }

  // ── Подписка для UI ─────────────────────────────────────────────────────────

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = (): RecorderSnapshot => this.snap;

  private emit(patch: Partial<RecorderSnapshot> = {}): void {
    const u = this.uploader;
    this.snap = {
      ...this.snap,
      elapsedSec: this.startedMs ? Math.max(0, (Date.now() - this.startedMs) / 1000) : this.snap.elapsedSec,
      levels: this.levels,
      segmentsUploaded: u?.uploaded ?? this.snap.segmentsUploaded,
      segmentsPending: u?.pending.size ?? this.snap.segmentsPending,
      segmentsFailed: u?.failed ?? this.snap.segmentsFailed,
      interruptions: this.interruptions,
      wakeLock: !!this.wakeLock && !this.wakeLock.released,
      ...patch,
    };
    this.listeners.forEach((fn) => fn());
  }

  private fail(error: RecorderErrorCode): void {
    this.teardown();
    this.emit({ state: "error", error });
  }

  // ── Старт ───────────────────────────────────────────────────────────────────

  /** Вызывать СИНХРОННО из обработчика нажатия: AudioContext должен проснуться в нём. */
  start(): void {
    if (this.snap.state !== "idle" && this.snap.state !== "error") return;
    this.wakeAudioContext();
    this.emit({ state: "starting", error: null });
    void this.begin();
  }

  private async begin(): Promise<void> {
    if (!isRecordingSupported()) return this.fail("unsupported");
    if (this.ownerId === null) return this.fail("unknown");
    try {
      await this.openMic();
    } catch (e) {
      return this.fail(micErrorCode(e));
    }
    // Экран закрыли, пока шёл запрос разрешения: микрофон отпускаем, запись не начинаем.
    if (this.disposed) { this.releaseHardware(); return; }
    this.mime = pickMime();
    this.startedMs = Date.now();
    this.rec = { rid: newRid(), ownerId: this.ownerId, serverId: null, startedAt: new Date(this.startedMs).toISOString(), mime: this.mime, lastSeenMs: this.startedMs };
    void store.putRecording(this.rec);
    this.attachUploader(this.rec, 0);
    this.startSegment();
    this.attachPageListeners();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    void this.requestWakeLock();
    this.emit({ state: "recording" });
    // Встреча на сервере заводится заодно с первым куском/повтором; сразу пробуем, чтобы она появилась в базе.
    this.uploader?.kick();
  }

  private attachUploader(rec: RecordingRec, baseSegment: number): void {
    this.segN = baseSegment;
    this.uploader = new Uploader(rec, {
      onChange: () => this.emit(),
      onServerId: (id) => this.patchRec({ serverId: id }),
      // Досылать некуда — говорим громко. Звук на устройстве НЕ стираем: удаляет только человек (discardLocal).
      onFatal: (code) => this.emit({ error: code }),
    });
  }

  /** Единственная запись движка меняется только здесь: read-modify-write, без устаревших копий. */
  private patchRec(patch: Partial<RecordingRec>): void {
    if (!this.rec) return;
    this.rec = { ...this.rec, ...patch };
    void store.putRecording(this.rec);
  }

  /** Явный выбор человека: стереть неотправленную запись с устройства. */
  async discardLocal(): Promise<void> {
    const rid = this.rec?.rid;
    this.teardown();
    if (rid) await store.deleteRecording(rid);
    this.rec = null;
    this.uploader = null;
    this.emit({ state: "idle", error: null, segmentsPending: 0 });
  }

  // Индикатор громкости. AudioContext заводится в start()/continueRecording() синхронно.
  private wakeAudioContext(): void {
    try {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx || this.audioCtx.state === "closed") this.audioCtx = new Ctx();
      void this.audioCtx.resume().catch(() => {});
    } catch {
      // Без индикатора запись всё равно идёт.
    }
  }

  private async openMic(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    track.addEventListener("mute", () => this.onMute(track));
    track.addEventListener("unmute", () => this.onUnmute());
    track.addEventListener("ended", () => this.onEnded(track));
    this.startMeter(stream);
  }

  private startMeter(stream: MediaStream): void {
    try {
      if (!this.audioCtx) this.wakeAudioContext();
      const ctx = this.audioCtx;
      if (!ctx) return;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.analyser = analyser;
      this.levelBuf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    } catch {
      this.analyser = null;
    }
  }

  private readLevel(): number {
    const a = this.analyser;
    const buf = this.levelBuf;
    if (!a || !buf || this.snap.muted) return 0;
    a.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(1, (peak / 128) * LEVEL_GAIN);
  }

  private async requestWakeLock(): Promise<void> {
    try {
      if (!("wakeLock" in navigator)) return;
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => this.emit());
      this.emit();
    } catch {
      // Экран может погаснуть — об этом скажет плашка прерывания, если трек заглушат.
    }
  }

  // ── Куски ───────────────────────────────────────────────────────────────────

  private startSegment(): void {
    const stream = this.stream;
    const rec = this.rec;
    if (!stream || !rec) return;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, this.mime ? { mimeType: this.mime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND } : {});
    } catch {
      return this.fail("mic-failed");
    }
    const n = ++this.segN;
    const offset = (Date.now() - this.startedMs) / 1000;
    const mime = recorder.mimeType || this.mime || "audio/mp4";
    const chunks: Blob[] = [];
    const writes: Promise<unknown>[] = [];
    recorder.addEventListener("dataavailable", (e) => {
      if (!e.data || e.data.size === 0) return;
      const i = chunks.length;
      chunks.push(e.data);
      writes.push(store.putChunk({ rid: rec.rid, n, i, offset, mime, blob: e.data }));
      this.patchRec({ lastSeenMs: Date.now() });
    });
    recorder.addEventListener("error", () => this.onRecorderError(recorder));
    const closing = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => {
        void this.closeSegment(rec.rid, n, offset, mime, chunks, writes).finally(resolve);
      });
    });
    this.closings.add(closing);
    void closing.finally(() => this.closings.delete(closing));
    try {
      recorder.start(TIMESLICE_MS);
    } catch {
      return this.fail("mic-failed");
    }
    this.currentClosing = closing;
    this.recorder = recorder;
    this.segStartMs = Date.now();
  }

  private async closeSegment(
    rid: string, n: number, offset: number, mime: string, chunks: Blob[], writes: Promise<unknown>[],
  ): Promise<void> {
    if (chunks.length === 0) return;
    const seg: SegmentRec = { rid, n, offset, mime, blob: new Blob(chunks, { type: mime }) };
    await Promise.all(writes);
    await store.putSegment(seg);
    this.uploader?.enqueue(seg);
  }

  /** Останавливает текущий кусок; закрытие (запись на диск, очередь) идёт в фоне — промис возвращается. */
  private stopCurrent(): Promise<void> {
    const rec = this.recorder;
    const closing = this.currentClosing ?? Promise.resolve();
    this.recorder = null;
    this.currentClosing = null;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch { /* уже остановлен */ }
    }
    return closing;
  }

  private drainClosings(): Promise<unknown> {
    return Promise.all([...this.closings]);
  }

  /** Как в пробе: следующий MediaRecorder стартует сразу после stop(), без паузы на запись предыдущего. */
  private rotateSegment(): void {
    void this.stopCurrent();
    const track = this.stream?.getAudioTracks()[0];
    if (this.snap.state === "recording" && track?.readyState === "live") this.startSegment();
  }

  private onRecorderError(failed: MediaRecorder): void {
    // Один сбой кодера не должен ронять запись: закрываем кусок и открываем следующий.
    if (this.recorder !== failed || this.snap.state !== "recording") return;
    this.recorderErrors += 1;
    if (this.recorderErrors > 3) return this.fail("mic-failed");
    this.rotateSegment();
  }

  // ── События трека и страницы ────────────────────────────────────────────────

  private onMute(track: MediaStreamTrack): void {
    if (track !== this.stream?.getAudioTracks()[0] || this.muteStartMs) return;
    this.muteStartMs = Date.now();
    this.emit({ muted: true });
  }

  private onUnmute(): void {
    if (!this.muteStartMs) return;
    const seconds = (Date.now() - this.muteStartMs) / 1000;
    this.gapMs += seconds * 1000;
    this.interruptions = [...this.interruptions, { atSec: (this.muteStartMs - this.startedMs) / 1000, seconds, kind: "mute" }];
    this.muteStartMs = 0;
    this.emit({ muted: false, lastGapSec: seconds });
  }

  private onEnded(track: MediaStreamTrack): void {
    if (track !== this.stream?.getAudioTracks()[0] || this.snap.state !== "recording") return;
    this.endedStartMs = this.muteStartMs || Date.now();
    this.muteStartMs = 0;
    // Таймер не гасим: часы идут, пока человек не нажмёт «Продолжить».
    this.analyser = null;
    this.emit({ state: "interrupted", muted: false });
    void this.stopCurrent();
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState !== "visible") return;
    if (!this.wakeLock || this.wakeLock.released) void this.requestWakeLock();
    // iOS мог остановить кодер вместе с блокировкой: если трек жив, а кодера нет — поднимаем новый кусок.
    const track = this.stream?.getAudioTracks()[0];
    if (this.snap.state === "recording" && track?.readyState === "live" && (!this.recorder || this.recorder.state === "inactive")) {
      this.startSegment();
    }
    void this.audioCtx?.resume().catch(() => {});
  };
  private readonly onOnline = (): void => { this.emit({ online: true }); this.uploader?.kick(); };
  private readonly onOffline = (): void => this.emit({ online: false });
  private readonly onBeforeUnload = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = ""; };

  private attachPageListeners(): void {
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    window.addEventListener("beforeunload", this.onBeforeUnload);
  }

  private detachPageListeners(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    // beforeunload остаётся, пока не отправлено всё: закрытая вкладка = потерянный хвост (его подберёт восстановление).
  }

  private tick(): void {
    this.levels = [...this.levels.slice(-(LEVEL_SAMPLES - 1)), this.readLevel()];
    if (this.audioCtx?.state === "suspended") void this.audioCtx.resume().catch(() => {});
    if (this.snap.state === "recording" && this.recorder && (Date.now() - this.segStartMs) / 1000 >= this.segmentSeconds) {
      this.rotateSegment();
      this.segStartMs = Date.now();
    }
    this.emit();
  }

  // ── Продолжить, стоп ────────────────────────────────────────────────────────

  /** После `interrupted`: нужно нажатие пользователя (getUserMedia + AudioContext). */
  continueRecording(): void {
    if (this.snap.state !== "interrupted" || this.continuing) return;
    this.continuing = true;
    this.wakeAudioContext();
    void (async () => {
      try {
        // Старый (умерший) поток отпускаем до нового запроса: два живых потока — два рекордера.
        this.stream?.getTracks().forEach((t) => t.stop());
        try {
          await this.openMic();
        } catch (e) {
          this.emit({ error: micErrorCode(e) });
          return;
        }
        if (this.disposed) { this.releaseHardware(); return; }
      const seconds = (Date.now() - this.endedStartMs) / 1000;
      this.gapMs += seconds * 1000;
      this.interruptions = [...this.interruptions, { atSec: (this.endedStartMs - this.startedMs) / 1000, seconds, kind: "ended" }];
      this.endedStartMs = 0;
      this.startSegment();
      void this.requestWakeLock();
      this.emit({ state: "recording", error: null, lastGapSec: seconds });
      } finally {
        this.continuing = false;
      }
    })();
  }

  /** Закрыть кусок, досдать очередь, завершить запись на сервере. */
  async stop(): Promise<void> {
    const state = this.snap.state;
    if (state !== "recording" && state !== "interrupted") return;
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    if (this.muteStartMs) this.onUnmute();
    // Стоп из «прервалось»: пауза ещё идёт, и в записанное она не входит.
    const ongoingGapStartMs = state === "interrupted" ? this.endedStartMs : 0;
    this.emit({ state: "stopping" });
    void this.stopCurrent();
    await this.drainClosings();
    const endedMs = Date.now();
    this.releaseHardware();
    this.detachPageListeners();
    this.uploader?.requestFinish(
      new Date(endedMs).toISOString(),
      recordedSeconds({ startedMs: this.startedMs, endedMs, gapMs: this.gapMs, ongoingGapStartMs }),
    );
    this.watchCompletion();
  }

  private watchCompletion(): void {
    const off = this.subscribe(() => {
      const u = this.uploader;
      if (!u?.completed || this.snap.state === "done") return;
      off();
      window.removeEventListener("beforeunload", this.onBeforeUnload);
      this.emit({ state: "done", summaryStatus: u.summaryStatus });
    });
  }

  private releaseHardware(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  /** Полная остановка без отправки (ошибка старта, уход экрана). */
  private teardown(): void {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    this.releaseHardware();
    this.detachPageListeners();
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    this.uploader?.dispose();
  }

  /** Экран закрыт: освобождаем микрофон. Если запись шла — остаток подберёт восстановление. */
  dispose(): void {
    this.disposed = true;
    const active = this.snap.state === "recording" || this.snap.state === "interrupted" || this.snap.state === "stopping";
    if (!active) { this.teardown(); return; }
    // Закрываем кусок, чтобы он лёг на диск целым, и отпускаем микрофон.
    void this.stopCurrent();
    void this.drainClosings().finally(() => this.teardown());
  }

  // ── Восстановление после сбоя ───────────────────────────────────────────────

  /** Дослать то, что осталось, и завершить. Движок переходит сразу в `stopping`. */
  async recover(info: RecoverableRecording): Promise<void> {
    if (this.snap.state !== "idle") return;
    if (this.ownerId === null) return;
    const mine = ownedRecordings(await store.listRecordings(), this.ownerId);
    const known = mine.find((r) => r.rid === info.rid);
    // Локальная запись обязана быть нашей; чужую не трогаем (серверная — только по id активной встречи автора).
    if (!known && info.hasLocalData) return;
    const rec: RecordingRec = known ?? { rid: info.rid, ownerId: this.ownerId, serverId: info.serverId, startedAt: info.startedAt, mime: "", lastSeenMs: Date.now() };
    this.rec = rec;
    this.attachUploader(rec, 0);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    window.addEventListener("beforeunload", this.onBeforeUnload);
    this.emit({ state: "stopping" });
    for (const seg of await store.loadLeftovers(info.rid)) this.uploader?.enqueue(seg);
    // Конец — последний раз, когда приходили данные; без этого — серверное «сейчас».
    const startedMs = Date.parse(rec.startedAt);
    const endedMs = info.hasLocalData && rec.lastSeenMs > startedMs ? rec.lastSeenMs : Date.now();
    this.uploader?.requestFinish(new Date(endedMs).toISOString(), (endedMs - startedMs) / 1000);
    this.watchCompletion();
  }
}

/**
 * Есть ли незавершённая запись: сначала то, что лежит на этом устройстве, потом то, что числится
 * на сервере. Любая ошибка (нет сети, хранилище закрыто) — «нет»: экран не должен падать.
 */
export async function findRecoverable(ownerId: number | null): Promise<RecoverableRecording | null> {
  if (ownerId === null) return null;
  try {
    const local = ownedRecordings(await store.listRecordings(), ownerId).sort((a, b) => b.lastSeenMs - a.lastSeenMs);
    for (const r of local) {
      const leftovers = await store.loadLeftovers(r.rid);
      if (leftovers.length > 0 || r.serverId) {
        return { rid: r.rid, serverId: r.serverId, startedAt: r.startedAt, segments: leftovers.length, hasLocalData: leftovers.length > 0 };
      }
      // Ни кусков, ни встречи на сервере — записывать нечего, мусор убираем.
      void store.deleteRecording(r.rid);
    }
  } catch {
    // дальше спросим сервер
  }
  try {
    const active = await fetchActiveWebRecording();
    if (active) {
      return { rid: `server-${active.id}`, serverId: active.id, startedAt: active.started_at, segments: active.segments.length, hasLocalData: false };
    }
  } catch (e) {
    if (fatalCodeOf(e) === null) return null;
  }
  return null;
}
