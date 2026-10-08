// Срок хранения аудио встреч — `public.meeting_audio_expired()` на НАСТОЯЩЕЙ базе (решение 08.10.2026).
//
// Что доказывается: функция отдаёт только части бакета meeting-audio старше срока — свежие и чужие
// бакеты не трогает, лимит соблюдает; вызвать её может только service_role. Ошибка здесь стирает
// записи встреч, поэтому проверка идёт на базе, а не на моке.
//
// Строки storage.objects заводятся внутри транзакции и откатываются: в хранилище ничего не остаётся.
// Тест не умеет «пропускаться»: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MIGRATION = new URL(
  "../../migrations/20261008160000_meeting_audio_retention.sql",
  import.meta.url,
);
const FN = "public.meeting_audio_expired(integer, integer)";
const PREFIX = "t_audio_retention";
// Встреча в обработке: её части не трогаются, сколько бы им ни было.
const BUSY = "7e57a0d0-0000-4000-8000-00000000a0d1";

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

async function scenario(run: (db: Client) => Promise<void>): Promise<void> {
  const db = await connect();
  try {
    // Не перенакатываем существующую: порча (scripts/porcha-sql) иначе чинила бы себя обратно.
    const has = await db.queryObject<{ ok: boolean }>(`select to_regprocedure('${FN}') is not null as ok`);
    if (!has.rows[0].ok) await db.queryArray(await Deno.readTextFile(MIGRATION));
    await db.queryArray("begin");
    await db.queryArray(
      `insert into storage.buckets (id, name, public) values ('meeting-audio','meeting-audio',false)
       on conflict (id) do nothing`,
    );
    await db.queryArray(
      `insert into storage.objects (bucket_id, name, created_at) values
         ('meeting-audio', '${PREFIX}/old-a.m4a', now() - interval '9 days'),
         ('meeting-audio', '${PREFIX}/old-b.m4a', now() - interval '8 days'),
         ('meeting-audio', '${PREFIX}/fresh.m4a', now() - interval '6 days'),
         ('meeting-audio', '${PREFIX}/today.m4a', now()),
         ('meeting-audio', '${PREFIX}/queued/person_1.json', now() - interval '9 days'),
         ('meeting-audio', '${BUSY}/gen/sys-0.m4a', now() - interval '9 days'),
         ('swarm_private', '${PREFIX}/other-bucket.m4a', now() - interval '30 days')`,
    );
    await db.queryArray(
      `insert into public.meetings (id, source, identity_kind, identity_key, summary_status)
       values ('${BUSY}', 'desktop-agent', 'manual', '${BUSY}', 'processing')`,
    );
    await run(db);
  } finally {
    await db.queryArray("rollback").catch(() => undefined);
    await db.end();
  }
}

async function expired(db: Client, days: number, limit: number): Promise<string[]> {
  const r = await db.queryObject<{ name: string }>(
    `select name from public.meeting_audio_expired($1, $2) as name where name like '${PREFIX}/%'`,
    [days, limit],
  );
  return r.rows.map((row) => row.name);
}

Deno.test("meeting_audio_expired: только старше срока и только бакет meeting-audio", async () => {
  await scenario(async (db) => {
    assertEquals(await expired(db, 7, 1000), [`${PREFIX}/old-a.m4a`, `${PREFIX}/old-b.m4a`]);
  });
});

Deno.test("meeting_audio_expired: лимит соблюдается, старшие идут первыми", async () => {
  await scenario(async (db) => {
    const all = await db.queryObject<{ n: number }>(
      `select count(*)::int as n from public.meeting_audio_expired(7, 1000)`,
    );
    const limited = await db.queryObject<{ name: string }>(
      `select name from public.meeting_audio_expired(7, $1) as name`,
      [all.rows[0].n - 1],
    );
    assertEquals(limited.rows.length, all.rows[0].n - 1);
    assertEquals(limited.rows.some((r) => r.name === `${PREFIX}/old-b.m4a`), false);
  });
});

Deno.test("meeting_audio_expired: ноль и минус в сроке — не моложе суток", async () => {
  await scenario(async (db) => {
    assertEquals(await expired(db, 0, 1000), [`${PREFIX}/old-a.m4a`, `${PREFIX}/old-b.m4a`, `${PREFIX}/fresh.m4a`]);
    assertEquals(await expired(db, -5, 1000), [`${PREFIX}/old-a.m4a`, `${PREFIX}/old-b.m4a`, `${PREFIX}/fresh.m4a`]);
  });
});

Deno.test("meeting_audio_expired: части встречи в обработке не отдаются", async () => {
  await scenario(async (db) => {
    const r = await db.queryObject<{ n: number }>(
      `select count(*)::int as n from public.meeting_audio_expired(7, 1000) as name where name like '${BUSY}/%'`,
    );
    assertEquals(r.rows[0].n, 0);
  });
});

Deno.test("meeting_audio_expired: вызвать может только service_role", async () => {
  await scenario(async (db) => {
    for (const [role, allowed] of [["anon", false], ["authenticated", false], ["service_role", true]] as const) {
      const p = await db.queryObject<{ ok: boolean }>(
        `select has_function_privilege('${role}', '${FN}', 'execute') as ok`,
      );
      assertEquals(p.rows[0].ok, allowed, `${role}: execute = ${p.rows[0].ok}`);
    }
  });
});
