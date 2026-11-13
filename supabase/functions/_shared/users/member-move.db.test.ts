// Переезд человека в другое пространство (миграция 20261105200000, этап 3 решения
// docs/decisions/2026-11-05-second-workspace.md) — на НАСТОЯЩЕЙ базе.
//
// Ядро: ошибка здесь молчит и бьёт по живому человеку — потерянная задача, запись, оставшаяся в
// старом пространстве, погасший токен или чужая задача, уехавшая вместе с ним. Поэтому проверяется
// каждое правило по отдельности и то, что ничего не удалено.
//
// Каждый тест — в своей транзакции с откатом: общий стенд и CI остаются чистыми.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Таблицы с колонкой group_id и решение по каждой — шапка миграции 20261105200000. Новая таблица
// с group_id без решения там (или в создавшей её миграции) должна валить этот тест.
const GROUP_ID_TABLES = [
  "ai_key_health",
  "allowed_users",
  "board_stickers",
  "calendar_series_country",
  // #1168: cleanup/tombstone stays in the original home scope (20261113190000).
  "draft_meeting_deletions",
  "entries",
  "mcp_oauth_connections",
  "meeting_agent_grants",
  "meeting_audio_backups",
  "meeting_calendar_jobs",
  "meeting_calendar_misses",
  "meeting_calendar_snapshot_events",
  "meeting_calendar_snapshot_runs",
  "meeting_invites",
  "meeting_live_notes",
  "meetings",
  "model_usage",
  "notifications",
  "people",
  "presence",
  "presence_log",
  "project_history",
  "projects",
  "service_agents",
  "short_links",
  "sprint_cycles",
  "sprints",
  "task_files",
  "task_history",
  "task_labels",
  "tasks",
  "telegram_outbox",
  "workspace_secrets",
];

// Строки фикстуры по таблицам: всё, что лежит в двух тестовых пространствах.
const SNAP_TABLES = [
  "allowed_users",
  "people",
  "entries",
  "meetings",
  "tasks",
  "projects",
  "notifications",
  "task_labels",
  "task_history",
  "project_history",
  "mcp_oauth_connections",
];

type Row = Record<string, unknown>;
type MoveResult = Record<string, unknown> & {
  counts?: Record<string, unknown> & { other?: Record<string, unknown> };
  error?: string;
};

async function connect(): Promise<Client> {
  const db = new Client(DB_URL);
  try {
    await db.connect();
  } catch (e) {
    throw new Error(`нет базы ${DB_URL} — подними контур (make test-db): ${(e as Error).message}`);
  }
  return db;
}

const uid = () => crypto.randomUUID();
const tgId = () => -Math.floor(Date.now() * 1000 + Math.random() * 1000);

