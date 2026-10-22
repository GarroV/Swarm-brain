// Перенос задачи между спринтами — на НАСТОЯЩЕЙ базе (контур, который выберет
// scripts/with-local-db). Правило живёт в функции базы `sprint_move_task` (одна точка для API, MCP
// и триггера срока — docs/superpowers/specs/2026-10-22-sprint-board-design.md): задача сразу
// оказывается в спринте-цели, в идущем остаётся снимок с причиной, срок меняется только явной
// новой датой.
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";
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

const WS = "t_sprint_move";
const OTHER_WS = "t_sprint_move_x";
const ME = "777101";

async function reset(db: Client) {
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from task_history where group_id = ${ws}`;
    await db.queryArray`delete from notifications where group_id = ${ws}`;
    await db.queryArray`delete from task_comments where task_id in (select id from tasks where group_id = ${ws})`;
    await db
      .queryArray`delete from sprint_items where cycle_id in (select id from sprint_cycles where group_id = ${ws})`;
    await db.queryArray`delete from sprint_cycles where group_id = ${ws}`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`delete from projects where group_id = ${ws}`;
    await db.queryArray`delete from sprints where group_id = ${ws}`;
    await db.queryArray`delete from allowed_users where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db.queryArray`insert into workspaces (id, name) values (${ws}, 'Тестовый')`;
  }
}

interface Scene {
  today: string;
  tabId: string;
  projectId: string;
  /** A — идущий (сегодня внутри), F1/F2 — запланированные, P — принятый прошлый. */
  A: string;
  F1: string;
  F2: string;
  P: string;
  /** Запланированный спринт другого пространства того же воркспейса. */
  otherTab: string;
}

async function space(db: Client, ws: string, name: string): Promise<string> {
  const r = await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status, kind)
    values (gen_random_uuid(), ${ws}, ${name}, current_date, current_date + 30, 'active', 'space')
    returning id`;
  return r.rows[0].id;
}

async function cycle(
  db: Client,
  ws: string,
  tabId: string,
  name: string,
  start: string,
  end: string,
  status: string,
): Promise<string> {
  const r = await db.queryObject<{ id: string }>`
    insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
    values (${ws}, ${tabId}, ${name}, ${start}, ${end}, ${addDays(start, 6)}, ${status})
    returning id`;
  return r.rows[0].id;
}

async function build(db: Client): Promise<Scene> {
  await reset(db);
  const t = (await db.queryObject<{ d: string }>`select current_date::text as d`).rows[0].d;
  const tabId = await space(db, WS, "Пространство");
  const project = await db.queryObject<{ id: string }>`
    insert into projects (group_id, name) values (${WS}, 'Инициатива') returning id`;
  const P = await cycle(db, WS, tabId, "Спринт 3", addDays(t, -19), addDays(t, -6), "accepted");
  const A = await cycle(db, WS, tabId, "Спринт 4", addDays(t, -5), addDays(t, 8), "active");
  const F1 = await cycle(db, WS, tabId, "Спринт 5", addDays(t, 9), addDays(t, 22), "draft");
  const F2 = await cycle(db, WS, tabId, "Спринт 6", addDays(t, 23), addDays(t, 36), "draft");
  const tab2 = await space(db, WS, "Другое пространство");
  const otherTab = await cycle(db, WS, tab2, "Чужой 5", addDays(t, 9), addDays(t, 22), "draft");
  return { today: t, tabId, projectId: project.rows[0].id, A, F1, F2, P, otherTab };
}

async function addTask(
  db: Client,
  s: Scene,
  opts: { status?: string; due?: string | null; isPrivate?: boolean; archived?: boolean } = {},
): Promise<string> {
  const r = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, project_id, created_by, due_date, is_private, archived_at)
    values ('задача про юристов', ${opts.status ?? "open"}, ${WS}, ${s.projectId}, 'test',
            ${opts.due ?? null}, ${opts.isPrivate ?? false}, ${opts.archived ? new Date().toISOString() : null})
    returning id`;
  return r.rows[0].id;
}

