// Сброс демо-воркспейса `public.demo_reset()` на НАСТОЯЩЕЙ базе (issue #580).
//
// Почему не мок: всё, ради чего функция написана, живёт в базе — порядок удалений под внешними
// ключами, уникальный индекс живого спринта, триггер удаления задачи, права на вызов. Мок
// проверил бы мою же модель базы, а не базу.
//
// Главное, что здесь доказывается, — не «эталон засевается», а «ничего, кроме демо, не тронуто»:
// сброс идёт в проде раз в полчаса, и промах условия стирал бы рабочие данные молча и регулярно.
//
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MIGRATION = new URL(
  "../../migrations/20260928180000_demo_auto_reset.sql",
  import.meta.url,
);

const DEMO = "demo";
const DEMO_USERS = [
  900000001,
  900000002,
  900000003,
  900000004,
  900000005,
  900000006,
  900000007,
];
const EXTRA_DEMO_USER = 900000099;
const OTHER = "t_demo_reset_other";
const OTHER_USER = 800000901;
const LIVE_CYCLE = "d0000000-0000-4000-8000-000000000302";
const SPACE = "d0000000-0000-4000-8000-000000000002";
const OPERATIONS = "d0000000-0000-4000-8000-000000000101";

async function connect(): Promise<Client> {
  const client = new Client(DB_URL);
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Нет связи с тестовой базой (${DB_URL}). Запускай через ./scripts/with-local-db. ` +
        `Исходная ошибка: ${e instanceof Error ? e.message : e}`,
    );
  }
  return client;
}

async function withDb(fn: (db: Client) => Promise<void>) {
  const db = await connect();
  try {
    await fn(db);
  } finally {
    await db.end();
  }
}

/** Где в каждой таблице живёт демо: условие отбора для снимка. */
const DEMO_SCOPE: Record<string, string> = {
  workspaces: `id = '${DEMO}'`,
  allowed_users:
    `group_id = '${DEMO}' or telegram_id between 900000001 and 900000099`,
  user_profiles: `telegram_id between 900000001 and 900000099`,
  tasks: `group_id = '${DEMO}'`,
  task_comments:
    `task_id in (select id from public.tasks where group_id = '${DEMO}')`,
  task_history:
    `group_id = '${DEMO}' or task_id in (select id from public.tasks where group_id = '${DEMO}')`,
  task_subscriptions: `telegram_id between 900000001 and 900000099`,
  task_labels: `group_id = '${DEMO}'`,
  notifications:
    `group_id = '${DEMO}' or recipient_telegram_id between 900000001 and 900000099`,
  projects: `group_id = '${DEMO}'`,
  project_history: `group_id = '${DEMO}'`,
  sprints: `group_id = '${DEMO}'`,
  sprint_cycles: `group_id = '${DEMO}'`,
  sprint_items:
    `cycle_id in (select id from public.sprint_cycles where group_id = '${DEMO}')`,
  entries: `group_id = '${DEMO}'`,
  meetings: `group_id = '${DEMO}'`,
  meeting_live_notes: `group_id = '${DEMO}'`,
  feedback: `telegram_id between 900000001 and 900000099`,
  user_integrations: `telegram_id between 900000001 and 900000099`,
  recorder_diagnostics: `telegram_id between 900000001 and 900000099`,
  sessions: `chat_id between 900000001 and 900000099`,
};

/** Где живёт тестовый НЕ-демо воркспейс — те же таблицы. */
const OTHER_SCOPE: Record<string, string> = {
  workspaces: `id = '${OTHER}'`,
  allowed_users: `telegram_id = ${OTHER_USER}`,
  user_profiles: `telegram_id = ${OTHER_USER}`,
  tasks: `group_id = '${OTHER}'`,
  task_comments:
    `task_id in (select id from public.tasks where group_id = '${OTHER}')`,
  task_history: `group_id = '${OTHER}'`,
  task_subscriptions: `telegram_id = ${OTHER_USER}`,
  task_labels: `group_id = '${OTHER}'`,
  notifications: `group_id = '${OTHER}'`,
  projects: `group_id = '${OTHER}'`,
  project_history: `group_id = '${OTHER}'`,
  sprints: `group_id = '${OTHER}'`,
  sprint_cycles: `group_id = '${OTHER}'`,
  sprint_items:
    `cycle_id in (select id from public.sprint_cycles where group_id = '${OTHER}')`,
  entries: `group_id = '${OTHER}'`,
  meetings: `group_id = '${OTHER}'`,
  meeting_live_notes: `group_id = '${OTHER}'`,
  feedback: `telegram_id = ${OTHER_USER}`,
  user_integrations: `telegram_id = ${OTHER_USER}`,
  recorder_diagnostics: `telegram_id = ${OTHER_USER}`,
  sessions: `chat_id = ${OTHER_USER}`,
};

// Колонки, которые у эталона законно разные от сброса к сбросу: случайные id и отметки «сейчас».
const VOLATILE = ["id", "created_at", "updated_at", "started_at", "added_at"];

/** Снимок: по каждой таблице — отсортированный список строк в JSON. */
async function snapshot(
  db: Client,
  scope: Record<string, string>,
  strip: string[],
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const [table, where] of Object.entries(scope)) {
    const minus = strip.map((k) => ` - '${k}'`).join("");
    const r = await db.queryObject<{ row: string }>(
      `select (to_jsonb(t)${minus})::text as row from public.${table} t where ${where} order by 1`,
    );
    out[table] = r.rows.map((x) => x.row);
  }
  return out;
}

async function reset(db: Client): Promise<Record<string, number>> {
  const r = await db.queryObject<{ c: Record<string, number> }>(
    "select public.demo_reset() as c",
  );
  return r.rows[0].c;
}

async function cleanOther(db: Client) {
  await db.queryArray`delete from sprint_cycles where group_id = ${OTHER}`;
  await db.queryArray`delete from notifications where group_id = ${OTHER}`;
  await db
    .queryArray`delete from task_subscriptions where telegram_id = ${OTHER_USER}`;
  await db.queryArray`delete from task_history where group_id = ${OTHER}`;
  await db.queryArray`delete from tasks where group_id = ${OTHER}`;
  await db.queryArray`delete from task_labels where group_id = ${OTHER}`;
  await db.queryArray`delete from project_history where group_id = ${OTHER}`;
  await db.queryArray`delete from projects where group_id = ${OTHER}`;
  await db.queryArray`delete from sprints where group_id = ${OTHER}`;
  await db.queryArray`delete from meeting_live_notes where group_id = ${OTHER}`;
  await db.queryArray`delete from meetings where group_id = ${OTHER}`;
  await db.queryArray`delete from entries where group_id = ${OTHER}`;
  await db.queryArray`delete from feedback where telegram_id = ${OTHER_USER}`;
  await db
    .queryArray`delete from user_integrations where telegram_id = ${OTHER_USER}`;
  await db
    .queryArray`delete from recorder_diagnostics where telegram_id = ${OTHER_USER}`;
  await db.queryArray`delete from sessions where chat_id = ${OTHER_USER}`;
  await db
    .queryArray`delete from user_profiles where telegram_id = ${OTHER_USER}`;
  await db
    .queryArray`delete from allowed_users where telegram_id = ${OTHER_USER}`;
  await db.queryArray`delete from workspaces where id = ${OTHER}`;
}

/** Не-демо воркспейс с данными во всех таблицах, куда заходит сброс. */
async function seedOther(db: Client) {
  await cleanOther(db);
  await db
    .queryArray`insert into workspaces (id, name) values (${OTHER}, 'Рабочий')`;
  await db.queryArray`
    insert into allowed_users (telegram_id, username, group_id, is_admin, added_by, claude_mcp_token_hash)
    values (${OTHER_USER}, 'worker', ${OTHER}, false, 0, 'живой-токен')`;
  await db.queryArray`
    insert into user_profiles (telegram_id, first_name, last_name) values (${OTHER_USER}, 'Рабочий', 'Человек')`;
  const tab = await db.queryObject<{ id: string }>`
    insert into sprints (group_id, name, start_date, end_date, status, kind)
    values (${OTHER}, 'Вкладка', current_date, current_date + 30, 'active', 'space') returning id`;
  const project = await db.queryObject<{ id: string }>`
    insert into projects (group_id, name, goal, sprint_id)
    values (${OTHER}, 'Рабочий проект', 'настоящая цель', ${
    tab.rows[0].id
  }) returning id`;
  const task = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, project_id, created_by)
    values ('Рабочая задача', 'open', ${OTHER}, ${
    project.rows[0].id
  }, 'test') returning id`;
  const taskId = task.rows[0].id;
  const cycle = await db.queryObject<{ id: string }>`
    insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
    values (${OTHER}, ${
    tab.rows[0].id
  }, 'Рабочий спринт', current_date - 3, current_date + 10, current_date + 3, 'active')
    returning id`;
  await db.queryArray`
    insert into sprint_items (cycle_id, task_id, in_plan, added_by) values (${
    cycle.rows[0].id
  }, ${taskId}, true, 'test')`;
  const comment = await db.queryObject<{ id: string }>`
    insert into task_comments (task_id, content) values (${taskId}, 'рабочий комментарий') returning id`;
  await db.queryArray`
    insert into task_history (task_id, changed_by, group_id) values (${taskId}, 'test', ${OTHER})`;
  await db.queryArray`
    insert into project_history (project_id, field, changed_by, group_id)
    values (${project.rows[0].id}, 'goal', 'test', ${OTHER})`;
  await db.queryArray`
    insert into task_subscriptions (task_id, telegram_id) values (${taskId}, ${OTHER_USER})`;
  await db.queryArray`
    insert into task_labels (group_id, owner_id, name) values (${OTHER}, ${OTHER_USER}, 'метка')`;
  await db.queryArray`
    insert into notifications (recipient_telegram_id, group_id, task_id, comment_id)
    values (${OTHER_USER}, ${OTHER}, ${taskId}, ${comment.rows[0].id})`;
  await db.queryArray`
    insert into entries (content, group_id, owner_id) values ('рабочая запись', ${OTHER}, ${OTHER_USER})`;
  const meeting = await db.queryObject<{ id: string }>`
    insert into meetings (identity_kind, identity_key, title, group_id, claim_owner)
    values ('manual', 't-demo-reset-other', 'Рабочая встреча', ${OTHER}, ${OTHER_USER}) returning id`;
  await db.queryArray`
    insert into meeting_live_notes (meeting_id, group_id, text) values (${
    meeting.rows[0].id
  }, ${OTHER}, 'заметка')`;
  await db
    .queryArray`insert into feedback (telegram_id, text) values (${OTHER_USER}, 'рабочий фидбек')`;
  await db.queryArray`
    insert into user_integrations (telegram_id, service, api_key) values (${OTHER_USER}, 'granola', 'ключ')`;
  await db.queryArray`
    insert into recorder_diagnostics (telegram_id, kind) values (${OTHER_USER}, 'test')`;
  await db
    .queryArray`insert into sessions (chat_id, action) values (${OTHER_USER}, 'test')`;
}