/** Реалистичная фикстура: человек «я» из A, коллега из A, пустое пространство B. */
async function seed(db: Client) {
  const A = "mm-a-" + uid().slice(0, 8);
  const B = "mm-b-" + uid().slice(0, 8);
  const me = tgId();
  const col = me - 7;
  const actor = me - 13;
  const meMail = `me-${uid()}@x.io`;
  const colMail = `col-${uid()}@x.io`;
  const id = {
    ePrivate: uid(),
    ePlain: uid(),
    eShared: uid(),
    eColNote: uid(),
    eNoteSolo: uid(),
    eNoteShared: uid(),
    mSolo: uid(),
    mShared: uid(),
    tSolo: uid(),
    tMixed: uid(),
    tInOwned: uid(),
    tInMixedProj: uid(),
    tColInMixedProj: uid(),
    tInSprintProj: uid(),
    tChild: uid(),
    pOwned: uid(),
    pMixed: uid(),
    pSprint: uid(),
    cycle: uid(),
    sprintItem: uid(),
    nMine: uid(),
    nMineOnMixed: uid(),
    nColOnMoved: uid(),
    labelMine: uid(),
    labelCol: uid(),
    oauthClient: "mm-client-" + uid(),
    oauth: uid(),
  };

  await db.queryArray`insert into workspaces(id, name) values (${A}, ${A}), (${B}, ${B})`;
  await db.queryArray`insert into allowed_users(telegram_id, username, added_by, group_id, is_admin, email,
      claude_mcp_token_hash, claude_mcp_token_expires_at, chatgpt_mcp_token_hash, chatgpt_mcp_token_expires_at,
      recorder_token_hash)
    values (${me}, 'mm me', 0, ${A}, true, ${meMail}, ${"c" + uid()}, now() + interval '1 day',
            ${"g" + uid()}, now() + interval '1 day', ${"r" + uid()})`;
  await db.queryArray`insert into allowed_users(telegram_id, username, added_by, group_id, email)
    values (${col}, 'mm col', 0, ${A}, ${colMail})`;
  await db.queryArray`insert into mcp_oauth_clients(client_id, client_name, redirect_uris)
    values (${id.oauthClient}, 'mm', array['https://x.io/cb'])`;
  await db
    .queryArray`insert into mcp_oauth_connections(id, telegram_id, group_id, client_id, redirect_uri, resource, scope)
    values (${id.oauth}, ${me}, ${A}, ${id.oauthClient}, 'https://x.io/cb', 'https://x.io/mcp', 'mcp')`;

  // Записи: личная, общая заметка, общая встреча коллеги, где «я» участник по e-mail, чужая заметка.
  await db.queryArray`insert into entries(id, content, group_id, owner_id, is_private, entry_type, updated_at)
    values (${id.ePrivate}, 'private', ${A}, ${me}, true, 'note', '2026-01-01T00:00:00Z'),
           (${id.ePlain}, 'plain', ${A}, ${me}, false, 'note', '2026-01-01T00:00:00Z'),
           (${id.eColNote}, 'col note', ${A}, ${col}, false, 'note', '2026-01-01T00:00:00Z')`;
  await db.queryArray`insert into entries(id, content, group_id, owner_id, is_private, entry_type, metadata)
    values (${id.eShared}, 'shared meeting', ${A}, ${col}, false, 'meeting',
            ${JSON.stringify({ attendees: [{ email: meMail.toUpperCase() }, { email: colMail }] })}::jsonb)`;

  // Черновики: только мой — едет; общий с коллегой — остаётся.
  await db.queryArray`insert into meetings(id, identity_kind, identity_key, group_id, claim_owner, recorders, status)
    values (${id.mSolo}, 'manual', ${"manual:" + uid()}, ${A}, ${me},
            ${JSON.stringify([{ telegram_id: me }])}::jsonb, 'awaiting_review'),
           (${id.mShared}, 'manual', ${"manual:" + uid()}, ${A}, ${me},
            ${JSON.stringify([{ telegram_id: me }, { telegram_id: col }])}::jsonb, 'awaiting_review')`;
  // Личные пометки к обоим черновикам.
  await db.queryArray`insert into entries(id, content, group_id, owner_id, is_private, entry_type, metadata)
    values (${id.eNoteSolo}, 'n1', ${A}, ${me}, true, 'note',
            ${JSON.stringify({ kind: "personal_notes", meeting_id: id.mSolo })}::jsonb),
           (${id.eNoteShared}, 'n2', ${A}, ${me}, true, 'note',
            ${JSON.stringify({ kind: "personal_notes", meeting_id: id.mShared })}::jsonb)`;

  // Проекты: целиком мой; смешанный (там задача коллеги); мой, но задача стоит в спринте A.
  await db.queryArray`insert into projects(id, group_id, name, created_by)
    values (${id.pOwned}, ${A}, 'owned', ${me}), (${id.pMixed}, ${A}, 'mixed', ${me}),
           (${id.pSprint}, ${A}, 'in sprint', ${me})`;
  await db.queryArray`insert into task_labels(id, group_id, owner_id, name)
    values (${id.labelMine}, ${A}, ${me}, 'mine'), (${id.labelCol}, ${A}, ${col}, 'col')`;
  await db
    .queryArray`insert into tasks(id, title, group_id, created_by_telegram_id, assignee_telegram_ids, project_id, label_ids)
    values (${id.tSolo}, 'solo', ${A}, ${me}, ${[me]}, null, ${[id.labelMine, id.labelCol]}),
           (${id.tMixed}, 'mixed', ${A}, ${col}, ${[me]}, null, '{}'),
           (${id.tInOwned}, 'in owned', ${A}, ${me}, ${[me]}, ${id.pOwned}, '{}'),
           (${id.tInMixedProj}, 'in mixed project', ${A}, ${me}, ${[me]}, ${id.pMixed}, '{}'),
           (${id.tColInMixedProj}, 'col in mixed project', ${A}, ${col}, ${[col]}, ${id.pMixed}, '{}'),
           (${id.tInSprintProj}, 'in sprint project', ${A}, ${me}, ${[me]}, ${id.pSprint}, '{}')`;
  await db.queryArray`insert into tasks(id, title, group_id, created_by_telegram_id, assignee_telegram_ids, parent_id)
    values (${id.tChild}, 'child of mixed', ${A}, ${me}, ${[me]}, ${id.tMixed})`;
  await db.queryArray`insert into sprint_cycles(id, group_id, name, start_date, end_date, status)
    values (${id.cycle}, ${A}, 'S1', '2026-11-01', '2026-11-14', 'active')`;
  await db.queryArray`insert into sprint_items(id, cycle_id, task_id, in_plan)
    values (${id.sprintItem}, ${id.cycle}, ${id.tInSprintProj}, true)`;

  await db.queryArray`insert into task_history(task_id, changed_by, group_id) values (${id.tSolo}, 'me', ${A})`;
  await db.queryArray`insert into project_history(project_id, group_id, field, changed_by)
    values (${id.pOwned}, ${A}, 'created', 'me')`;
  await db.queryArray`insert into notifications(id, recipient_telegram_id, group_id, task_id)
    values (${id.nMine}, ${me}, ${A}, null), (${id.nMineOnMixed}, ${me}, ${A}, ${id.tMixed}),
           (${id.nColOnMoved}, ${col}, ${A}, ${id.tSolo})`;

  return { A, B, me, col, actor, meMail, id };
}

