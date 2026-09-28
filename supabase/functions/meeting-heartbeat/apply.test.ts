// Настоящий applyWrites (write.ts) против таблиц в памяти: как удары бота ложатся в базу, когда
// два из них обрабатываются одновременно и их запросы перемешиваются в любом порядке.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AgentIdentity } from "../_shared/agent-auth.ts";
import {
  buildHeartbeatWrites,
  type HeartbeatWrite,
  MAX_RECORDED_SECONDS,
  RECORDED_GROWTH_FACTOR,
  type RecordedPrior,
  runHeartbeat,
  type WriteOutcome,
  type WriteStore,
} from "./write.ts";

const MEETING_ID = "0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";
const T1 = "2026-09-28T10:00:00.000Z";
const T2 = "2026-09-28T10:02:00.000Z";

const bot: AgentIdentity = { telegramId: 111, groupId: "alpha", kind: "bot", agentId: "scriba" };

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function freshTables(): Tables {
  return {
    meetings: [{
      id: MEETING_ID,
      group_id: "alpha",
      claim_owner: 111,
      agent_last_seen_at: null,
      agent_last_recording: false,
      recorded_seconds: 0,
      lease_expires_at: "2026-09-28T09:30:00.000Z",
    }],
    service_agents: [{ id: "scriba", last_seen_at: null, last_version: null }],
    allowed_users: [],
  };
}

function matches(row: Row, write: HeartbeatWrite): boolean {
  return Object.entries(write.match).every(([column, value]) => row[column] === value);
}

function fresher(row: Row, write: HeartbeatWrite): boolean {
  if (write.below) {
    const current = row[write.below.column];
    if (!(current === null || (typeof current === "number" && current < write.below.value))) return false;
  }
  if (!write.newerThan) return true;
  const current = row[write.newerThan.column];
  // ISO-строки одного формата сравниваются как время — как `lt` в Postgres для timestamptz.
  return current === null || (typeof current === "string" && current < write.newerThan.value);
}

/** Таблицы в памяти с той же семантикой, что UPDATE … WHERE match AND (col is null OR col < value). */
function readPrior(tables: Tables, write: HeartbeatWrite): RecordedPrior | null {
  const row = tables[write.table].find((r) => matches(r, write));
  if (!row) return null;
  return {
    recorded_seconds: row.recorded_seconds as number | null,
    agent_last_seen_at: row.agent_last_seen_at as string | null,
    lease_expires_at: row.lease_expires_at as string | null,
  };
}

function memoryStore(tables: Tables): WriteStore {
  return {
    update(write) {
      const hit = tables[write.table].filter((row) => matches(row, write) && fresher(row, write));
      for (const row of hit) Object.assign(row, write.patch);
      return Promise.resolve(hit.length);
    },
    count(write) {
      return Promise.resolve(tables[write.table].filter((row) => matches(row, write)).length);
    },
    read(write) {
      return Promise.resolve(readPrior(tables, write));
    },
  };
}

/**
 * Хранилище, где каждый запрос удара ждёт разрешения теста: так задаётся порядок, в котором
 * запросы двух ударов доходят до базы. Метка — чей это удар.
 */
function steppedStore(inner: WriteStore) {
  const waiting: Array<{ label: string; release: () => void }> = [];
  const wrap = (label: string): WriteStore => ({
    update: async (write) => {
      await new Promise<void>((release) => waiting.push({ label, release }));
      return inner.update(write);
    },
    count: async (write) => {
      await new Promise<void>((release) => waiting.push({ label, release }));
      return inner.count(write);
    },
    read: async (write) => {
      await new Promise<void>((release) => waiting.push({ label, release }));
      return inner.read(write);
    },
  });
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  /** Пропустить следующий запрос удара `label`; false — у удара больше нет запросов. */
  const step = async (label: string): Promise<boolean> => {
    await tick();
    const index = waiting.findIndex((w) => w.label === label);
    if (index === -1) return false;
    const [entry] = waiting.splice(index, 1);
    entry.release();
    await tick();
    return true;
  };
  return { wrap, step };
}

