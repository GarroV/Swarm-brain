// Привязка Telegram из веба (#92) — на настоящей базе. Здесь решается, ПОД ЧЬИМ номером бот
// пустит человека, поэтому проверяются и отказы: истёкший код, занятый Telegram, повтор кода.
//
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) {
    throw new Error(
      `Не задана переменная ${name}. Подними локальный контур (supabase start) и прогоняй ` +
        `через ./scripts/check — он подставит доступы.`,
    );
  }
}

const { claimTelegramLink, resolveIdentity } = await import("./telegram-link-store.ts");
const { hashLinkCode, newLinkCode } = await import("../../_shared/telegram-link.ts");

const WS = "t_tg_link";
const WEB_ME = -900551; // вошёл по почте
const REAL_OTHER = 900552; // у другого человека этот Telegram — номер строки
const MY_TG = 900553; // мой настоящий Telegram

async function connect(): Promise<Client> {
  const db = new Client(DB_URL);
  await db.connect();
  return db;
}

async function seed(db: Client, codeHash: string, expiresIn: string) {
  await db.queryArray`delete from allowed_users where telegram_id in (${WEB_ME}, ${REAL_OTHER})`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
  await db.queryArray`
    insert into allowed_users (telegram_id, email, added_by, group_id, telegram_link_code_hash, telegram_link_expires_at)
    values (${WEB_ME}, 'web-me@example.test', 0, ${WS}, ${codeHash}, now() + ${expiresIn}::interval)`;
  await db.queryArray`
    insert into allowed_users (telegram_id, username, added_by, group_id)
    values (${REAL_OTHER}, 'tg_other_900552', 0, ${WS})`;
}

async function cleanup(db: Client) {
  await db.queryArray`delete from allowed_users where telegram_id in (${WEB_ME}, ${REAL_OTHER})`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
  await db.end();
}

Deno.test("верный код привязывает Telegram, бот узнаёт человека под его номером, код одноразовый", async () => {
  const db = await connect();
  try {
    const code = newLinkCode();
    await seed(db, await hashLinkCode(code), "15 minutes");
    assertEquals(await resolveIdentity(MY_TG), MY_TG, "до привязки Telegram никому не принадлежит");
    assertEquals(await claimTelegramLink(code, MY_TG), "linked");
    assertEquals(await resolveIdentity(MY_TG), WEB_ME);
    assertEquals(await claimTelegramLink(code, MY_TG), "expired", "второй раз тот же код не работает");
  } finally {
    await cleanup(db);
  }
});

Deno.test("истёкший код не привязывает", async () => {
  const db = await connect();
  try {
    const code = newLinkCode();
    await seed(db, await hashLinkCode(code), "-1 minute");
    assertEquals(await claimTelegramLink(code, MY_TG), "expired");
    assertEquals(await resolveIdentity(MY_TG), MY_TG);
  } finally {
    await cleanup(db);
  }
});

Deno.test("Telegram, который уже чей-то номер, не привязывается к другому человеку", async () => {
  const db = await connect();
  try {
    const code = newLinkCode();
    await seed(db, await hashLinkCode(code), "15 minutes");
    assertEquals(await claimTelegramLink(code, REAL_OTHER), "taken");
    assertEquals(await resolveIdentity(REAL_OTHER), REAL_OTHER, "чужой Telegram остаётся за его владельцем");
  } finally {
    await cleanup(db);
  }
});

Deno.test("чужой код не подходит", async () => {
  const db = await connect();
  try {
    await seed(db, await hashLinkCode(newLinkCode()), "15 minutes");
    assertEquals(await claimTelegramLink(newLinkCode(), MY_TG), "expired");
  } finally {
    await cleanup(db);
  }
});
