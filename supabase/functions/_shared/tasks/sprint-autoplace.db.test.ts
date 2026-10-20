// Размещение задачи по сроку и приёмка со сроком — на НАСТОЯЩЕЙ базе (контур, который выберет
// scripts/with-local-db). Правило живёт в триггере `tasks.due_date` и функции
// `sprint_autoplace_task`; чистое правило — `planPlacement` (sprint-autoplace.ts). Тест сверяет
// базу с ним на одном и том же описании сцены: если SQL и функция разойдутся, разойдутся и ответы.
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";
import { type PlacementCycle, planPlacement } from "./sprint-autoplace.ts";
import { addDays } from "./sprint-dates.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function connect(): Promise<Client> {
  const client = new Client(DB_URL);
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Нет связи с локальной базой (${DB_URL}). Подними контур: supabase start && supabase db reset. ` +
        `Исходная ошибка: ${e instanceof Error ? e.message : e}`,
    );
  }
  return client;
}

const WS = "t_autoplace";

type Label = "A" | "F1" | "F2";

interface Scene {
  /** Есть ли идущий спринт (иначе A остаётся принятым — как после приёмки, до старта следующего). */
  withActive?: boolean;
  /** В каких спринтах стоит задача. */
  rows: Label[];
  /** Состояние отметки переноса в идущем. */
  carry?: { to_carry: boolean; auto: boolean; reason: string | null };
  /** Срок ДО правки (дни от сегодня). */
  dueBefore?: number | null;
  /** Срок ПОСЛЕ правки (дни от сегодня) либо абсолютная дата. */
  dueAfter: number | string | null;
  status?: string;
}

async function reset(db: Client) {
  await db.queryArray`delete from sprint_items where cycle_id in (select id from sprint_cycles where group_id = ${WS})`;
  await db.queryArray`delete from sprint_cycles where group_id = ${WS}`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from sprints where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db.queryArray`insert into workspaces (id, name) values (${WS}, 'Тестовый')`;
}

const today = async (db: Client) => (await db.queryObject<{ d: string }>`select current_date::text as d`).rows[0].d;

interface Built {
  tabId: string;
  projectId: string;
  today: string;
  cycles: Record<Label, { id: string } & PlacementCycle>;
}

/** Спринты 4–6 встык: A — идёт (сегодня внутри), F1 и F2 — запланированные. */
async function build(db: Client, withActive: boolean): Promise<Built> {
  await reset(db);
  const t = await today(db);
  const tab = await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status, kind)
    values (gen_random_uuid(), ${WS}, 'Пространство', current_date, current_date + 30, 'active', 'space')
    returning id`;
  const project = await db.queryObject<{ id: string }>`
    insert into projects (group_id, name) values (${WS}, 'Инициатива') returning id`;
  const tabId = tab.rows[0].id;
  const layout: Array<[Label, number, string, string]> = [
    ["A", 4, addDays(t, -5), addDays(t, 8)],
    ["F1", 5, addDays(t, 9), addDays(t, 22)],
    ["F2", 6, addDays(t, 23), addDays(t, 36)],
  ];
  const cycles = {} as Built["cycles"];
  for (const [label, num, start, end] of layout) {
    const status = label === "A" ? (withActive ? "active" : "accepted") : "draft";
    const name = `Спринт ${num} · ${start.slice(8)}.${start.slice(5, 7)} — ${end.slice(8)}.${end.slice(5, 7)}`;
    const r = await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
      values (${WS}, ${tabId}, ${name}, ${start}, ${end}, ${addDays(start, 6)}, ${status})
      returning id`;
    cycles[label] = {
      id: r.rows[0].id,
      name,
      start_date: start,
      end_date: end,
      status: status as PlacementCycle["status"],
    };
  }
  return { tabId, projectId: project.rows[0].id, today: t, cycles };
}

const abs = (t: string, v: number | string | null) => v === null ? null : typeof v === "number" ? addDays(t, v) : v;

async function addTask(db: Client, b: Built, status: string, due: string | null) {
  const r = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, project_id, created_by, due_date)
    values ('задача', ${status}, ${WS}, ${b.projectId}, 'test', ${due}) returning id`;
  return r.rows[0].id;
}

async function placeRow(db: Client, cycleId: string, taskId: string, c?: Scene["carry"]) {
  await db.queryArray`
    insert into sprint_items (cycle_id, task_id, in_plan, to_carry, carry_auto, carry_reason)
    values (${cycleId}, ${taskId}, true, ${c?.to_carry ?? false}, ${c?.auto ?? false}, ${c?.reason ?? null})`;
}