async function place(db: Client, cycleId: string, taskId: string, carryCount = 0): Promise<string> {
  const r = await db.queryObject<{ id: string }>`
    insert into sprint_items (cycle_id, task_id, in_plan, carry_count)
    values (${cycleId}, ${taskId}, true, ${carryCount}) returning id`;
  return r.rows[0].id;
}

function move(
  db: Client,
  itemId: string,
  targetCycleId: string,
  reason: string | null,
  newDue: string | null = null,
) {
  return db.queryObject<{ r: { source_item_id: string; target_item_id: string; revived: boolean } }>`
    select public.sprint_move_task(${itemId}::uuid, ${targetCycleId}::uuid, ${reason}, ${newDue}::date, ${ME}) as r`;
}

interface Row {
  id: string;
  cycle_id: string;
  in_plan: boolean;
  carried_from: string | null;
  carry_count: number;
  carry_reason: string | null;
  moved_at: string | null;
  moved_to: string | null;
  moved_by: string | null;
  frozen_title: string | null;
  frozen_due_date: string | null;
  frozen_at: string | null;
}

async function rows(db: Client, taskId: string): Promise<Row[]> {
  return (await db.queryObject<Row>`
    select id, cycle_id, in_plan, carried_from, carry_count, carry_reason, moved_at::text, moved_to, moved_by,
           frozen_title, frozen_due_date::text, frozen_at::text
      from sprint_items where task_id = ${taskId}`).rows;
}

async function withScene(fn: (db: Client, s: Scene) => Promise<void>) {
  const db = await connect();
  try {
    await fn(db, await build(db));
  } finally {
    await db.end();
  }
}

Deno.test("перенос: задача в цели, в источнике снимок с причиной", async () => {
  await withScene(async (db, s) => {
    const due = addDays(s.today, 4);
    const taskId = await addTask(db, s, { due });
    const src = await place(db, s.A, taskId, 1);

    const r = (await move(db, src, s.F1, "  ждём юристов  ")).rows[0].r;

    const all = await rows(db, taskId);
    assertEquals(all.length, 2, "ровно две строки: снимок и цель");
    const target = all.find((x) => x.cycle_id === s.F1)!;
    const source = all.find((x) => x.cycle_id === s.A)!;
    assertEquals(r.source_item_id, src);
    assertEquals(r.target_item_id, target.id);
    assertEquals(r.revived, false);
    assertEquals(target.carried_from, src, "цель помнит, откуда пришла");
    assertEquals(target.carry_count, 2, "счётчик переносов растёт");
    assertEquals(target.in_plan, true);
    assertEquals(target.moved_at, null);
    assert(source.moved_at !== null, "источник стал снимком");
    assertEquals(source.moved_to, target.id);
    assertEquals(source.moved_by, ME);
    assertEquals(source.carry_reason, "ждём юристов", "причина записана без пробелов по краям");
    assertEquals(source.frozen_title, "задача про юристов", "снимок держит состояние на момент ухода");
    assertEquals(source.frozen_due_date, due);
    assert(source.frozen_at !== null);
  });
});

Deno.test("пустая причина — отказ, ничего не меняется", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s);
    const src = await place(db, s.A, taskId);
    for (const reason of ["  ", "", null]) {
      await assertRejects(() => move(db, src, s.F1, reason), Error, "Нужна причина переноса");
    }
    const all = await rows(db, taskId);
    assertEquals(all.length, 1);
    assertEquals(all[0].moved_at, null);
  });
});

Deno.test("выполненную и отменённую не переносим", async () => {
  await withScene(async (db, s) => {
    for (const status of ["done", "cancelled"]) {
      const taskId = await addTask(db, s, { status });
      const src = await place(db, s.A, taskId);
      await assertRejects(
        () => move(db, src, s.F1, "причина"),
        Error,
        "Выполненную или отменённую задачу не переносим",
      );
      assertEquals((await rows(db, taskId)).length, 1);
    }
  });
});

Deno.test("приватную и архивную не переносим", async () => {
  await withScene(async (db, s) => {
    const priv = await addTask(db, s, { isPrivate: true });
    const srcPriv = await place(db, s.A, priv);
    await assertRejects(() => move(db, srcPriv, s.F1, "причина"), Error, "Приватную задачу не переносим");
    const arch = await addTask(db, s, { archived: true });
    const srcArch = await place(db, s.A, arch);
    await assertRejects(() => move(db, srcArch, s.F1, "причина"), Error, "Задача в архиве");
    assertEquals((await rows(db, priv)).length, 1);
    assertEquals((await rows(db, arch)).length, 1);
  });
});