type Fixture = Awaited<ReturnType<typeof seed>>;

async function move(db: Client, f: Fixture, dryRun: boolean, expected: unknown = null): Promise<MoveResult> {
  const exp = expected === null ? null : JSON.stringify(expected);
  const r = await db.queryObject<{ r: MoveResult }>`
    select public.move_member_to_workspace(${f.me}, ${f.B}, ${f.actor}, ${dryRun}, ${exp}::jsonb) as r`;
  return r.rows[0].r;
}

/** Все строки фикстуры по таблицам (полностью) — сравнение «ничего не записано». */
async function snapshot(db: Client, f: Fixture): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of SNAP_TABLES) {
    const r = await db.queryObject<{ rows: string }>(
      `select coalesce(jsonb_agg(to_jsonb(x) - 'embedding' order by to_jsonb(x)::text), '[]')::text as rows
         from public.${t} x where x.group_id in ($1, $2)`,
      [f.A, f.B],
    );
    out[t] = r.rows[0].rows;
  }
  const si = await db.queryObject<{ rows: string }>`
    select coalesce(jsonb_agg(to_jsonb(x)), '[]')::text as rows from public.sprint_items x where x.id = ${f.id.sprintItem}`;
  out.sprint_items = si.rows[0].rows;
  return out;
}

/** Сколько строк фикстуры каждой таблицы — по id, без учёта пространства. */
async function rowCounts(db: Client, f: Fixture): Promise<Record<string, number>> {
  const ids = Object.values(f.id).filter((v) => /^[0-9a-f-]{36}$/.test(v));
  const out: Record<string, number> = {};
  for (const t of ["entries", "meetings", "tasks", "projects", "notifications", "task_labels", "sprint_items"]) {
    const r = await db.queryObject<{ n: bigint }>(`select count(*) as n from public.${t} where id = any($1::uuid[])`, [
      ids,
    ]);
    out[t] = Number(r.rows[0].n);
  }
  return out;
}