interface State {
  membership: Set<string>; // метки «A», «F1», «F2», «N0», «N1»…
  items: Record<string, { in_plan: boolean; to_carry: boolean; carry_auto: boolean; carry_reason: string | null }>;
  created: Array<{ name: string; start_date: string; end_date: string; check_date: string; status: string }>;
}

async function readState(db: Client, b: Built, taskId: string): Promise<State> {
  const known = new Map(Object.entries(b.cycles).map(([l, c]) => [c.id, l]));
  const rows = await db.queryObject<{
    cycle_id: string;
    in_plan: boolean;
    to_carry: boolean;
    carry_auto: boolean;
    carry_reason: string | null;
  }>`select cycle_id, in_plan, to_carry, carry_auto, carry_reason from sprint_items
      where task_id = ${taskId} and withdrawn_at is null`;
  const cyc = await db.queryObject<
    { id: string; name: string; start_date: string; end_date: string; check_date: string; status: string }
  >`select id, name, start_date::text, end_date::text, check_date::text, status from sprint_cycles
     where tab_id = ${b.tabId} order by start_date`;
  const created = cyc.rows.filter((c) => !known.has(c.id));
  const labelOf = new Map(known);
  created.forEach((c, i) => labelOf.set(c.id, `N${i}`));
  const state: State = {
    membership: new Set(),
    items: {},
    created: created.map(({ id: _id, ...rest }) => rest),
  };
  for (const r of rows.rows) {
    const label = labelOf.get(r.cycle_id)!;
    state.membership.add(label);
    state.items[label] = {
      in_plan: r.in_plan,
      to_carry: r.to_carry,
      carry_auto: r.carry_auto,
      carry_reason: r.carry_reason,
    };
  }
  return state;
}

/** Ожидаемое состояние — из чистой функции на том же описании сцены. */
function expectedState(b: Built, s: Scene) {
  const cycles = Object.values(b.cycles);
  const inActive = s.rows.includes("A") && !!(s.withActive ?? true);
  // Закрытую задачу правило не ведёт (как и приёмка её не переносит): планировщику её не отдают.
  const closed = s.status === "done" || s.status === "cancelled";
  const plan = planPlacement({
    due: closed ? null : abs(b.today, s.dueAfter),
    today: b.today,
    cycles,
    inActive,
    draftIds: s.rows.filter((l) => l !== "A").map((l) => b.cycles[l].id),
    carry: inActive ? (s.carry ?? { to_carry: false, auto: false, reason: null }) : null,
  });
  const idToLabel = new Map(Object.entries(b.cycles).map(([l, c]) => [c.id, l]));
  const membership = new Set<string>(s.rows);
  if (plan.addToActive) membership.add("A");
  for (const id of plan.removeDraftIds) membership.delete(idToLabel.get(id)!);
  if (plan.targetId) membership.add(idToLabel.get(plan.targetId)!);
  if (plan.create.length > 0) membership.add(`N${plan.create.length - 1}`);
  return { plan, membership };
}

async function runScene(name: string, s: Scene, via: "update" | "rpc" = "update") {
  const db = await connect();
  try {
    const b = await build(db, s.withActive ?? true);
    const dueBefore = abs(b.today, s.dueBefore ?? null);
    const taskId = await addTask(db, b, s.status ?? "open", dueBefore);
    for (const label of s.rows) {
      const carry = label === "A" ? s.carry : undefined;
      await placeRow(db, b.cycles[label].id, taskId, carry);
    }
    const due = abs(b.today, s.dueAfter);
    if (via === "rpc") {
      await db.queryArray`select public.task_apply_update(${taskId}::uuid, ${
        JSON.stringify({ due_date: due })
      }::jsonb)`;
    } else {
      await db.queryArray`update tasks set due_date = ${due} where id = ${taskId}`;
    }

    const got = await readState(db, b, taskId);
    const { plan, membership } = expectedState(b, s);
    assertEquals([...got.membership].sort(), [...membership].sort(), `${name}: в каких спринтах стоит задача`);
    assertEquals(
      got.created.map((c) => [c.name, c.start_date, c.end_date, c.check_date, c.status]),
      plan.create.map((c) => [c.name, c.start_date, c.end_date, c.check_date, "draft"]),
      `${name}: созданные спринты`,
    );
    const a = got.items["A"];
    const before = s.carry ?? { to_carry: false, auto: false, reason: null };
    if (a && (s.withActive ?? true)) {
      const wantCarry = plan.clearCarry ? false : plan.setCarry ? true : before.to_carry;
      assertEquals(a.to_carry, wantCarry, `${name}: отметка переноса`);
      assertEquals(a.carry_auto, plan.setCarry ? true : plan.clearCarry ? false : before.auto, `${name}: кто поставил`);
      assertEquals(a.carry_reason, plan.clearCarry ? null : before.reason, `${name}: причину автоматика не пишет`);
    }
    if (plan.addToActive) assertEquals(got.items["A"].in_plan, false, `${name}: добавлено сверх плана`);
    if (plan.targetId) {
      const label = Object.entries(b.cycles).find(([, c]) => c.id === plan.targetId)![0];
      if (!s.rows.includes(label as Label)) {
        assertEquals(got.items[label].in_plan, true, `${name}: в план запланированного`);
      }
    }
    return { db: null, got, plan, b, taskId };
  } finally {
    await db.end();
  }
}