function beatWrites(nowIso: string, version: number, seconds: number): HeartbeatWrite[] {
  return buildHeartbeatWrites(
    bot,
    { recording: true, version, meeting_id: MEETING_ID, recorded_seconds: seconds },
    nowIso,
  );
}

// Порядки, в которых могут дойти до базы запросы двух ударов: старого (O) и нового (N). У удара с
// секундами их до четырёх (чтение строки, встреча с секундами, встреча без секунд или агент, …) —
// все перестановки первых 4+4, остаток досчитывается.
function interleavings(o: number, n: number): string[] {
  if (o === 0) return ["N".repeat(n)];
  if (n === 0) return ["O".repeat(o)];
  return [
    ...interleavings(o - 1, n).map((rest) => `O${rest}`),
    ...interleavings(o, n - 1).map((rest) => `N${rest}`),
  ];
}
const ORDERS = interleavings(4, 4);

async function race(order: string): Promise<{ tables: Tables; outcomes: Record<string, WriteOutcome> }> {
  const tables = freshTables();
  const stepped = steppedStore(memoryStore(tables));
  const older = runHeartbeat(beatWrites(T1, 40, 600), stepped.wrap("O"), T1);
  const newer = runHeartbeat(beatWrites(T2, 41, 720), stepped.wrap("N"), T2);
  for (const label of order) await stepped.step(label);
  // Досчитать остаток (проверка «опоздал или не твоя» у опоздавшего удара).
  while ((await stepped.step("O")) || (await stepped.step("N"))) { /* до конца */ }
  return { tables, outcomes: { O: await older, N: await newer } };
}

Deno.test("ЯДРО: при перестановке ударов версия и время агента не залипают на старом ударе", async () => {
  // Опасный порядок — встреча O, встреча N, агент N, агент O: без условия свежести на строке
  // агента старый удар последним вернул бы last_version=40 и last_seen_at назад, и сборка,
  // которая работает на самом деле, выглядела бы старой.
  for (const order of ORDERS) {
    const { tables } = await race(order);
    const agent = tables.service_agents[0];
    assertEquals(agent.last_version, 41, `порядок ${order}: last_version`);
    assertEquals(agent.last_seen_at, T2, `порядок ${order}: last_seen_at`);
  }
});

Deno.test("ЯДРО: при перестановке ударов записанные секунды и лиз остаются от свежего удара", async () => {
  // Опоздавший удар с меньшими секундами занизил бы запись бота для арбитража meeting-claim.
  for (const order of ORDERS) {
    const { tables } = await race(order);
    const meeting = tables.meetings[0];
    assertEquals(meeting.recorded_seconds, 720, `порядок ${order}: recorded_seconds`);
    assertEquals(meeting.lease_expires_at, "2026-09-28T10:32:00.000Z", `порядок ${order}: лиз`);
    assertEquals(meeting.agent_last_seen_at, T2, `порядок ${order}: agent_last_seen_at`);
  }
});

Deno.test("опоздавший удар отвечает stale и строку агента не трогает", async () => {
  const tables = freshTables();
  const store = memoryStore(tables);
  assertEquals(await runHeartbeat(beatWrites(T2, 41, 720), store, T2), "ok");
  // Строка агента свежая, но старая сборка «откатила» бы её, если бы stale писал дальше.
  tables.service_agents[0].last_seen_at = "2026-09-28T09:00:00.000Z";
  assertEquals(await runHeartbeat(beatWrites(T1, 40, 600), store, T1), "stale");
  assertEquals(tables.service_agents[0].last_version, 41);
});

