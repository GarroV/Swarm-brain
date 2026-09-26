/**
 * Смоук оркестратора: НАСТОЯЩИЙ Docker, настоящий образ, настоящие Chromium и ffmpeg в
 * контейнере; сервер — двойник `fake-swarm`, звонок — страница-двойник Meet.
 *
 * Что проверяет (мерило блока): контейнер поднимается на встречу, заходит, пишет звук,
 * отдаёт запись в meeting-ingest и гасится; смерть контейнера видна (код выхода, нотиса,
 * heartbeat замолкает на `recording: true`); после падения оркестратора (настоящий SIGKILL
 * процесса) сирот не остаётся, а новый оркестратор подхватывает живые контейнеры.
 *
 * Живой вход в настоящую встречу Google сюда не входит — это T004 (нужен аккаунт и человек).
 *
 * Запуск с хоста, образ собран заранее:
 *   docker build -f bot/container/Dockerfile -t scriba-orchestrator:dev bot/
 *   SCRIBA_SMOKE_STATE=<каталог> node --experimental-transform-types bot/src/orchestrator/smoke-orchestrator.ts
 *
 * Переменные:
 *   SCRIBA_SMOKE_STATE    — каталог под поводки (обязателен: только свой, не общий tmp);
 *   SCRIBA_SMOKE_PROJECT  — имя стенда, по умолчанию scriba-orchestrator;
 *   SCRIBA_SMOKE_IMAGE    — образ, по умолчанию scriba-orchestrator:dev;
 *   SCRIBA_SMOKE_PORT     — порт двойника сервера, по умолчанию 4361;
 *   SCRIBA_SMOKE_ONLY     — через запятую: какие сценарии гнать (по умолчанию все).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import Docker from "dockerode";

import { startFakeSwarm } from "../swarm-client/testing/fake-swarm.ts";
import { DockerodeEngine } from "./docker-engine.ts";
import { LogNotifier } from "./notices.ts";
import { type ContainerId, LABEL, Orchestrator } from "./orchestrator.ts";

const PROJECT = process.env.SCRIBA_SMOKE_PROJECT ?? "scriba-orchestrator";
const IMAGE = process.env.SCRIBA_SMOKE_IMAGE ?? "scriba-orchestrator:dev";
const PORT = Number(process.env.SCRIBA_SMOKE_PORT ?? "4361");
const STATE = process.env.SCRIBA_SMOKE_STATE ?? "";
const TOKEN = "smoke-bot-token";
const PERSON = 744_230_399;
const MEET = "https://meet.google.com/abc-defg-hij";
const SWARM_URL = `http://host.docker.internal:${String(PORT)}`;

const SHORT_PAGE = "/app/src/orchestrator/fixtures/meeting.html";
const LONG_PAGE = "/app/src/orchestrator/fixtures/meeting-long.html";
const DOOR_PAGE = "/app/src/meet-adapter/fixtures/waiting.html";

const BASE_ENV: Record<string, string> = {
  SCRIBA_ALONE_MS: "6000",
  SCRIBA_POLL_MS: "1000",
  SCRIBA_SEGMENT_SECONDS: "3",
  SCRIBA_HEARTBEAT_MS: "3000",
  SCRIBA_DOOR_WAIT_MS: "4000",
  SCRIBA_DOOR_REPEAT_MS: "4000",
};

const failures: string[] = [];

function check(isPassed: boolean, what: string, detail = ""): void {
  const line = detail === "" ? what : `${what} — ${detail}`;
  if (isPassed) {
    console.log(`  ✔ ${line}`);
  } else {
    failures.push(line);
    console.log(`  ✘ ${line}`);
  }
}

function seconds(ms: number): string {
  return String(Math.round(ms / 1000));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function within<T>(ms: number, what: string, task: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what}: не уложились в ${String(ms / 1000)} с`));
    }, ms);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(ms: number, what: string, isDone: () => Promise<boolean>): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await isDone()) return Date.now() - started;
    await sleep(1000);
  }
  throw new Error(`${what}: не дождались за ${String(ms / 1000)} с`);
}

function orchestratorFor(leaseName: string, page: string, isVerbose = true): Orchestrator {
  return new Orchestrator({
    engine: new DockerodeEngine(),
    project: PROJECT,
    image: IMAGE,
    leaseDirectory: path.join(STATE, leaseName),
    swarmUrl: SWARM_URL,
    token: TOKEN,
    version: 1,
    notifier: new LogNotifier((line) => {
      console.log(`    [notice] ${line}`);
    }),
    log: isVerbose
      ? (line): void => {
          console.log(`    [orchestrator] ${line.split("\n", 1)[0] ?? ""}`);
        }
      : (): void => {
          // тихий режим
        },
    extraEnv: { ...BASE_ENV, SCRIBA_SMOKE_MEET_PAGE: page },
  });
}

async function hasContainer(id: string): Promise<boolean> {
  const ids = await ourContainers();
  return ids.includes(id);
}

async function isStandEmpty(): Promise<boolean> {
  const ids = await ourContainers();
  return ids.length === 0;
}

async function ourContainers(): Promise<string[]> {
  const docker = new Docker();
  const found = await docker.listContainers({
    all: true,
    filters: { label: [`${LABEL.project}=${PROJECT}`] },
  });
  return found.map((info) => info.Id);
}

async function waitMeetingId(orchestrator: Orchestrator, id: ContainerId): Promise<string> {
  const current = (): string | null =>
    orchestrator.list().find((item) => item.id === id)?.meetingId ?? null;
  await until(90_000, "meeting_id в журнале контейнера", async () => {
    await sleep(0);
    return current() !== null;
  });
  return current() ?? "";
}

type Fake = Awaited<ReturnType<typeof startFakeSwarm>>;

interface Beat {
  readonly recording: boolean;
}

function heartbeatsFor(fake: Fake, meetingKey: string | null): Beat[] {
  return fake
    .requestsTo("/meeting-heartbeat")
    .map((request) => request.body as Record<string, unknown> | null)
    .filter(
      (body) =>
        meetingKey === null || body?.meeting_key === meetingKey || body?.meeting_key === undefined,
    )
    .map((body) => ({ recording: body?.recording === true }));
}

async function sceneFullMeeting(fake: Fake): Promise<void> {
  console.log("\n──── встреча целиком: поднялся → зашёл → записал → отдал → погас");
  const orchestrator = orchestratorFor("lease-main", SHORT_PAGE);
  await orchestrator.init();
  const before = fake.ingested.length;
  const beatsBefore = fake.requestsTo("/meeting-heartbeat").length;
  try {
    const id = await orchestrator.startForMeeting(MEET, "meet", PERSON);
    const exit = await within(180_000, "конец встречи", orchestrator.whenExited(id));
    check(exit?.kind === "finished", "контейнер вышел штатно", JSON.stringify(exit));
    check(exit?.kind === "finished" && exit.outcome === "recorded", "исход — recorded");

    const record = fake.ingested.at(-1);
    check(fake.ingested.length === before + 1, "meeting-ingest принял запись");
    check(
      (record?.sys.length ?? 0) >= 2,
      "запись пришла частями",
      `частей ${String(record?.sys.length ?? 0)}`,
    );
    const offsets = record?.sys.map((part) => part.offset) ?? [];
    check(
      offsets.every((offset, index) => index === 0 || offset > (offsets[index - 1] ?? 0)),
      "сдвиги частей растут",
      offsets.join(","),
    );
    const names = new Set(record?.speakers?.map((span) => span.name));
    check(names.has("Василий Гарро"), "таймлайн говорящих дошёл", [...names].join(","));

    const beats = fake.requestsTo("/meeting-heartbeat").slice(beatsBefore);
    const flags = beats.map(
      (request) => (request.body as Record<string, unknown> | null)?.recording,
    );
    check(flags.includes(true), "heartbeat шёл с recording:true во время записи");
    check(
      flags.at(-1) === false,
      "последний heartbeat — recording:false (штатный конец)",
      flags.join(","),
    );

    await until(30_000, "контейнер убран", isStandEmpty);
    check(true, "после встречи контейнеров стенда не осталось");
  } finally {
    orchestrator.close();
  }
}

async function sceneTwoAtOnce(fake: Fake): Promise<void> {
  console.log("\n──── два контейнера одновременно не мешают друг другу");
  const orchestrator = orchestratorFor("lease-main", SHORT_PAGE);
  await orchestrator.init();
  const before = fake.ingested.length;
  try {
    const first = await orchestrator.startForMeeting(MEET, "meet", PERSON);
    const second = await orchestrator.startForMeeting(MEET, "meet", PERSON);
    check(orchestrator.list().length === 2, "оба под присмотром");
    const exits = await within(
      240_000,
      "конец обеих встреч",
      Promise.all([orchestrator.whenExited(first), orchestrator.whenExited(second)]),
    );
    check(
      exits.every((exit) => exit?.kind === "finished"),
      "оба вышли штатно",
      JSON.stringify(exits),
    );
    const records = fake.ingested.slice(before);
    const ids = new Set(records.map((record) => record.meeting_id));
    check(
      records.length === 2 && ids.size === 2,
      "две записи в две разные встречи",
      [...ids].join(","),
    );
    check(
      records.every((record) => record.sys.length > 0),
      "у каждой есть звук",
    );
  } finally {
    orchestrator.close();
  }
}

async function sceneDeath(fake: Fake): Promise<void> {
  console.log(
    "\n──── контейнер умер посреди встречи: смерть видна, heartbeat замолкает на recording:true",
  );
  const orchestrator = orchestratorFor("lease-main", LONG_PAGE);
  await orchestrator.init();
  try {
    const id = await orchestrator.startForMeeting(MEET, "meet", PERSON);
    const meetingId = await waitMeetingId(orchestrator, id);
    const meetingKey = meetingId.replace(/^m-/u, "");
    // Даём записи пойти и heartbeat'у — отбить хотя бы раз.
    await until(60_000, "heartbeat с recording:true", async () => {
      await sleep(0);
      return heartbeatsFor(fake, meetingKey).some((beat) => beat.recording);
    });
    const beatsAtKill = fake.requestsTo("/meeting-heartbeat").length;
    await new Docker().getContainer(id).kill();
    const exit = await within(30_000, "смерть замечена", orchestrator.whenExited(id));
    check(exit?.kind === "died", "оркестратор увидел смерть", JSON.stringify(exit));
    check(exit?.kind === "died" && exit.exitCode === 137, "код выхода 137 (SIGKILL)");
    check(
      exit?.kind === "died" && exit.meetingId === meetingId,
      "смерть привязана к meeting_id",
      meetingId,
    );

    await sleep(8000);
    const after = fake.requestsTo("/meeting-heartbeat").slice(beatsAtKill);
    check(
      after.length === 0,
      "после смерти heartbeat замолчал",
      `пришло ещё ${String(after.length)}`,
    );
    const last = heartbeatsFor(fake, meetingKey).at(-1);
    check(
      last?.recording === true,
      "последний heartbeat остался recording:true — сигнал «запись оборвалась»",
    );
    await until(30_000, "контейнер убран", isStandEmpty);
    check(true, "умерший контейнер убран");
  } finally {
    orchestrator.close();
  }
}

async function sceneStop(fake: Fake): Promise<void> {
  console.log("\n──── stop(): контейнер гасится по просьбе и отдаёт записанное");
  const orchestrator = orchestratorFor("lease-main", LONG_PAGE);
  await orchestrator.init();
  const before = fake.ingested.length;
  try {
    const id = await orchestrator.startForMeeting(MEET, "meet", PERSON);
    await waitMeetingId(orchestrator, id);
    await sleep(10_000);
    await within(180_000, "stop", orchestrator.stop(id));
    const exit = orchestrator.exitOf(id);
    check(exit?.kind === "finished", "вышел штатно после SIGTERM", JSON.stringify(exit));
    check(fake.ingested.length === before + 1, "записанное до остановки ушло в meeting-ingest");
  } finally {
    orchestrator.close();
  }
}

async function sceneDoor(fake: Fake): Promise<void> {
  console.log("\n──── не впустили: две нотисы двери, выход, записи нет");
  const orchestrator = orchestratorFor("lease-main", DOOR_PAGE);
  await orchestrator.init();
  const before = fake.ingested.length;
  try {
    const id = await orchestrator.startForMeeting(MEET, "meet", PERSON);
    const exit = await within(120_000, "уход от двери", orchestrator.whenExited(id));
    check(
      exit?.kind === "finished" && exit.outcome === "door_timeout",
      "исход door_timeout",
      JSON.stringify(exit),
    );
    check(fake.ingested.length === before, "ничего не отправлено");
  } finally {
    orchestrator.close();
  }
}

/**
 * Дочерний процесс: оркестратор, которого родитель убьёт SIGKILL'ом.
 */