/** Всё, что посетитель успевает наломать в демо за полчаса. */
async function breakDemo(db: Client) {
  const guest = DEMO_USERS[0];
  // Проект посетителя и правка цели эталонного направления — ровно то, что висело в проде.
  await db
    .queryArray`insert into projects (group_id, name) values (${DEMO}, 'qefqf')`;
  await db
    .queryArray`update projects set goal = 'smoke check 55' where id = ${OPERATIONS}`;
  // Спринт принят и ушёл в архив, а посетитель начал новый: старый сид падал на
  // уникальном индексе «один живой спринт на пространство».
  await db.queryArray`
    update sprint_cycles set status = 'accepted', accepted_at = now(), archived_at = now()
     where id = ${LIVE_CYCLE}`;
  await db.queryArray`
    insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status)
    values (${DEMO}, ${SPACE}, 'Visitor sprint', current_date, current_date + 14, current_date + 7, 'active')`;
  // Удалённая задача, правленая задача, новая задача с комментарием, историей и подпиской.
  await db
    .queryArray`delete from tasks where id = 'd0000000-0000-4000-8000-000000000206'`;
  await db
    .queryArray`update tasks set status = 'done', title = 'hacked' where group_id = ${DEMO} and title = 'Launch summer menu'`;
  const t = await db.queryObject<{ id: string }>`
    insert into tasks (title, status, group_id, created_by) values ('visitor task', 'open', ${DEMO}, 'demo') returning id`;
  const c = await db.queryObject<{ id: string }>`
    insert into task_comments (task_id, content, added_by_telegram_id) values (${
    t.rows[0].id
  }, 'hi', ${guest}) returning id`;
  await db
    .queryArray`insert into task_history (task_id, changed_by, group_id) values (${
    t.rows[0].id
  }, 'demo', ${DEMO})`;
  await db
    .queryArray`insert into task_subscriptions (task_id, telegram_id) values ('d0000000-0000-4000-8000-000000000201', ${guest})`;
  await db.queryArray`
    insert into notifications (recipient_telegram_id, group_id, task_id, comment_id) values (${guest}, ${DEMO}, ${
    t.rows[0].id
  }, ${c.rows[0].id})`;
  await db
    .queryArray`insert into project_history (project_id, field, changed_by, group_id) values (${OPERATIONS}, 'goal', 'demo', ${DEMO})`;
  await db
    .queryArray`insert into task_labels (group_id, owner_id, name) values (${DEMO}, ${guest}, 'visitor label')`;
  // Записи, встречи, архив пространства, переименование воркспейса.
  await db
    .queryArray`insert into entries (content, group_id, owner_id) values ('visitor note', ${DEMO}, ${guest})`;
  await db
    .queryArray`update meetings set status = 'in_base', title = 'edited' where group_id = ${DEMO}`;
  await db
    .queryArray`update sprints set archived_at = now(), name = 'renamed' where id = ${SPACE}`;
  await db
    .queryArray`update workspaces set name = 'pwned', allowed_markets = array['XX'] where id = ${DEMO}`;
  // Личное посетителя: профиль, токены, интеграции, фидбек, лишний человек в воркспейсе.
  await db
    .queryArray`update user_profiles set first_name = 'Visitor', notes = 'mine' where telegram_id = ${guest}`;
  await db.queryArray`
    update allowed_users set claude_mcp_token_hash = 'leak', recorder_token_hash = 'leak', email = 'v@x', is_admin = true
     where telegram_id = ${guest}`;
  await db
    .queryArray`insert into user_integrations (telegram_id, service, api_key) values (${guest}, 'granola', 'visitor-key')`;
  await db
    .queryArray`insert into feedback (telegram_id, text) values (${guest}, 'visitor feedback')`;
  await db
    .queryArray`insert into recorder_diagnostics (telegram_id, kind) values (${guest}, 'test')`;
  await db
    .queryArray`insert into sessions (chat_id, action) values (${guest}, 'test') on conflict do nothing`;
  await db.queryArray`
    insert into allowed_users (telegram_id, username, group_id, is_admin, added_by)
    values (${EXTRA_DEMO_USER}, 'extra', ${DEMO}, false, 0) on conflict (telegram_id) do nothing`;
}