async function one<T>(db: Client, sql: string, args: unknown[] = []): Promise<T> {
  return (await db.queryObject<T>(sql, args)).rows[0];
}

async function inTx(fn: (db: Client, f: Fixture) => Promise<void>) {
  const db = await connect();
  try {
    await db.queryArray`begin`;
    const f = await seed(db);
    await fn(db, f);
  } finally {
    await db.queryArray`rollback`;
    await db.end();
  }
}

Deno.test("переезд: у каждой таблицы с group_id есть решение в миграции", async () => {
  const db = await connect();
  try {
    const r = await db.queryObject<{ t: string }>`
      select c.table_name as t from information_schema.columns c
        join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
       where c.table_schema = 'public' and c.column_name = 'group_id' and tb.table_type = 'BASE TABLE'
       order by 1`;
    assertEquals(
      r.rows.map((x) => x.t),
      GROUP_ID_TABLES,
      "новая таблица с group_id: реши, едет ли она при переезде (шапка 20261105200000), и впиши сюда",
    );
  } finally {
    await db.end();
  }
});

Deno.test("переезд: функция закрыта для anon/authenticated, открыта service_role", async () => {
  const db = await connect();
  try {
    const sig = "public.move_member_to_workspace(bigint, text, bigint, boolean, jsonb)";
    const r = await db.queryObject<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role', $1, 'execute') as svc`,
      [sig],
    );
    assertEquals(r.rows[0], { anon: false, auth: false, svc: true }, "грант на PUBLIC наследуют anon/authenticated");
  } finally {
    await db.end();
  }
});

Deno.test("переезд: пробный прогон считает всё и ничего не пишет", async () => {
  await inTx(async (db, f) => {
    const before = await snapshot(db, f);
    const r = await move(db, f, true);
    assertEquals(await snapshot(db, f), before, "пробный прогон изменил данные");
    assertEquals(r.error, undefined);
    assertEquals(r.can_execute, true);
    assertEquals(r.conflicts, []);
    const c = r.counts!;
    assertEquals(
      [c.private_entries, c.entries, c.personal_notes, c.drafts, c.meetings_shared],
      [1, 1, 1, 1, 1],
      "записи: личная, общая заметка, пометка к своему черновику, черновик, общая встреча",
    );
    assertEquals(
      [c.tasks, c.tasks_detached, c.projects, c.notifications, c.labels],
      [5, 2, 1, 2, 1],
      "задачи/проекты/уведомления/метки",
    );
    const o = c.other!;
    assertEquals(o.personal_notes_kept, 1, "пометка к общему черновику остаётся рядом с ним");
    assertEquals([o.sprint_items, o.task_parent_links, o.task_label_links], [1, 1, 1]);
    assertEquals([o.task_history, o.project_history, o.mcp_oauth_connections, o.people], [1, 1, 1, 1]);
    assertEquals((r.tasks_mixed as Row[]).map((t) => t.id), [f.id.tMixed], "смешанная задача названа");
    assertEquals(
      (r.tasks_detached as Row[]).map((t) => t.id).sort(),
      [f.id.tInMixedProj, f.id.tInSprintProj].sort(),
    );
    assertEquals((r.projects as Row[]).map((p) => p.id), [f.id.pOwned]);
    assertEquals(r.tokens, { claude: true, chatgpt: true, oauth: 1, recorder: true });
    assertEquals(r.moved, false);
  });
});

Deno.test("переезд: расхождение с показанным — отказ, ничего не записано", async () => {
  await inTx(async (db, f) => {
    const before = await snapshot(db, f);
    const r = await move(db, f, false, { tasks: 4, entries: 1 });
    assertEquals(r.error, "expected_mismatch");
    assertEquals(await snapshot(db, f), before, "отказ по расхождению всё-таки записал");
  });
});

