/**
 * Служба оркестратора: долгоживущий процесс рядом с Docker. Поднимает поводок, подхватывает
 * контейнеры прошлого запуска, раз в минуту берёт задания по календарям людей (T100) и опрашивает
 * приглашения из веба (D017) — по каждому поднимает бота от имени человека, а на площадку без
 * адаптера отвечает громким отказом.
 *
 * Запуск (внутри WSL2 рядом с Docker):
 *   node bot/src/orchestrator/orchestrator-main.ts
 *
 * Окружение (перечень и смысл — docs/ARCHITECTURE.md, «Бот scriba: оркестратор встреч»):
 *   SCRIBA_SWARM_URL            — корень функций Swarm (обязательно);
 *   SCRIBA_BOT_TOKEN            — токен служебного агента (обязательно, только из секретов);
 *   SCRIBA_IMAGE                — образ контейнера встречи (обязательно);
 *   SCRIBA_LEASE_HOST_DIR       — каталог поводка на хосте (обязательно, свой у службы);
 *   SCRIBA_PROJECT              — имя стенда, метка контейнеров и томов (по умолчанию scriba);
 *   SCRIBA_BOT_VERSION          — номер сборки, уходит в heartbeat и заявку (по умолчанию 0);
 *   SCRIBA_INVITE_POLL_MS       — пауза между опросами приглашений (по умолчанию 5000);
 *   SCRIBA_CALENDAR_POLL_MS     — пауза между проходами по календарям (по умолчанию 60000);
 *   SCRIBA_CONTAINER_SWARM_URL  — корень функций, каким его видит контейнер (по умолчанию
 *                                 SCRIBA_SWARM_URL; для стенда — host.docker.internal);
 *   SCRIBA_CONTAINER_ENV        — JSON-объект добавочного окружения контейнера (ручки смоука).
 *   SCRIBA_MAX_MEETINGS         — потолок одновременных встреч (по умолчанию 4); сверх него —
 *                                 громкий отказ человеку, контейнер не поднимается;
 *   SCRIBA_CONTAINER_MEMORY_MB  — потолок памяти контейнера встречи, МБ (по умолчанию 2048);
 *   SCRIBA_CONTAINER_CPUS       — потолок процессора контейнера, ядер (по умолчанию 2);
 *   SCRIBA_CONTAINER_PIDS       — потолок процессов и потоков контейнера (по умолчанию 1024);
 *   SCRIBA_GOOGLE_STATE_FILE    — сохранённый вход аккаунта бота (storageState, T175); задан —
 *                                 обязателен и SCRIBA_ACCOUNT_COPIES_DIR. Файла нет — гостем;
 *   SCRIBA_ACCOUNT_COPIES_DIR   — каталог копий входа, путь как у демона Docker (приём поводка):
 *                                 в контейнер монтируется своя копия одним файлом на чтение.
 *
 * Кривое окружение — отказ на старте с именем переменной: служба, которая «работает» и никого
 * не зовёт, — ровно та тишина, против которой она заведена.
 */
import {
  type ContainerLimits,
  DEFAULT_CONTAINER_LIMITS,
  DEFAULT_MAX_MEETINGS,
} from "../container/isolation.ts";
import { type AccountCopies, FileAccountCopies } from "./account.ts";
import { DockerodeEngine } from "./docker-engine.ts";
import { calendarTriggerFor } from "./calendar-service.ts";
import { inviteTriggerFor } from "./invite-service.ts";
import { NoticeClient } from "./notice-client.ts";
import { JournaledNotifier, type Notifier } from "./notices.ts";
import { Orchestrator } from "./orchestrator.ts";

type Environment = Readonly<Record<string, string | undefined>>;

function log(line: string): void {
  console.log(`[orchestrator ${new Date().toISOString()}] ${line}`);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim() ?? "";
  if (value === "") throw new Error(`${name} не задан`);
  return value;
}