Deno.test("срок внутри идущего: задача из будущего спринта переезжает в идущий сверх плана", async () => {
  await runScene("внутрь идущего", { rows: ["F1"], dueAfter: 3 });
});

Deno.test("срок за концом идущего: остаётся в нём с пометкой переноса и появляется в спринте срока", async () => {
  const r = await runScene("за конец", { rows: ["A"], dueAfter: 25 });
  assert(r.got.membership.has("A") && r.got.membership.has("F2"));
  assertEquals(r.got.items["A"].to_carry, true);
  assertEquals(r.got.items["A"].carry_auto, true);
  assertEquals(r.got.items["A"].carry_reason, null, "причину автоматика не придумывает");
});

Deno.test("срок попал в ближайший будущий: идущий не теряет задачу, дубля в будущих нет", async () => {
  const r = await runScene("в F1", { rows: ["A", "F2"], dueAfter: 12 });
  assertEquals([...r.got.membership].sort(), ["A", "F1"]);
});

Deno.test("срок дальше всех: создаются все промежуточные спринты, задача в последнем", async () => {
  const r = await runScene("дальше всех", { rows: ["A"], dueAfter: 80 });
  assert(r.got.created.length >= 3, "промежуточные спринты без дыр");
  assertEquals(r.got.created.every((c) => c.status === "draft"), true, "стартуют только люди");
});

Deno.test("опечатка в сроке (через десять лет): спринтов нет, задача не переехала, пометка в идущем есть", async () => {
  const r = await runScene("2036", { rows: ["A"], dueAfter: 3650 });
  assertEquals(r.got.created.length, 0);
  assertEquals([...r.got.membership], ["A"]);
  assertEquals(r.got.items["A"].to_carry, true);
});

Deno.test("отметка переноса, поставленная человеком, при сдвиге срока за конец остаётся человеческой", async () => {
  const r = await runScene("человеческая отметка", {
    rows: ["A"],
    carry: { to_carry: true, auto: false, reason: "решили сами" },
    dueAfter: 25,
  });
  assertEquals(r.got.items["A"].carry_auto, false, "автоматика не присваивает чужую отметку");
  assertEquals(r.got.items["A"].carry_reason, "решили сами");
});

Deno.test("повторное сохранение того же срока не возвращает задачу, которую человек убрал из спринта", async () => {
  const db = await connect();
  try {
    const b = await build(db, true);
    const taskId = await addTask(db, b, "open", null);
    await placeRow(db, b.cycles.A.id, taskId);
    await db.queryArray`update tasks set due_date = ${addDays(b.today, 25)} where id = ${taskId}`;
    await db.queryArray`delete from sprint_items where cycle_id = ${b.cycles.F2.id} and task_id = ${taskId}`;
    // Тот же срок записан ещё раз (так делает любая правка карточки, шлющая срок целиком).
    await db.queryArray`update tasks set due_date = ${addDays(b.today, 25)} where id = ${taskId}`;
    const got = await readState(db, b, taskId);
    assertEquals([...got.membership], ["A"], "смена срока — повод двигать задачу, а не повторная запись того же");
  } finally {
    await db.end();
  }
});

Deno.test("срок вернули в идущий: отметка автоматики без причины снимается", async () => {
  await runScene("вернули", {
    rows: ["A", "F2"],
    carry: { to_carry: true, auto: true, reason: null },
    dueBefore: 25,
    dueAfter: 4,
  });
});

Deno.test("отметка человека и отметка с причиной при возврате срока остаются", async () => {
  await runScene("человек", { rows: ["A"], carry: { to_carry: true, auto: false, reason: null }, dueAfter: 4 });
  const r = await runScene("с причиной", {
    rows: ["A"],
    carry: { to_carry: true, auto: true, reason: "ждём поставщика" },
    dueAfter: 4,
  });
  assertEquals(r.got.items["A"].to_carry, true);
});

Deno.test("идущего спринта нет: срок переезжает между запланированными", async () => {
  await runScene("без идущего", { withActive: false, rows: ["F1"], dueAfter: 28 });
});

Deno.test("срок в зазоре или раньше всех спринтов: ничего не двигается", async () => {
  await runScene("раньше всех", { rows: ["F1"], dueAfter: -60 });
  await runScene("просрочено", { rows: ["A", "F1"], dueAfter: -6 });
});