Deno.test("цель из другого пространства или воркспейса — отказ", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s);
    const src = await place(db, s.A, taskId);
    await assertRejects(() => move(db, src, s.otherTab, "причина"), Error, "Спринт-цель не найден в этом пространстве");
    const foreignTab = await space(db, OTHER_WS, "Чужой воркспейс");
    const foreign = await cycle(db, OTHER_WS, foreignTab, "Чужой", addDays(s.today, 9), addDays(s.today, 22), "draft");
    await assertRejects(() => move(db, src, foreign, "причина"), Error, "Спринт-цель не найден в этом пространстве");
    assertEquals((await rows(db, taskId)).length, 1);
  });
});

Deno.test("цель не запланированный спринт (идущий, принятый, архивный) — отказ", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s);
    const src = await place(db, s.A, taskId);
    await assertRejects(() => move(db, src, s.A, "причина"), Error, "Перенести можно только в запланированный спринт");
    await assertRejects(() => move(db, src, s.P, "причина"), Error, "Перенести можно только в запланированный спринт");
    await db.queryArray`update sprint_cycles set archived_at = now() where id = ${s.F2}`;
    await assertRejects(() => move(db, src, s.F2, "причина"), Error, "Спринт-цель не найден в этом пространстве");
  });
});

Deno.test("источник не в идущем спринте — отказ", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s);
    const src = await place(db, s.F1, taskId);
    await assertRejects(() => move(db, src, s.F2, "причина"), Error, "Перенести можно только из идущего спринта");
    const withdrawn = await addTask(db, s);
    const srcW = await place(db, s.A, withdrawn);
    await db.queryArray`update sprint_items set withdrawn_at = now() where id = ${srcW}`;
    await assertRejects(() => move(db, srcW, s.F1, "причина"), Error, "Задача снята из спринта");
  });
});

Deno.test("срок не трогается без новой даты", async () => {
  await withScene(async (db, s) => {
    const due = addDays(s.today, 4);
    const taskId = await addTask(db, s, { due });
    const src = await place(db, s.A, taskId);
    await move(db, src, s.F2, "причина");
    const after = await db.queryObject<
      { d: string | null }
    >`select due_date::text as d from tasks where id = ${taskId}`;
    assertEquals(after.rows[0].d, due);
  });
});

Deno.test("новая дата меняет срок, пишет журнал и не плодит строк (триггер срока молчит)", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s, { due: addDays(s.today, 4) });
    const src = await place(db, s.A, taskId);
    const newDue = addDays(s.today, 22); // последний день F1
    await move(db, src, s.F1, "ждём юристов", newDue);
    const after = await db.queryObject<{ d: string }>`select due_date::text as d from tasks where id = ${taskId}`;
    assertEquals(after.rows[0].d, newDue);
    const all = await rows(db, taskId);
    assertEquals(all.length, 2, "ровно две строки задачи: снимок и цель");
    const hist = await db.queryObject<{ field: string; old_value: string; new_value: string }>`
      select field, old_value, new_value from task_history where task_id = ${taskId}`;
    assertEquals(hist.rows.map((h) => [h.field, h.new_value]), [["due_date", newDue]]);
  });
});

Deno.test("повторный перенос той же строки — отказ «Задача уже перенесена»", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s);
    const src = await place(db, s.A, taskId);
    await move(db, src, s.F1, "причина");
    await assertRejects(() => move(db, src, s.F2, "другая причина"), Error, "Задача уже перенесена");
    assertEquals((await rows(db, taskId)).length, 2, "в F2 строка не появилась");
  });
});

