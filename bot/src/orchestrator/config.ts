/**
 * Окружение процесса встречи: имена переменных в одном месте и проверка на входе.
 *
 * Оркестратор кладёт их в контейнер при создании; процесс встречи читает здесь. Пустая
 * или кривая обязательная переменная — отказ на старте с именем переменной, а не встреча,
 * которая «пошла» и молча записала в никуда. Список совпадает с `bot/container/.env.example`.
 */
import type { MeetingTiming } from "./run-meeting.ts";

export const MEETING_ENV = {
  joinUrl: "SCRIBA_JOIN_URL",
  platform: "SCRIBA_PLATFORM",
  onBehalfOf: "SCRIBA_ON_BEHALF_OF",
  swarmUrl: "SCRIBA_SWARM_URL",
  token: "SCRIBA_BOT_TOKEN",
  runId: "SCRIBA_RUN_ID",
  version: "SCRIBA_BOT_VERSION",
  displayName: "SCRIBA_DISPLAY_NAME",
  leaseDir: "SCRIBA_LEASE_DIR",
  maxMinutes: "SCRIBA_MAX_MEETING_MINUTES",
  segmentSeconds: "SCRIBA_SEGMENT_SECONDS",
  doorWaitMs: "SCRIBA_DOOR_WAIT_MS",
  doorRepeatMs: "SCRIBA_DOOR_REPEAT_MS",
  aloneMs: "SCRIBA_ALONE_MS",
  heartbeatMs: "SCRIBA_HEARTBEAT_MS",
  pollMs: "SCRIBA_POLL_MS",
  smokeMeetPage: "SCRIBA_SMOKE_MEET_PAGE",
} as const;

/**
 * Площадки, для которых у бота есть адаптер. Остальные отвергаются до подъёма контейнера.
 */
const SUPPORTED_PLATFORMS = ["meet"] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

const DEFAULT_MAX_MINUTES = 240;

export interface MeetingConfig {
  readonly joinUrl: string;
  readonly platform: SupportedPlatform;
  readonly onBehalfOf: number;
  readonly swarmUrl: string;
  readonly token: string;
  readonly runId: string;
  readonly version: number;
  readonly displayName: string;
  readonly leaseDir: string;
  readonly maxMeetingMs: number;
  /**
   * Длина части; `null` — считать из битрейта под лимит meeting-ingest.
   */
  readonly segmentSeconds: number | null;
  readonly timing: Partial<MeetingTiming>;
  /**
   * Только для смоука: страница-двойник вместо meet.google.com.
   */
  readonly smokeMeetPage: string | null;
}

type Environment = Readonly<Record<string, string | undefined>>;

function text(environment: Environment, name: string): string | null {
  const value = environment[name]?.trim() ?? "";
  return value === "" ? null : value;
}

function required(environment: Environment, name: string): string {
  const value = text(environment, name);
  if (value === null) throw new Error(`${name} не задан`);
  return value;
}

function positiveInteger(environment: Environment, name: string): number | null {
  const raw = text(environment, name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} должен быть целым положительным числом, получено «${raw}»`);
  }
  return value;
}

/**
 * Площадка из строки. Незнакомая — отказ с перечнем тех, что бот умеет.
 */
export function parsePlatform(raw: string): SupportedPlatform {
  const known = SUPPORTED_PLATFORMS.find((platform) => platform === raw);
  if (known === undefined) {
    throw new Error(
      `площадка «${raw}» не поддерживается: адаптер есть только для ${SUPPORTED_PLATFORMS.join(", ")}`,
    );
  }
  return known;
}

function readTiming(environment: Environment): Partial<MeetingTiming> {
  const entries: [keyof MeetingTiming, string][] = [
    ["doorWaitMs", MEETING_ENV.doorWaitMs],
    ["doorRepeatMs", MEETING_ENV.doorRepeatMs],
    ["aloneMs", MEETING_ENV.aloneMs],
    ["heartbeatMs", MEETING_ENV.heartbeatMs],
    ["pollMs", MEETING_ENV.pollMs],
  ];
  const timing: Partial<Record<keyof MeetingTiming, number>> = {};
  for (const [key, name] of entries) {
    const value = positiveInteger(environment, name);
    if (value !== null) timing[key] = value;
  }
  return timing;
}

export function readMeetingConfig(environment: Environment): MeetingConfig {
  const onBehalfOf = positiveInteger(environment, MEETING_ENV.onBehalfOf);
  if (onBehalfOf === null) throw new Error(`${MEETING_ENV.onBehalfOf} не задан`);

  return {
    joinUrl: required(environment, MEETING_ENV.joinUrl),
    platform: parsePlatform(required(environment, MEETING_ENV.platform)),
    onBehalfOf,
    swarmUrl: required(environment, MEETING_ENV.swarmUrl),
    token: required(environment, MEETING_ENV.token),
    runId: required(environment, MEETING_ENV.runId),
    version: positiveInteger(environment, MEETING_ENV.version) ?? 0,
    displayName: text(environment, MEETING_ENV.displayName) ?? "scriba",
    leaseDir: text(environment, MEETING_ENV.leaseDir) ?? "/lease",
    maxMeetingMs:
      (positiveInteger(environment, MEETING_ENV.maxMinutes) ?? DEFAULT_MAX_MINUTES) * 60_000,
    segmentSeconds: positiveInteger(environment, MEETING_ENV.segmentSeconds),
    timing: readTiming(environment),
    smokeMeetPage: text(environment, MEETING_ENV.smokeMeetPage),
  };
}