async function child(): Promise<void> {
  const orchestrator = orchestratorFor(
    process.env.SCRIBA_SMOKE_CHILD_LEASE ?? "lease-child",
    LONG_PAGE,
    false,
  );
  await orchestrator.init();
  const id = await orchestrator.startForMeeting(MEET, "meet", PERSON);
  console.log(`CHILD_CONTAINER ${id}`);
  // Живём, пока не убьют: поводок двигается таймером.
  await new Promise<never>(() => {
    // промис без исхода: процесс держит таймер поводка до SIGKILL
  });
}

async function spawnChild(leaseName: string): Promise<{ id: string; kill: () => void }> {
  const script = fileURLToPath(import.meta.url);
  const proc = spawn(process.execPath, [...process.execArgv, script, "child"], {
    env: { ...process.env, SCRIBA_SMOKE_CHILD_LEASE: leaseName },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const reader = createInterface({ input: proc.stdout });
  const id = await within(
    60_000,
    "дочерний оркестратор поднял контейнер",
    new Promise<string>((resolve) => {
      reader.on("line", (line) => {
        if (line.startsWith("CHILD_CONTAINER ")) resolve(line.slice("CHILD_CONTAINER ".length));
      });
    }),
  );
  return {
    id,
    kill: (): void => {
      proc.kill("SIGKILL");
    },
  };
}

async function sceneOrphans(fake: Fake): Promise<void> {
  console.log(
    "\n──── оркестратор убит SIGKILL: контейнер-сирота сам заканчивает встречу и исчезает",
  );
  const before = fake.ingested.length;
  const spawned = await spawnChild("lease-orphan");
  await sleep(15_000);
  spawned.kill();
  const killedAt = Date.now();
  console.log(
    `    оркестратор (pid дочернего процесса) убит; жду, пока контейнер ${spawned.id.slice(0, 12)} уйдёт сам`,
  );
  const gone = await until(300_000, "сирота ушёл", async () => !(await hasContainer(spawned.id)));
  check(
    true,
    "сирот не осталось",
    `контейнер ушёл через ${seconds(Date.now() - killedAt)} с после смерти оркестратора (ждали ${seconds(gone)} с)`,
  );
  check(fake.ingested.length === before + 1, "записанное сиротой отдано, а не брошено");
}

async function sceneAdopt(fake: Fake): Promise<void> {
  console.log("\n──── оркестратор убит и поднят снова: живой контейнер подхвачен и управляем");
  const before = fake.ingested.length;
  const spawned = await spawnChild("lease-adopt");
  await sleep(10_000);
  spawned.kill();
  await sleep(5000);
  const successor = orchestratorFor("lease-adopt", LONG_PAGE);
  try {
    await successor.init();
    check(
      successor.list().some((item) => item.id === spawned.id),
      "новый оркестратор подхватил живой контейнер",
    );
    await sleep(100_000);
    check(
      await hasContainer(spawned.id),
      "подхваченный не счёл себя сиротой за 100 с (поводок снова двигается)",
    );
    await within(180_000, "stop подхваченного", successor.stop(spawned.id));
    check(successor.exitOf(spawned.id)?.kind === "finished", "подхваченный погашен штатно");
    check(fake.ingested.length === before + 1, "его запись ушла");
  } finally {
    successor.close();
  }
}

const SCENES: Record<string, (fake: Fake) => Promise<void>> = {
  full: sceneFullMeeting,
  two: sceneTwoAtOnce,
  death: sceneDeath,
  stop: sceneStop,
  door: sceneDoor,
  orphans: sceneOrphans,
  adopt: sceneAdopt,
};

async function suite(): Promise<number> {
  if (STATE === "") {
    console.error("SCRIBA_SMOKE_STATE не задан: поводкам нужен свой каталог");
    return 2;
  }
  const leftovers = await ourContainers();
  if (leftovers.length > 0) {
    console.error(
      `на стенде ${PROJECT} уже есть контейнеры (${String(leftovers.length)}) — сначала убрать`,
    );
    return 2;
  }
  const selected = process.env.SCRIBA_SMOKE_ONLY ?? "";
  const only = selected === "" ? Object.keys(SCENES) : selected.split(",");
  const fake = await startFakeSwarm({ token: TOKEN, onBehalfOf: PERSON, port: PORT });
  try {
    for (const name of only) {
      const scene = SCENES[name];
      if (scene === undefined) {
        failures.push(`сценарий «${name}» не существует`);
        continue;
      }
      try {
        await scene(fake);
      } catch (error) {
        check(
          false,
          `сценарий ${name} сорвался`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  } finally {
    await fake.close();
  }
  console.log(
    failures.length === 0
      ? `\nИТОГ: зелёный — сценарии ${only.join(", ")}`
      : `\nИТОГ: КРАСНЫЙ — ${String(failures.length)} провал(ов):\n  ${failures.join("\n  ")}`,
  );
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[2] === "child") {
  await child();
} else {
  process.exitCode = await suite();
  // Таймеры dockerode-потоков не должны держать процесс смоука.
  // eslint-disable-next-line unicorn/no-process-exit -- смоук — CLI
  process.exit();
}
