// Причина из «Спринтов» → комментарий в задаче, на настоящей базе: тот же `updateItem`, что зовут
// веб и MCP, и тот же `afterTaskComment`, что у обычного комментария (решение владельца
// 19.10.2026, п.6). Проверяем автора, текст, уведомление и — не меньше — что автоматика сама
// комментариев не пишет.
//
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) {
    throw new Error(
      `Не задана переменная ${name}. Подними локальный контур и прогоняй через ./scripts/with-local-db ` +
        `(или ./scripts/check). Пропустить этот тест нельзя: непроверенная проверка выглядит как проверенная.`,
    );
  }
}
// Тест не должен написать живому человеку: без токена отправка в бота падает внутри рассылки
// (она это ловит и логирует), а запись в колокольчик остаётся — её и проверяем.
Deno.env.delete("TELEGRAM_BOT_TOKEN");

const { updateItem } = await import("./sprint-items.ts");

const WS = "t_reason";
const ME = 777001;
const ASSIGNEE = 777002;

async function connect(): Promise<Client> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(
      `Нет связи с локальной базой (${DB_URL}). Подними контур: supabase start && supabase db reset. ` +
        `Исходная ошибка: ${e instanceof Error ? e.message : e}`,
    );
  }
  return db;
}

const CYCLE = "Спринт 4 · 20.10 — 02.11";

async function seed(db: Client) {
  await db.queryArray`delete from notifications where group_id = ${WS}`;
  await db.queryArray`delete from task_comments where task_id in (select id from tasks where group_id = ${WS})`;
  await db.queryArray`delete from sprint_items where cycle_id in (select id from sprint_cycles where group_id = ${WS})`;
  await db.queryArray`delete from sprint_cycles where group_id = ${WS}`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from sprints where group_id = ${WS}`;
  await db.queryArray`delete from allowed_users where telegram_id in (${ME}, ${ASSIGNEE})`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db.queryArray`insert into workspaces (id, name) values (${WS}, 'Тестовый')`;
  // Уведомление ссылается на участника воркспейса — настоящие строки в allowed_users.
  for (const person of [ME, ASSIGNEE]) {
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id)
      values (${person}, ${"u" + person}, 0, ${WS})`;
  }
  const tab = await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status, kind)
    values (gen_random_uuid(), ${WS}, 'Пространство', current_date, current_date + 30, 'active', 'space') returning id`;
  const project = await db.queryObject<{ id: string }>`
    insert into projects (group_id, name) values (${WS}, 'Инициатива') returning id`;
  const cycle = await db.queryObject<{ id: string }>`
    insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
    values (${WS}, ${
    tab.rows[0].id
  }, ${CYCLE}, current_date - 5, current_date + 8, current_date + 1, 'active') returning id`;
  const task = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, project_id, created_by, assignee_telegram_ids)
    values ('задача', 'open', ${WS}, ${project.rows[0].id}, 'test', ${[ASSIGNEE]}) returning id`;
  await db.queryArray`
    insert into sprint_items (cycle_id, task_id, in_plan, to_carry, carry_auto)
    values (${cycle.rows[0].id}, ${task.rows[0].id}, true, true, true)`;
  return { cycleId: cycle.rows[0].id, taskId: task.rows[0].id };
}

const comments = async (db: Client, taskId: string) =>
  (await db.queryObject<{ content: string; added_by_telegram_id: number }>`
    select content, added_by_telegram_id from task_comments where task_id = ${taskId} order by created_at, id`)
    .rows.map((r) => ({ content: r.content, added_by_telegram_id: Number(r.added_by_telegram_id) }));

