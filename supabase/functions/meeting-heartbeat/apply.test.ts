// Настоящий applyWrites (write.ts) против таблиц в памяти: как удары бота ложатся в базу, когда
// два из них обрабатываются одновременно и их запросы перемешиваются в любом порядке.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AgentIdentity } from "../_shared/agent-auth.ts";
import { applyWrites, buildHeartbeatWrites, type HeartbeatWrite, type WriteOutcome, type WriteStore } from "./write.ts";

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
  if (!write.newerThan) return true;
  const current = row[write.newerThan.column];
  // ISO-строки одного формата сравниваются как время — как `lt` в Postgres для timestamptz.
  return current === null || (typeof current === "string" && current < write.newerThan.value);
}

/** Таблицы в памяти с той же семантикой, что UPDATE … WHERE match AND (col is null OR col < value). */
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

// Все порядки, в которых могут дойти до базы запросы двух ударов: старого (O) и нового (N).
const ORDERS = [
  "OONN",
  "ONON",
  "ONNO",
  "NOON",
  "NONO",
  "NNOO",
];

async function race(order: string): Promise<{ tables: Tables; outcomes: Record<string, WriteOutcome> }> {
  const tables = freshTables();
  const stepped = steppedStore(memoryStore(tables));
  const older = applyWrites(beatWrites(T1, 40, 600), stepped.wrap("O"));
  const newer = applyWrites(beatWrites(T2, 41, 720), stepped.wrap("N"));
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
  assertEquals(await applyWrites(beatWrites(T2, 41, 720), store), "ok");
  // Строка агента свежая, но старая сборка «откатила» бы её, если бы stale писал дальше.
  tables.service_agents[0].last_seen_at = "2026-09-28T09:00:00.000Z";
  assertEquals(await applyWrites(beatWrites(T1, 40, 600), store), "stale");
  assertEquals(tables.service_agents[0].last_version, 41);
});

Deno.test("удар по чужой встрече — missed, строка агента не освежена", async () => {
  const tables = freshTables();
  tables.meetings[0].claim_owner = 222; // право ушло рекордеру другого человека
  const outcome = await applyWrites(beatWrites(T1, 40, 600), memoryStore(tables));
  assertEquals(outcome, "missed");
  assertEquals(tables.service_agents[0].last_seen_at, null);
  assertEquals(tables.meetings[0].lease_expires_at, "2026-09-28T09:30:00.000Z");
  assertEquals(tables.meetings[0].recorded_seconds, 0);
});

Deno.test("удар без встречи освежает только строку агента", async () => {
  const tables = freshTables();
  const writes = buildHeartbeatWrites(bot, { recording: false, version: 41 }, T1);
  assertEquals(await applyWrites(writes, memoryStore(tables)), "ok");
  assertEquals(tables.service_agents[0].last_version, 41);
  assertEquals(tables.meetings[0].agent_last_seen_at, null);
});
