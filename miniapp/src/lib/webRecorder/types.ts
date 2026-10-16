// Запись встречи из браузера: общие типы движка (решение docs/decisions/2026-10-16-web-recorder.md).

/** Длина одного куска записи, секунд. Закрытый кусок — самостоятельный файл, уходит на сервер сразу. */
export const SEGMENT_SECONDS = 300;

export type RecorderState =
  | "idle"
  | "starting"
  | "recording"
  /** Микрофон отключён насовсем (звонок, смена устройства): нужен тап «Продолжить». */
  | "interrupted"
  /** Остановили: досылаем куски и завершаем запись на сервере. */
  | "stopping"
  | "done"
  | "error";

export type RecorderErrorCode =
  | "unsupported"
  | "permission-denied"
  | "no-mic"
  | "mic-failed"
  /** Сервер не знает эту запись или она чужая (404/403): досылать некуда. */
  | "not-found"
  /** Запись уже завершена на сервере (409). */
  | "finished"
  | "too-large"
  /** Сервер отклонил кусок (400/415): повтор не поможет. */
  | "rejected"
  /** Уже три незавершённые записи (429 too_many_open): сперва дослать и завершить одну из них. */
  | "too-many-open"
  /** Демо-аккаунт: запись недоступна (403 demo_not_allowed). */
  | "demo"
  | "unknown";

export interface Interruption {
  /** Секунды от начала записи, когда прервалось. */
  atSec: number;
  seconds: number;
  /** mute — трек заглушён системой (блокировка экрана) и вернулся сам; ended — нужен был тап. */
  kind: "mute" | "ended";
}

export interface RecorderSnapshot {
  state: RecorderState;
  /** Секунды по часам от начала записи (прерывания входят в счёт). */
  elapsedSec: number;
  /** Последние отсчёты громкости 0..1, старые первыми. */
  levels: number[];
  segmentsUploaded: number;
  segmentsPending: number;
  segmentsFailed: number;
  online: boolean;
  /** Трек сейчас заглушён (экран заблокирован) — запись идёт, но звука нет. */
  muted: boolean;
  wakeLock: boolean;
  interruptions: Interruption[];
  /** Последняя завершённая пауза — для плашки «Запись прерывалась на N с». */
  lastGapSec: number | null;
  error: RecorderErrorCode | null;
  summaryStatus: string | null;
}

/** Закрытый кусок: целый файл, который читается сам по себе. */
export interface SegmentRec {
  rid: string;
  n: number;
  /** Секунды от начала записи по часам. */
  offset: number;
  mime: string;
  blob: Blob;
}

/** Фрагмент незакрытого куска (timeslice): по одному не читается, только склеенные по порядку. */
export interface ChunkRec {
  rid: string;
  n: number;
  i: number;
  offset: number;
  mime: string;
  blob: Blob;
}

export interface RecordingRec {
  /** Локальный идентификатор записи. */
  rid: string;
  /** Идентификатор встречи на сервере; null, пока POST /meetings/record не прошёл. */
  serverId: string | null;
  startedAt: string;
  mime: string;
  /** Когда последний раз приходили данные (мс) — оценка конца для брошенной записи. */
  lastSeenMs: number;
}

/** Что нашли после сбоя: можно дослать и завершить. */
export interface RecoverableRecording {
  rid: string;
  serverId: string | null;
  startedAt: string;
  segments: number;
  /** Есть ли на этом устройстве данные для досылки (иначе запись только числится на сервере). */
  hasLocalData: boolean;
}
