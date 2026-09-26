/**
 * Служба оркестратора: долгоживущий процесс рядом с Docker. Поднимает поводок, подхватывает
 * контейнеры прошлого запуска и опрашивает приглашения из веба (D017) — по каждому поднимает
 * бота от имени позвавшего, а на площадку без адаптера отвечает громким отказом.
 *
 * Запуск (внутри WSL2 рядом с Docker):
 *   node --experimental-transform-types bot/src/orchestrator/orchestrator-main.ts
 *
 * Окружение (перечень и смысл — docs/ARCHITECTURE.md, «Бот scriba: оркестратор встреч»):
 *   SCRIBA_SWARM_URL            — корень функций Swarm (обязательно);
 *   SCRIBA_BOT_TOKEN            — токен служебного агента (обязательно, только из секретов);
 *   SCRIBA_IMAGE                — образ контейнера встречи (обязательно);
 *   SCRIBA_LEASE_HOST_DIR       — каталог поводка на хосте (обязательно, свой у службы);
 *   SCRIBA_PROJECT              — имя стенда, метка контейнеров и тома (по умолчанию scriba);
 *   SCRIBA_BOT_VERSION          — номер сборки, уходит в heartbeat и заявку (по умолчанию 0);
 *   SCRIBA_INVITE_POLL_MS       — пауза между опросами приглашений (по умолчанию 5000);
 *   SCRIBA_CONTAINER_SWARM_URL  — корень функций, каким его видит контейнер (по умолчанию
 *                                 SCRIBA_SWARM_URL; для стенда — host.docker.internal);
 *   SCRIBA_CONTAINER_ENV        — JSON-объект добавочного окружения контейнера (ручки смоука).
 *
 * Кривое окружение — отказ на старте с именем переменной: служба, которая «работает» и никого
 * не зовёт, — ровно та тишина, против которой она заведена.
 */
import { DockerodeEngine } from "./docker-engine.ts";
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

async function main(environment: Environment): Promise<void> {
  const swarmUrl = required(environment, "SCRIBA_SWARM_URL");
  const token = required(environment, "SCRIBA_BOT_TOKEN");
  const version = positive(environment, "SCRIBA_BOT_VERSION", 0);
  const notifierFor = (onBehalfOf: number): Notifier =>
    new JournaledNotifier(new NoticeClient({ baseUrl: swarmUrl, token, onBehalfOf }), log);

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

  await orchestrator.init();
  trigger.start();
  log(`служба запущена: приглашения опрашиваются каждые ${String(intervalMs)} мс`);

  const shutdown = async (signal: string): Promise<void> => {
    log(`${signal}: перестаю опрашивать; идущие встречи не трогаю — поводок их отпустит`);
    await trigger.close();
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