Deno.test("двое переносят одну строку одновременно: второй получает отказ, а не вторую строку", async () => {
  const db = await connect();
  const second = await connect();
  try {
    const s = await build(db);
    const taskId = await addTask(db, s);
    const src = await place(db, s.A, taskId);

    await db.queryArray`begin`;
    await move(db, src, s.F1, "первый");
    // Второй стоит на блокировке строки, пока первый не закончит транзакцию.
    const racing = move(second, src, s.F2, "второй").then(() => "прошёл", (e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 300));
    await db.queryArray`commit`;
    const outcome = await racing;
    assert(outcome.includes("Задача уже перенесена"), `второй получил: ${outcome}`);
    const all = await rows(db, taskId);
    assertEquals(all.map((x) => x.cycle_id).sort(), [s.A, s.F1].sort(), "в F2 ничего не легло");
  } finally {
    await second.end();
    await db.end();
  }
});

Deno.test("удалили спринт-цель — снимок остаётся, ссылка обнулена, ничего не падает", async () => {
  await withScene(async (db, s) => {
    const taskId = await addTask(db, s);
    const src = await place(db, s.A, taskId);
    await move(db, src, s.F1, "причина");
    await db.queryArray`delete from sprint_cycles where id = ${s.F1}`;
    const all = await rows(db, taskId);
    assertEquals(all.length, 1);
    assert(all[0].moved_at !== null, "снимок остался снимком");
    assertEquals(all[0].moved_to, null);
    assertEquals(all[0].carry_reason, "причина");
  });
});

Deno.test("функции переноса вызывает только service_role", async () => {
  const db = await connect();
  try {
    for (const fn of ["sprint_move_task", "sprint_move_task_internal"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const r = await db.queryObject<{ ok: boolean }>`
          select has_function_privilege(${role}, ${`public.${fn}(uuid, uuid, text, date, text)`}, 'execute') as ok`;
        assertEquals(r.rows[0].ok, role === "service_role", `${fn} для ${role}`);
      }
    }
  } finally {
    await db.end();
  }
});

// ── Серверный слой: moveItem / setMovedReason / состав / старый PATCH {to_carry} ─────────────
// Модуль держит клиент базы на переменных окружения, поэтому грузится внутри теста: без них тест
// падает с понятной причиной, а не пропускается.

const VIEWER = 777101;

async function serverLayer() {
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!Deno.env.get(name)) {
      throw new Error(
        `Не задана переменная ${name}. Прогоняй через ./scripts/with-local-db (или ./scripts/check): ` +
          `пропустить этот тест нельзя — непроверенная проверка выглядит как проверенная.`,
      );
    }
  }
  // Тест не должен написать живому человеку: без токена отправка в бота падает внутри рассылки.
  Deno.env.delete("TELEGRAM_BOT_TOKEN");
  return {
    ...(await import("./sprint-move.ts")),
    ...(await import("./sprint-items.ts")),
  };
}

async function member(db: Client) {
  await db.queryArray`delete from allowed_users where telegram_id = ${VIEWER}`;
  await db.queryArray`
    insert into allowed_users (telegram_id, username, added_by, group_id) values (${VIEWER}, 'mover', 0, ${WS})`;
}

const commentsOf = async (db: Client, taskId: string) =>
  (await db.queryObject<{ content: string }>`
    select content from task_comments where task_id = ${taskId} order by created_at, id`).rows.map((r) => r.content);

Deno.test("перенос через moveItem пишет один комментарий-причину и отдаёт строку цели", async () => {
  const { moveItem } = await serverLayer();
  await withScene(async (db, s) => {
    await member(db);
    const taskId = await addTask(db, s);
    const src = await place(db, s.A, taskId);
    const r = await moveItem({
      groupId: WS,
      viewer: VIEWER,
      cycleId: s.A,
      itemId: src,
      targetCycleId: s.F1,
      reason: "ждём юристов",
      newDue: null,
    });
    const target = (await rows(db, taskId)).find((x) => x.cycle_id === s.F1)!;
    assertEquals(r, { targetItemId: target.id, revived: false });
    assertEquals(await commentsOf(db, taskId), ["Перенос (Спринт 4): ждём юристов"]);
    await assertRejects(
      () =>
        moveItem({
          groupId: WS,
          viewer: VIEWER,
          cycleId: s.A,
          itemId: src,
          targetCycleId: s.F2,
          reason: "ещё раз",
          newDue: null,
        }),
      Error,
      "Задача уже перенесена",
    );
    assertEquals((await commentsOf(db, taskId)).length, 1, "отказ комментария не пишет");
  });
});

