// Контракты состояния durable-обработки записи и частей выгрузки.
import type { Segment, SpeakerSpan } from "./speakers.ts";
import type { RivalClaim } from "./meeting-rival.ts";

// Одна часть дорожки в Storage. segments заполняются ПОСЛЕ успешной транскрибации (offset уже
// прибавлен — глобальный сдвиг mic применяется на этапе summarize).
export interface Part {
  track: "sys" | "mic";
  name: string;
  offset: number;
  path: string; // путь в бакете meeting-audio
  done: boolean;
  attempts: number;
  error?: string; // текст последней ошибки транскрибации (#150): state переживает retention логов
  skipped?: string; // причина пропуска части (огрызок короче минимума Whisper, poison-guard) (#150)
  segments?: Segment[];
  lang?: string; // язык части, определённый Whisper (имя на англ.)
  viaFallback?: boolean; // сегменты пришли только из d.text-фолбэка (не настоящая речь) → не якорим
}
// speakers — необязательный таймлайн говорящих (секунды от начала записи), присланный полем
// `speakers` формы meeting-ingest. Живёт в той же jsonb-колонке meetings.process_state, миграции
// не требует; старые строки его не имеют — это и есть путь мягкой деградации.
//
// Поля второй записи одной встречи (T156) — все необязательные, старые состояния их не имеют и
// обрабатываются ровно как раньше:
//   gen      — поколение выгрузки. Воркер пишет в строку, только пока `process_state.gen` — его:
//              состояние, обнулённое перехватом claim или заменённое другой записью, он не
//              перетирает (раньше побеждал последний писавший, см. meeting-queue.requeueLost);
//   source   — чья выгрузка (`agent:<id>` | `person`, meeting-ingest/second-recording.ts);
//   sources  — все источники, чьи выгрузки встреча приняла (повтор не становится «второй записью»);
//   owner    — claim_owner на момент выгрузки;
//   challenge — вторая запись: в конце сравнить объём распознанного с текущей стенограммой и
//              оставить более полную; priorStatus — какой summary_status вернуть, если текущая полнее;
//   rival    — запись другого человека, претендента (meeting-rival.ts): владелец встречи перейдёт к
//              `owner` той же UPDATE, что пишет стенограмму, и только если осталась эта запись.
export interface ProcessState {
  parts: Part[];
  stage: "transcribe" | "summarize";
  speakers?: SpeakerSpan[];
  gen?: string;
  source?: string;
  sources?: string[];
  owner?: number;
  challenge?: { priorStatus: string | null };
  rival?: RivalClaim;
}
/** Кто и какую выгрузку кладёт в состояние (meeting-ingest). */
export interface UploadMeta {
  gen: string;
  source: string;
  sources: string[];
  owner: number;
  challenge?: { priorStatus: string | null };
  rival?: RivalClaim;
}
// Части в памяти (как их собрал meeting-ingest из multipart) до заливки в Storage.
export interface InMemoryPart {
  blob: Blob;
  name: string;
  offset: number;
}
export interface RecorderEntry {
  telegram_id: number;
  claimed_at?: string;
  role?: string;
}
export interface MeetingRow {
  id: string;
  group_id: string | null;
  title: string | null;
  recorders: RecorderEntry[] | null;
  source: string | null;
  claim_owner: number | null;
  mic_start_offset: number | null;
  summary_status: string | null;
  process_state: ProcessState | null;
}
