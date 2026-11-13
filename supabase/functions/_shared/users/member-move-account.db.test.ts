// Account identity must work before a person signs in. Synthetic data, each test rolls back.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
type Row = Record<string, unknown>;

async function one<T>(db: Client, sql: string, args: unknown[] = []): Promise<T> {
  const r = await db.queryObject<T>(sql, args);
  return r.rows[0];
}

async function fixture(fn: (db: Client, f: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await db.queryArray`begin`;
    await fn(db, await seed(db));
  } finally {
    await db.queryArray`rollback`;
    await db.end();
  }
}

async function seed(db: Client) {
  const suffix = crypto.randomUUID();
  const a = `mm-account-a-${suffix}`, b = `mm-account-b-${suffix}`;
  const colleague = -Math.floor(Date.now() * 1000 + Math.random() * 1000);
  await db.queryArray`insert into workspaces(id, name) values (${a}, 'Fixture A'), (${b}, 'Fixture B')`;
  const account = await one<{ id: string }>(
    db,
    `insert into allowed_users(telegram_id, username, email, added_by, group_id)
       values (null, null, $1, 0, $2) returning id::text`,
    [`pending-${suffix}@x.io`, a],
  );
  await db.queryArray`insert into allowed_users(telegram_id, username, added_by, group_id)
    values (${colleague}, 'fixture colleague', 0, ${a})`;
  const person = await one<{ id: string }>(db, `select id from people where account_id = $1`, [account.id]);
  const solo = crypto.randomUUID(), mixed = crypto.randomUUID(), label = crypto.randomUUID();
  await db
    .queryArray`insert into task_labels(id, owner_id, group_id, name) values (${label}, ${colleague}, ${a}, 'fixture label')`;
  await db.queryArray`insert into tasks(id, title, group_id, assignee_person_id, label_ids)
    values (${solo}, 'fixture solo', ${a}, ${person.id}, array[${label}]::uuid[])`;
  await db.queryArray`insert into tasks(id, title, group_id, assignee_person_id, created_by_telegram_id)
    values (${mixed}, 'fixture mixed', ${a}, ${person.id}, ${colleague})`;
  return { a, b, account: account.id, person: person.id, solo, mixed, colleague, label };
}

async function move(db: Client, f: Awaited<ReturnType<typeof seed>>, dry: boolean, expected: unknown = null) {
  const r = await one<{ result: Row }>(
    db,
    `select move_member_account_to_workspace($1, $2, $3, $4, $5::jsonb) as result`,
    [f.account, f.b, f.colleague, dry, expected === null ? null : JSON.stringify(expected)],
  );
  return r.result;
}

Deno.test("переезд приглашения: preview видит personID-задачи без Telegram и ничего не меняет", async () => {
  await fixture(async (db, f) => {
    const r = await move(db, f, true);
    assertEquals(r.error, undefined);
    assertEquals(r.person, {
      account_id: f.account,
      telegram_id: null,
      email: `pending-${f.a.slice("mm-account-a-".length)}@x.io`,
    });
    assertEquals((r.counts as Row).tasks, 1);
    assertEquals((r.tasks_mixed as Row[]).map((t) => t.id), [f.mixed]);
    assertEquals(await one(db, `select group_id from allowed_users where id = $1`, [f.account]), { group_id: f.a });
    assertEquals(await one(db, `select count(*)::int as count from member_moves where account_id = $1`, [f.account]), {
      count: 0,
    });
  });
});

Deno.test("переезд приглашения: account и personID едут с одиночной задачей, смешанная остаётся, журнал сохраняется", async () => {
  await fixture(async (db, f) => {
    const preview = await move(db, f, true);
    const counts = preview.counts as Row;
    const r = await move(db, f, false, { tasks: counts.tasks, entries: counts.entries });
    assertEquals([r.error, r.moved], [undefined, true]);
    assertEquals(await one(db, `select group_id, telegram_id from allowed_users where id = $1`, [f.account]), {
      group_id: f.b,
      telegram_id: null,
    });
    assertEquals(await one(db, `select group_id, account_id::text from people where id = $1`, [f.person]), {
      group_id: f.b,
      account_id: f.account,
    });
    assertEquals(await one(db, `select group_id, assignee_person_id, label_ids from tasks where id = $1`, [f.solo]), {
      group_id: f.b,
      assignee_person_id: f.person,
      label_ids: [],
    });
    assertEquals(await one(db, `select group_id, assignee_person_id from tasks where id = $1`, [f.mixed]), {
      group_id: f.a,
      assignee_person_id: f.person,
    });
    assertEquals(
      await one(
        db,
        `select account_id::text, telegram_id, from_workspace, to_workspace from member_moves where account_id = $1`,
        [f.account],
      ),
      { account_id: f.account, telegram_id: null, from_workspace: f.a, to_workspace: f.b },
    );
  });
});

Deno.test("переезд приглашения: изменившийся preview откатывает account, people и задачи", async () => {
  await fixture(async (db, f) => {
    const r = await move(db, f, false, { tasks: 99, entries: 0 });
    assertEquals(r.error, "expected_mismatch");
    assertEquals(await one(db, `select group_id from allowed_users where id = $1`, [f.account]), { group_id: f.a });
    assertEquals(await one(db, `select group_id from people where id = $1`, [f.person]), { group_id: f.a });
    assertEquals(await one(db, `select group_id from tasks where id = $1`, [f.solo]), { group_id: f.a });
    assertEquals(await one(db, `select count(*)::int as count from member_moves where account_id = $1`, [f.account]), {
      count: 0,
    });
  });
});