Deno.test("moveItem: чужой воркспейс и строка не этого спринта — «не найдено», а не перенос", async () => {
  const { moveItem } = await serverLayer();
  await withScene(async (db, s) => {
    await member(db);
    const taskId = await addTask(db, s);
    const src = await place(db, s.A, taskId);
    const base = { viewer: VIEWER, itemId: src, targetCycleId: s.F1, reason: "причина", newDue: null };
    assertEquals(await moveItem({ ...base, groupId: OTHER_WS, cycleId: s.A }), null);
    assertEquals(await moveItem({ ...base, groupId: WS, cycleId: s.F2 }), null);
    assertEquals((await rows(db, taskId)).length, 1);
  });
});

Deno.test("состав: снимок отдельно от живых, с целью, причиной и сроком «было → стало»", async () => {
  const { moveItem, listComposition } = await serverLayer();
  await withScene(async (db, s) => {
    await member(db);
    const due = addDays(s.today, 4);
    const taskId = await addTask(db, s, { due });
    const src = await place(db, s.A, taskId);
    const newDue = addDays(s.today, 22);
    await moveItem({
      groupId: WS,
      viewer: VIEWER,
      cycleId: s.A,
      itemId: src,
      targetCycleId: s.F1,
      reason: "ждём юристов",
      newDue,
    });
    const comp = await listComposition(s.A, WS, { viewerId: VIEWER });
    assertEquals(comp.items.length, 0, "ушедшая задача не в составе");
    assertEquals(comp.moved.length, 1);
    const m = comp.moved[0];
    assertEquals(m.due_date, due, "срок на момент ухода");
    assertEquals(m.project, "Инициатива", "имя инициативы — от живой задачи");
    assertEquals(m.moved?.to_cycle_id, s.F1);
    assertEquals(m.moved?.to_cycle_name, "Спринт 5");
    assertEquals(m.moved?.reason, "ждём юристов");
    assertEquals(m.moved?.by, VIEWER);
    assertEquals(m.moved?.due_now, newDue);
    const target = await listComposition(s.F1, WS, { viewerId: VIEWER });
    assertEquals(target.items.map((i) => i.task_id), [taskId]);

    // Цель убрали в архив (так «удаляют» спринт) — снимок честно говорит «спринт удалён».
    await db.queryArray`update sprint_cycles set archived_at = now() where id = ${s.F1}`;
    const after = (await listComposition(s.A, WS, { viewerId: VIEWER })).moved[0];
    assertEquals([after.moved?.to_cycle_id, after.moved?.to_cycle_name], [null, null]);
  });
});

Deno.test("вписать причину в снимок без причины: один раз, с комментарием; повторно — отказ", async () => {
  const { setMovedReason, listComposition } = await serverLayer();
  await withScene(async (db, s) => {
    await member(db);
    const taskId = await addTask(db, s, { due: addDays(s.today, 4) });
    await place(db, s.A, taskId);
    await db.queryArray`update tasks set due_date = ${addDays(s.today, 25)} where id = ${taskId}`;
    const snap = (await listComposition(s.A, WS, { viewerId: VIEWER })).moved[0];
    assertEquals(snap.moved?.reason, null, "перенос по сроку — без причины");
    assertEquals(snap.moved?.by, null);

    assertEquals(
      await setMovedReason({ groupId: WS, viewer: VIEWER, cycleId: s.A, itemId: snap.id, reason: "сдвинули запуск" }),
      true,
    );
    assertEquals(await commentsOf(db, taskId), ["Перенос (Спринт 4): сдвинули запуск"]);
    assertEquals(
      await setMovedReason({ groupId: WS, viewer: VIEWER, cycleId: s.A, itemId: snap.id, reason: "другая" }),
      false,
      "уже записанную причину не переписываем",
    );
    assertEquals((await commentsOf(db, taskId)).length, 1);
    const live = (await rows(db, taskId)).find((x) => x.cycle_id === s.F2)!;
    assertEquals(
      await setMovedReason({ groupId: WS, viewer: VIEWER, cycleId: s.F2, itemId: live.id, reason: "x" }),
      false,
      "живой строке причина ухода не пишется",
    );
  });
});