Deno.test("удар по чужой встрече — missed, строка агента не освежена", async () => {
  const tables = freshTables();
  tables.meetings[0].claim_owner = 222; // право ушло рекордеру другого человека
  const outcome = await runHeartbeat(beatWrites(T1, 40, 600), memoryStore(tables), T1);
  assertEquals(outcome, "missed");
  assertEquals(tables.service_agents[0].last_seen_at, null);
  assertEquals(tables.meetings[0].lease_expires_at, "2026-09-28T09:30:00.000Z");
  assertEquals(tables.meetings[0].recorded_seconds, 0);
});

Deno.test("удар без встречи освежает только строку агента", async () => {
  const tables = freshTables();
  const writes = buildHeartbeatWrites(bot, { recording: false, version: 41 }, T1);
  assertEquals(await runHeartbeat(writes, memoryStore(tables), T1), "ok");
  assertEquals(tables.service_agents[0].last_version, 41);
  assertEquals(tables.meetings[0].agent_last_seen_at, null);
});

Deno.test("ЯДРО: удар с сутками секунд ложится в базу урезанным до прошедшего времени", async () => {
  // Лиз выдан claim-ом в 09:00 (истекает 09:30), удар в 10:00: записать можно не больше часа с запасом.
  const tables = freshTables();
  const outcome = await runHeartbeat(beatWrites(T1, 40, MAX_RECORDED_SECONDS), memoryStore(tables), T1);
  assertEquals(outcome, "ok");
  assertEquals(tables.meetings[0].recorded_seconds, 3600 * RECORDED_GROWTH_FACTOR);
});

Deno.test("ЯДРО: удар после запасной записи того же человека секунды встречи не занижает", async () => {
  const tables = freshTables();
  tables.meetings[0].recorded_seconds = 1200; // рекордер того же человека — запасная (D020)
  tables.meetings[0].agent_last_seen_at = "2026-09-28T09:58:00.000Z";
  assertEquals(await runHeartbeat(beatWrites(T1, 40, 660), memoryStore(tables), T1), "ok");
  assertEquals(tables.meetings[0].recorded_seconds, 1200);
  assertEquals(tables.meetings[0].agent_last_seen_at, T1, "сам удар при этом лёг");
});

Deno.test("ЯДРО: удары recording:false не продлевают лиз — встреча освобождается в срок", async () => {
  const tables = freshTables();
  const writes = buildHeartbeatWrites(bot, { recording: false, meeting_id: MEETING_ID, recorded_seconds: 300 }, T1);
  assertEquals(await runHeartbeat(writes, memoryStore(tables), T1), "ok");
  assertEquals(tables.meetings[0].lease_expires_at, "2026-09-28T09:30:00.000Z");
  assertEquals(tables.meetings[0].agent_last_recording, false);
  assertEquals(tables.meetings[0].recorded_seconds, 300, "финальные секунды записаны");
});

Deno.test("ЯДРО: секунды выросли между чтением и записью (запасная запись того же человека) — удар всё равно ложится", async () => {
  // meeting-claim `reserve` поднимает recorded_seconds той же строки в любой момент. Запись
  // «встреча + секунды» тогда промахивается по росту секунд — но удар бота обязан лечь: иначе
  // лиз не продлится и бот, который пишет, ответит stale и потеряет встречу через 30 минут.
  const tables = freshTables();
  const inner = memoryStore(tables);
  const store: WriteStore = {
    ...inner,
    async read(write) {
      const prior = await inner.read(write);
      tables.meetings[0].recorded_seconds = 5000;
      return prior;
    },
  };
  assertEquals(await runHeartbeat(beatWrites(T1, 40, 600), store, T1), "ok");
  assertEquals(tables.meetings[0].recorded_seconds, 5000, "секунды не занижены");
  assertEquals(tables.meetings[0].agent_last_seen_at, T1);
  assertEquals(tables.meetings[0].lease_expires_at, "2026-09-28T10:30:00.000Z", "лиз продлён");
  assertEquals(tables.service_agents[0].last_version, 40);
});