Deno.test("переезд: личное едет, общее открывается, смешанное остаётся, ничего не удалено, токены живы", async () => {
  await inTx(async (db, f) => {
    const countsBefore = await rowCounts(db, f);
    const tokensBefore = await one<Row>(
      db,
      `select claude_mcp_token_hash, chatgpt_mcp_token_hash, recorder_token_hash from allowed_users where telegram_id = $1`,
      [f.me],
    );
    const r = await move(db, f, false, { tasks: 5, entries: 1 });
    assertEquals(r.error, undefined, `переезд отказал: ${JSON.stringify(r)}`);
    assertEquals(r.moved, true);
    assertEquals(await rowCounts(db, f), countsBefore, "переезд удалил строки");

    const g = async (table: string, id: string) =>
      (await one<{ g: string }>(db, `select group_id as g from public.${table} where id = $1`, [id])).g;
    const { id, A, B } = f;

    // Человек: новое пространство, без флага админа, токены и подключение живы, людей перенёс триггер.
    const me = await one<Row>(
      db,
      `select group_id, is_admin, claude_mcp_token_hash, chatgpt_mcp_token_hash, recorder_token_hash
         from allowed_users where telegram_id = $1`,
      [f.me],
    );
    assertEquals([me.group_id, me.is_admin], [B, false]);
    assertEquals(
      [me.claude_mcp_token_hash, me.chatgpt_mcp_token_hash, me.recorder_token_hash],
      [tokensBefore.claude_mcp_token_hash, tokensBefore.chatgpt_mcp_token_hash, tokensBefore.recorder_token_hash],
      "переезд погасил токен",
    );
    const conn = await one<Row>(db, `select group_id, revoked_at from mcp_oauth_connections where id = $1`, [id.oauth]);
    assertEquals([conn.group_id, conn.revoked_at], [B, null], "OAuth-подключение не переехало или отозвано");
    const people = await one<Row>(
      db,
      `select (select p.group_id from people p join allowed_users u on u.id = p.account_id where u.telegram_id = $1) as mine,
              (select p.group_id from people p join allowed_users u on u.id = p.account_id where u.telegram_id = $2) as col`,
      [f.me, f.col],
    );
    assertEquals([people.mine, people.col], [B, A]);

    // Записи.
    assertEquals([await g("entries", id.ePrivate), await g("entries", id.ePlain)], [B, B], "личное не переехало");
    assertEquals([await g("entries", id.eColNote), await g("entries", id.eShared)], [A, A], "чужое уехало");
    const vis = await one<Row>(
      db,
      `select (select visible_group_ids from entries where id = $1) as shared,
              (select visible_group_ids from entries where id = $2) as private,
              (select updated_at = '2026-01-01T00:00:00Z' from entries where id = $2) as kept`,
      [id.eShared, id.ePrivate],
    );
    assertEquals(vis.shared, [A, B].sort(), "общая встреча не открылась новому пространству");
    assertEquals(vis.private, [B]);
    assertEquals(vis.kept, true, "переезд сдвинул updated_at записи");
    assertEquals([await g("meetings", id.mSolo), await g("meetings", id.mShared)], [B, A], "черновики");
    assertEquals(
      [await g("entries", id.eNoteSolo), await g("entries", id.eNoteShared)],
      [B, A],
      "пометки идут за своей встречей",
    );

    // Задачи и проекты.
    assertEquals(await g("tasks", id.tMixed), A, "смешанная задача уехала");
    assertEquals(await g("tasks", id.tColInMixedProj), A);
    for (const t of [id.tSolo, id.tInOwned, id.tInMixedProj, id.tInSprintProj, id.tChild]) {
      assertEquals(await g("tasks", t), B, `задача ${t} не переехала`);
    }
    const proj = await one<Row>(db, `select group_id, sprint_id from projects where id = $1`, [id.pOwned]);
    assertEquals([proj.group_id, proj.sprint_id], [B, null]);
    assertEquals([await g("projects", id.pMixed), await g("projects", id.pSprint)], [A, A]);
    const links = await one<Row>(
      db,
      `select (select project_id from tasks where id = $1) as detached1,
              (select project_id from tasks where id = $2) as detached2,
              (select project_id::text from tasks where id = $3) as kept,
              (select parent_id from tasks where id = $4) as parent,
              (select label_ids::text from tasks where id = $5) as labels`,
      [id.tInMixedProj, id.tInSprintProj, id.tInOwned, id.tChild, id.tSolo],
    );
    assertEquals([links.detached1, links.detached2, links.kept], [null, null, id.pOwned]);
    assertEquals(links.parent, null, "связь с родителем, оставшимся в A, не разорвана");
    assertEquals(links.labels, `{${id.labelMine}}`, "чужая метка не снята или своя потеряна");
    const si = await one<Row>(db, `select task_id, removed_at is not null as removed from sprint_items where id = $1`, [
      id.sprintItem,
    ]);
    assertEquals([si.task_id, si.removed], [id.tInSprintProj, true], "строка спринта A не стала упоминанием");

    // Хвосты.
    assertEquals(
      [
        await g("notifications", id.nMine),
        await g("notifications", id.nColOnMoved),
        await g("notifications", id.nMineOnMixed),
      ],
      [B, B, A],
      "едут: своё без задачи и о переехавшей задаче; о смешанной остаётся",
    );
    assertEquals([await g("task_labels", id.labelMine), await g("task_labels", id.labelCol)], [B, A]);
    const hist = await one<Row>(
      db,
      `select (select group_id from task_history where task_id = $1) as th,
              (select group_id from project_history where project_id = $2) as ph`,
      [id.tSolo, id.pOwned],
    );
    assertEquals([hist.th, hist.ph], [B, B]);

    // Журнал переезда.
    const log = await one<Row>(
      db,
      `select actor_telegram_id, from_workspace, to_workspace from member_moves where telegram_id = $1`,
      [f.me],
    );
    assertEquals([Number(log.actor_telegram_id), log.from_workspace, log.to_workspace], [f.actor, A, B]);

    // Обычная смена пространства (не переезд) токены по-прежнему гасит.
    await db.queryArray`update allowed_users set group_id = ${A} where telegram_id = ${f.me}`;
    const after = await one<Row>(
      db,
      `select claude_mcp_token_hash, chatgpt_mcp_token_hash,
              (select revoked_at is not null from mcp_oauth_connections where id = $2) as oauth_revoked
         from allowed_users where telegram_id = $1`,
      [f.me, id.oauth],
    );
    assertEquals(
      [after.claude_mcp_token_hash, after.chatgpt_mcp_token_hash, after.oauth_revoked],
      [null, null, true],
      "обход отзыва токенов пережил переезд — обычная смена пространства их не гасит",
    );
  });
});