Deno.test("старый PATCH {to_carry:true} по-прежнему проходит (открытые вкладки, MCP)", async () => {
  const { updateItem, listComposition } = await serverLayer();
  await withScene(async (db, s) => {
    await member(db);
    const taskId = await addTask(db, s);
    await place(db, s.A, taskId);
    const item = await updateItem(
      s.A,
      taskId,
      WS,
      { to_carry: true, carry_reason: "по-старому" },
      String(VIEWER),
      VIEWER,
    );
    assertEquals(item?.to_carry, true);
    assertEquals(item?.carry_reason, "по-старому");
    const comp = await listComposition(s.A, WS, { viewerId: VIEWER });
    assertEquals(comp.items.length, 1, "строка помечена старым способом, а не перенесена");
    assertEquals(comp.moved.length, 0);
  });
});

Deno.test("снимок не правится старым PATCH и не снимается из спринта", async () => {
  const { moveItem, updateItem, removeItem } = await serverLayer();
  await withScene(async (db, s) => {
    await member(db);
    const taskId = await addTask(db, s);
    const src = await place(db, s.A, taskId);
    await moveItem({
      groupId: WS,
      viewer: VIEWER,
      cycleId: s.A,
      itemId: src,
      targetCycleId: s.F1,
      reason: "r",
      newDue: null,
    });
    assertEquals(await updateItem(s.A, taskId, WS, { check_status: "risk" }, String(VIEWER), VIEWER), null);
    assertEquals(await removeItem(s.A, taskId, WS, String(VIEWER), VIEWER), false);
    const snap = (await rows(db, taskId)).find((x) => x.cycle_id === s.A)!;
    assert(snap.moved_at !== null);
  });
});

Deno.test("роуты переноса: 200 с целью, пустая причина — 400, повтор — 409 с текстом, GET отдаёт moved", async () => {
  await serverLayer();
  const { handleSprintCycleRoutes } = await import("../../swarm-api/sprint-cycles.ts");
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleSprintCycleRoutes(
      new Request(`http://local/swarm-api${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      path,
      VIEWER,
      WS,
      false,
      "http://local",
    );
    if (!res) throw new Error(`роут не узнал ${method} ${path}`);
    return { status: res.status, body: await res.json().catch(() => null) as Record<string, unknown> | null };
  };
  await withScene(async (db, s) => {
    await member(db);
    const taskId = await addTask(db, s, { due: addDays(s.today, 4) });
    const src = await place(db, s.A, taskId);
    const path = `/sprint-cycles/${s.A}/tasks/${src}/move`;

    assertEquals((await call("POST", path, { target_cycle_id: s.F1, reason: "  " })).status, 400);
    assertEquals((await call("POST", path, { target_cycle_id: s.F1, reason: "r", new_due: "завтра" })).status, 400);
    const ok = await call("POST", path, { target_cycle_id: s.F1, reason: "ждём юристов" });
    assertEquals(ok.status, 200);
    assertEquals(ok.body?.ok, true);
    assert(typeof ok.body?.target_item_id === "string");
    const again = await call("POST", path, { target_cycle_id: s.F2, reason: "ещё" });
    assertEquals([again.status, again.body?.error], [409, "Задача уже перенесена"]);

    const cycle = await call("GET", `/sprint-cycles/${s.A}`);
    assertEquals((cycle.body?.items as unknown[]).length, 0);
    assertEquals((cycle.body?.moved as Array<{ task_id: string }>).map((m) => m.task_id), [taskId]);

    const reason = await call("POST", `/sprint-cycles/${s.A}/tasks/${src}/moved-reason`, { reason: "другая" });
    assertEquals(reason.status, 409, "причина уже записана — второй раз не спрашиваем и не переписываем");
    const missing = await call("POST", `/sprint-cycles/${s.A}/tasks/00000000-0000-0000-0000-000000000000/move`, {
      target_cycle_id: s.F1,
      reason: "r",
    });
    assertEquals(missing.status, 404);
  });
});