Deno.test("срок сняли: ничего не происходит", async () => {
  await runScene("снят", { rows: ["A", "F1"], dueBefore: 12, dueAfter: null });
});

Deno.test("перекат через task_apply_update (веб, бот, MCP) ловится тем же триггером", async () => {
  const r = await runScene("rpc", { rows: ["A"], dueAfter: 25 }, "rpc");
  assertEquals(r.got.items["A"].to_carry, true);
});

Deno.test("задача, которой в спринтах не было, не раскладывается, спринты не создаются", async () => {
  const db = await connect();
  try {
    const b = await build(db, true);
    const taskId = await addTask(db, b, "open", null);
    await db.queryArray`update tasks set due_date = ${addDays(b.today, 80)} where id = ${taskId}`;
    const got = await readState(db, b, taskId);
    assertEquals(got.membership.size, 0);
    assertEquals(got.created.length, 0);
  } finally {
    await db.end();
  }
});

Deno.test("закрытая задача остаётся где была", async () => {
  const r = await runScene("закрытая", { rows: ["A"], status: "done", dueAfter: 80 });
  assertEquals([...r.got.membership], ["A"]);
  assertEquals(r.got.items["A"].to_carry, false);
});

Deno.test("снятая из идущего строка не оживает и не считается нахождением в спринте", async () => {
  const db = await connect();
  try {
    const b = await build(db, true);
    const taskId = await addTask(db, b, "open", null);
    await placeRow(db, b.cycles.A.id, taskId);
    await db.queryArray`update sprint_items set withdrawn_at = now() where task_id = ${taskId}`;
    await db.queryArray`update tasks set due_date = ${addDays(b.today, 25)} where id = ${taskId}`;
    const got = await readState(db, b, taskId);
    assertEquals(got.membership.size, 0, "задача не в обороте: ни пометки, ни переезда");
  } finally {
    await db.end();
  }
});

// ── Приёмка уносит задачу в спринт её срока ────────────────────────────────────────────────

const accept = (db: Client, cycleId: string) =>
  db.queryObject<{ result: Record<string, unknown> }>`
    select public.accept_sprint_cycle(
      ${cycleId}::uuid, ${WS}, 'tester', null, '{}'::jsonb,
      'Спринт 99 · 01.01 — 14.01', (current_date + 100)::date, (current_date + 113)::date, (current_date + 106)::date
    ) as result`;

Deno.test("приёмка: хвост со сроком в дальнем спринте едет туда, остальные — в ближайший", async () => {
  const db = await connect();
  try {
    const b = await build(db, true);
    const far = await addTask(db, b, "open", addDays(b.today, 25)); // срок в F2
    const noDue = await addTask(db, b, "open", null);
    const past = await addTask(db, b, "open", addDays(b.today, -10));
    const near = await addTask(db, b, "open", addDays(b.today, 12)); // срок в F1
    const beyond = await addTask(db, b, "open", addDays(b.today, 50)); // за F2: создать недостающие
    for (const t of [far, noDue, past, near, beyond]) await placeRow(db, b.cycles.A.id, t);
    // Дальнюю задачу автоматика уже положила в F2: дубля быть не должно.
    await placeRow(db, b.cycles.F2.id, far);

    await accept(db, b.cycles.A.id);

    const where = async (taskId: string) =>
      (await db.queryObject<{ name: string; n: number }>`
        select c.name, count(*) over (partition by si.task_id)::int as n
          from sprint_items si join sprint_cycles c on c.id = si.cycle_id
         where si.task_id = ${taskId} and c.status = 'draft' order by c.start_date`).rows;
    assertEquals((await where(far)).map((r) => r.name), [b.cycles.F2.name], "в F2 один раз");
    assertEquals((await where(noDue)).map((r) => r.name), [b.cycles.F1.name]);
    assertEquals((await where(past)).map((r) => r.name), [b.cycles.F1.name]);
    assertEquals((await where(near)).map((r) => r.name), [b.cycles.F1.name]);
    const bey = await where(beyond);
    assertEquals(bey.length, 1);
    assert(bey[0].name !== b.cycles.F1.name && bey[0].name !== b.cycles.F2.name, "создан спринт срока");
    const created = await db.queryObject<{ end_date: string }>`
      select end_date::text from sprint_cycles where tab_id = ${b.tabId} and status = 'draft'
       and id not in (${b.cycles.F1.id}, ${b.cycles.F2.id}) order by start_date`;
    assert(created.rows.length >= 1);
    assert(created.rows[created.rows.length - 1].end_date >= addDays(b.today, 50), "покрыт срок задачи");
  } finally {
    await db.end();
  }
});