Deno.test("demo_reset: наломанное демо возвращается к эталону, чужое не тронуто ни на строку", async () => {
  await withDb(async (db) => {
    await seedOther(db);
    try {
      // Снимок чужого — ДО первого сброса: иначе строку, которую сброс ошибочно снёс сразу,
      // снимок «после» уже не содержал бы, и пропажа выглядела бы нормой.
      const other = await snapshot(db, OTHER_SCOPE, []);
      const counts = await reset(db);
      const etalon = await snapshot(db, DEMO_SCOPE, VOLATILE);
      assertEquals(
        await snapshot(db, OTHER_SCOPE, []),
        other,
        "первый же сброс демо задел строки не-демо воркспейса",
      );
      assertEquals(counts, {
        users: 7,
        tasks: 20,
        entries: 4,
        meetings: 1,
        spaces: 2,
        projects: 8,
        cycles: 2,
      });

      await breakDemo(db);
      // Порча применилась: иначе «равно эталону» ничего бы не доказало.
      assert(
        JSON.stringify(await snapshot(db, DEMO_SCOPE, VOLATILE)) !==
          JSON.stringify(etalon),
        "поломка демо не применилась — тест ничего не проверяет",
      );

      await reset(db);
      assertEquals(await snapshot(db, DEMO_SCOPE, VOLATILE), etalon);
      assertEquals(
        await snapshot(db, OTHER_SCOPE, []),
        other,
        "сброс демо задел строки не-демо воркспейса",
      );

      // Точечно — то, что висело мусором в проде и ломало прежний сид.
      const junk = await db.queryObject<{ n: number }>`
        select count(*)::int as n from projects where group_id = ${DEMO} and name = 'qefqf'`;
      assertEquals(junk.rows[0].n, 0);
      const goal = await db.queryObject<
        { goal: string | null }
      >`select goal from projects where id = ${OPERATIONS}`;
      assertEquals(goal.rows[0].goal, null);
      const live = await db.queryObject<{ id: string }>`
        select id from sprint_cycles
         where tab_id = ${SPACE} and status in ('draft','active') and archived_at is null`;
      assertEquals(live.rows.map((r) => r.id), [LIVE_CYCLE]);

      // Повторный сброс идемпотентен.
      await reset(db);
      assertEquals(await snapshot(db, DEMO_SCOPE, VOLATILE), etalon);
      assertEquals(await snapshot(db, OTHER_SCOPE, []), other);
    } finally {
      await cleanOther(db);
    }
  });
});