Deno.test("причина переноса становится комментарием от имени автора, исполнитель получает уведомление", async () => {
  const db = await connect();
  try {
    const { cycleId, taskId } = await seed(db);
    await updateItem(cycleId, taskId, WS, { to_carry: true, carry_reason: "ждём поставщика" }, String(ME), ME);
    const got = await comments(db, taskId);
    assertEquals(got, [{ content: `Перенос (${CYCLE}): ждём поставщика`, added_by_telegram_id: ME }]);

    const notes = await db.queryObject<{ recipient_telegram_id: number; type: string; actor_telegram_id: number }>`
      select recipient_telegram_id, type, actor_telegram_id from notifications where task_id = ${taskId}`;
    assertEquals(notes.rows.map((n) => [Number(n.recipient_telegram_id), n.type, Number(n.actor_telegram_id)]), [
      [ASSIGNEE, "task_comment", ME],
    ]);
  } finally {
    await db.end();
  }
});

Deno.test("тот же текст второй раз и стирание комментариев не создают; новый текст — создаёт", async () => {
  const db = await connect();
  try {
    const { cycleId, taskId } = await seed(db);
    const set = (reason: string | null) =>
      updateItem(cycleId, taskId, WS, { to_carry: true, carry_reason: reason }, String(ME), ME);
    await set("первое");
    await set("первое");
    await set(null);
    assertEquals((await comments(db, taskId)).length, 1);
    await set("второе");
    assertEquals((await comments(db, taskId)).map((c) => c.content), [
      `Перенос (${CYCLE}): первое`,
      `Перенос (${CYCLE}): второе`,
    ]);
  } finally {
    await db.end();
  }
});

Deno.test("заметка сверки: метка со статусом, английская — для демо", async () => {
  const db = await connect();
  try {
    const { cycleId, taskId } = await seed(db);
    await updateItem(cycleId, taskId, WS, { check_status: "risk", check_note: "нет доступа" }, String(ME), ME);
    await updateItem(cycleId, taskId, WS, { check_note: "still blocked" }, String(ME), ME, "en");
    assertEquals((await comments(db, taskId)).map((c) => c.content), [
      `Сверка — риск (${CYCLE}): нет доступа`,
      `Check — at risk (${CYCLE}): still blocked`,
    ]);
  } finally {
    await db.end();
  }
});

Deno.test("ручное действие над отметкой переноса делает её человеческой: автоматика её не снимет", async () => {
  const db = await connect();
  try {
    const { cycleId, taskId } = await seed(db);
    await updateItem(cycleId, taskId, WS, { to_carry: true }, String(ME), ME);
    const row = await db.queryObject<{ carry_auto: boolean }>`
      select carry_auto from sprint_items where cycle_id = ${cycleId} and task_id = ${taskId}`;
    assertEquals(row.rows[0].carry_auto, false);
    // Срок внутри идущего спринта: отметку человека автоматика не трогает.
    await db.queryArray`update tasks set due_date = current_date + 2 where id = ${taskId}`;
    const after = await db.queryObject<{ to_carry: boolean }>`
      select to_carry from sprint_items where cycle_id = ${cycleId} and task_id = ${taskId}`;
    assertEquals(after.rows[0].to_carry, true);
  } finally {
    await db.end();
  }
});

Deno.test("автоматика комментариев и уведомлений не пишет: сдвиг срока за конец спринта", async () => {
  const db = await connect();
  try {
    const { cycleId, taskId } = await seed(db);
    await db.queryArray`update sprint_items set to_carry = false, carry_auto = false where cycle_id = ${cycleId}`;
    await db.queryArray`update tasks set due_date = current_date + 20 where id = ${taskId}`;
    const flag = await db.queryObject<{ to_carry: boolean; carry_auto: boolean; carry_reason: string | null }>`
      select to_carry, carry_auto, carry_reason from sprint_items where cycle_id = ${cycleId} and task_id = ${taskId}`;
    assertEquals(flag.rows[0], { to_carry: true, carry_auto: true, carry_reason: null });
    assertEquals((await comments(db, taskId)).length, 0);
    const notes = await db.queryObject<
      { n: number }
    >`select count(*)::int as n from notifications where task_id = ${taskId}`;
    assertEquals(notes.rows[0].n, 0);
  } finally {
    await db.end();
  }
});