Deno.test("переезд: в новом пространстве уже есть человек с той же почтой — конфликт, ничего не записано", async () => {
  await inTx(async (db, f) => {
    await db
      .queryArray`insert into people(group_id, display_name, email, source) values (${f.B}, 'twin', ${f.meMail}, 'manual')`;
    const dry = await move(db, f, true);
    assertEquals(dry.can_execute, false);
    assertEquals(dry.conflicts, [`people_email_taken:${f.meMail}`]);
    const before = await snapshot(db, f);
    const r = await move(db, f, false, { tasks: 5, entries: 1 });
    assertEquals(r.error, "conflicts");
    assertEquals(await snapshot(db, f), before, "конфликтный переезд записал");
  });
});

Deno.test("переезд: отказы — то же пространство, нет человека, нет пространства", async () => {
  await inTx(async (db, f) => {
    const call = async (tid: number, to: string) =>
      (await one<{ r: MoveResult }>(db, `select public.move_member_to_workspace($1, $2, $3, true) as r`, [
        tid,
        to,
        f.actor,
      ])).r.error;
    assertEquals(await call(f.me, f.A), "same_workspace");
    assertEquals(await call(f.me, "mm-no-such-" + uid()), "workspace_not_found");
    assertEquals(await call(f.me - 999, f.B), "person_not_found");
  });
});