Deno.test("demo_reset: anon и authenticated вызвать не могут", async () => {
  await withDb(async (db) => {
    for (const role of ["anon", "authenticated"]) {
      const p = await db.queryObject<{ ok: boolean }>(
        `select has_function_privilege('${role}', 'public.demo_reset()', 'execute') as ok`,
      );
      assertEquals(p.rows[0].ok, false, `${role} имеет право на demo_reset()`);

      await db.queryArray("begin");
      try {
        await db.queryArray(`set local role ${role}`);
        await assertRejects(
          () => db.queryArray("select public.demo_reset()"),
          Error,
          "permission denied",
        );
      } finally {
        await db.queryArray("rollback");
      }
    }
  });
});

Deno.test("demo_reset: миграция регистрирует cron demo-reset раз в 30 минут (идемпотентно)", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  await withDb(async (db) => {
    await db.queryArray("begin");
    try {
      // На тестовом контуре pg_cron не включён — включаем внутри транзакции и откатываем.
      await db.queryArray("create extension if not exists pg_cron");
      await db.queryArray(sql);
      await db.queryArray(sql);
      const jobs = await db.queryObject<{ schedule: string; command: string }>(
        "select schedule, command from cron.job where jobname = 'demo-reset'",
      );
      assertEquals(jobs.rows, [{
        schedule: "*/30 * * * *",
        command: "select public.demo_reset()",
      }]);
    } finally {
      await db.queryArray("rollback");
    }
  });
});