function positive(environment: Environment, name: string, fallback: number): number {
  const raw = environment[name]?.trim() ?? "";
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} должен быть целым неотрицательным числом, получено «${raw}»`);
  }
  return value;
}

function extraEnvironment(environment: Environment): Record<string, string> {
  const raw = environment.SCRIBA_CONTAINER_ENV?.trim() ?? "";
  if (raw === "") return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SCRIBA_CONTAINER_ENV должен быть JSON-объектом");
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

const MIB = 1024 * 1024;
const NANO_PER_CPU = 1_000_000_000;

/**
 * Потолки контейнера встречи из окружения; не задано — значения по умолчанию, а не «без
 * ограничений». Ноль или мусор — служба не стартует (проверка в `isolation.ts`).
 */
function containerLimits(environment: Environment): ContainerLimits {
  const base = DEFAULT_CONTAINER_LIMITS;
  return {
    memoryBytes: positive(environment, "SCRIBA_CONTAINER_MEMORY_MB", base.memoryBytes / MIB) * MIB,
    nanoCpus:
      positive(environment, "SCRIBA_CONTAINER_CPUS", base.nanoCpus / NANO_PER_CPU) * NANO_PER_CPU,
    pids: positive(environment, "SCRIBA_CONTAINER_PIDS", base.pids),
  };
}

/**
 * Вход аккаунта бота: обе переменные вместе или ни одной. Половина — ошибка настройки стенда,
 * и молча пойти гостем значило бы спрятать её за «Meet не пустил».
 */
function accountCopies(environment: Environment): AccountCopies | undefined {
  const stateFile = nonEmpty(environment.SCRIBA_GOOGLE_STATE_FILE);
  const copiesDirectory = nonEmpty(environment.SCRIBA_ACCOUNT_COPIES_DIR);
  if (stateFile === undefined && copiesDirectory === undefined) {
    log("вход аккаунта бота не настроен — бот ходит на встречи гостем");
    return undefined;
  }
  if (stateFile === undefined || copiesDirectory === undefined) {
    throw new Error("SCRIBA_GOOGLE_STATE_FILE и SCRIBA_ACCOUNT_COPIES_DIR задаются только вместе");
  }
  return new FileAccountCopies({ stateFile, copiesDirectory, log });
}

async function main(environment: Environment): Promise<void> {
  const swarmUrl = required(environment, "SCRIBA_SWARM_URL");
  const token = required(environment, "SCRIBA_BOT_TOKEN");
  const version = positive(environment, "SCRIBA_BOT_VERSION", 0);
  // Нотиса за человека — по пропуску его встречи (T165); общий токен сервер за человека не принимает.
  const notifierFor = (onBehalfOf: number, grant: string): Notifier =>
    new JournaledNotifier(new NoticeClient({ baseUrl: swarmUrl, token: grant, onBehalfOf }), log);

  const account = accountCopies(environment);
  const orchestrator = new Orchestrator({
    engine: new DockerodeEngine(),
    project: nonEmpty(environment.SCRIBA_PROJECT) ?? "scriba",
    image: required(environment, "SCRIBA_IMAGE"),
    leaseDirectory: required(environment, "SCRIBA_LEASE_HOST_DIR"),
    swarmUrl: nonEmpty(environment.SCRIBA_CONTAINER_SWARM_URL) ?? swarmUrl,
    token,
    version,
    notifierFor,
    log,
    extraEnv: extraEnvironment(environment),
    maxMeetings: positive(environment, "SCRIBA_MAX_MEETINGS", DEFAULT_MAX_MEETINGS),
    limits: containerLimits(environment),
    ...(account !== undefined && { account }),
  });
  const intervalMs = positive(environment, "SCRIBA_INVITE_POLL_MS", 5000);
  const trigger = inviteTriggerFor({
    swarmUrl,
    token,
    version,
    startForMeeting: async (joinUrl, platform, onBehalfOf, invite) =>
      orchestrator.startForMeeting(joinUrl, platform, onBehalfOf, invite),
    notifierFor,
    log,
    intervalMs,
  });

  const calendarMs = positive(environment, "SCRIBA_CALENDAR_POLL_MS", 60_000);
  const calendar = calendarTriggerFor({
    swarmUrl,
    token,
    version,
    startForMeeting: async (joinUrl, platform, onBehalfOf, event) =>
      orchestrator.startForMeeting(joinUrl, platform, onBehalfOf, event),
    notifierFor,
    log,
    intervalMs: calendarMs,
  });

  await orchestrator.init();
  trigger.start();
  calendar.start();
  log(
    `служба запущена: приглашения опрашиваются каждые ${String(intervalMs)} мс, календари — каждые ${String(calendarMs)} мс`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    log(`${signal}: перестаю опрашивать; идущие встречи не трогаю — поводок их отпустит`);
    await Promise.all([trigger.close(), calendar.close()]);
    orchestrator.close();
    // eslint-disable-next-line unicorn/no-process-exit -- служба и есть CLI
    process.exit(0);
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
}

try {
  await main(process.env);
} catch (error) {
  log(`СЛУЖБА НЕ ЗАПУСТИЛАСЬ: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
