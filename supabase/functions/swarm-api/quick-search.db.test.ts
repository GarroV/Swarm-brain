// Подсказки поиска слева (GET /search/quick) — на настоящем обработчике и настоящей базе: здесь
// проверяется РЕШЕНИЕ О ДОСТУПЕ. Ошибка в нём не падает: в выпадающем списке просто окажется
// название чужой приватной записи или задачи закрытого проекта.
//
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Импорт динамический: клиент базы создаётся на уровне модуля, переменные обязаны стоять раньше.
const { handleQuickSearchRoutes } = await import("./quick-search.ts");

const WS = "t_quick_search";
const OTHER_WS = "t_quick_search_other";
const ME = 900601;
const COLLEAGUE = 900602;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function connect(): Promise<Client> {
  const db = new Client(DB_URL);
  await db.connect();
  return db;
}

async function seed(db: Client) {
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from entries where group_id = ${ws}`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`update projects set parent_id = null where group_id = ${ws}`;
    await db.queryArray`delete from projects where group_id = ${ws}`;
    await db.queryArray`delete from allowed_users where group_id = ${ws}`;
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db.queryArray`insert into workspaces (id, name) values (${ws}, ${ws})`;
  }
  for (const person of [ME, COLLEAGUE]) {
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id)
      values (${person}, ${"u" + person}, 0, ${WS})`;
  }
  const project = async (name: string, priv: boolean, ws = WS, by = COLLEAGUE) =>
    (await db.queryObject<{ id: string }>`
      insert into projects (group_id, name, created_by, is_private)
      values (${ws}, ${name}, ${by}, ${priv}) returning id`).rows[0].id;
  const open = await project("Zebra открытый проект", false);
  const secret = await project("Zebra закрытый проект", true);
  await project("Zebra чужой воркспейс", false, OTHER_WS);
  await project("Zebra мой закрытый проект", true, WS, ME);

  const task = async (
    title: string,
    opts: { project?: string; ws?: string; status?: string; archived?: boolean } = {},
  ) =>
    await db.queryArray`
      insert into tasks (title, status, group_id, project_id, created_by, confirmed, archived_at)
      values (${title}, ${opts.status ?? "open"}, ${opts.ws ?? WS}, ${opts.project ?? null}, 'test', true,
              ${opts.archived ? new Date() : null})`;
  await task("Zebra задача в открытом", { project: open });
  await task("Zebra задача в закрытом", { project: secret });
  await task("Zebra задача без проекта");
  await task("Zebra задача чужого воркспейса", { ws: OTHER_WS });
  await task("Zebra задача в архиве", { archived: true });
  await task("Скидка 100% на zebra");
  await task("Zebra_подчёркивание");

  const entry = async (
    content: string,
    opts: {
      type?: string;
      priv?: boolean;
      owner?: number | null;
      ws?: string;
      confirmed?: boolean;
      title?: string;
      archived?: boolean;
    } = {},
  ) =>
    await db.queryArray`
      insert into entries (content, entry_type, source, added_by, is_private, owner_id, metadata, group_id, archived_at)
      values (${content}, ${opts.type ?? "note"}, 'test', 'test', ${opts.priv ?? false}, ${opts.owner ?? null},
              ${
      JSON.stringify({ confirmed: opts.confirmed ?? true, ...(opts.title ? { title: opts.title } : {}) })
    }::jsonb, ${opts.ws ?? WS},
              ${opts.archived ? new Date() : null})`;
  await entry("Zebra общая заметка");
  await entry("Zebra личная заметка коллеги", { priv: true, owner: COLLEAGUE });
  await entry("Zebra моя личная заметка", { priv: true, owner: ME });
  await entry("Zebra заметка в архиве", { archived: true });
  await entry("Zebra заметка чужого воркспейса", { ws: OTHER_WS });
  await entry("Zebra согласованная встреча", { type: "meeting" });
  await entry("Текст без совпадения", { type: "meeting", title: "Zebra встреча по названию" });
  await entry("Zebra личная встреча коллеги", { type: "meeting", priv: true, owner: COLLEAGUE });
  await entry("Zebra встреча без согласования", { type: "meeting", confirmed: false });
}

type Hit = { id: string; title?: string; name?: string };
type Body = { tasks: Hit[]; projects: Hit[]; meetings: Hit[]; notes: Hit[] };

async function search(q: string, viewer = ME): Promise<Body> {
  const path = "/search/quick";
  const res = await handleQuickSearchRoutes(
    { supabase, telegramId: viewer, groupId: WS, origin: "https://web.test" },
    new Request(`https://api.test${path}?q=${encodeURIComponent(q)}`),
    path,
  );
  assertEquals(res?.status, 200);
  return await res!.json() as Body;
}

const names = (hits: Hit[]) => hits.map((h) => h.title ?? h.name).sort();

Deno.test("подсказки: задачи — чужой воркспейс, архив и закрытый проект не попадают", async () => {
  const db = await connect();
  try {
    await seed(db);
    const body = await search("zebra");
    assertEquals(
      names(body.tasks),
      [
        "Zebra задача без проекта",
        "Zebra задача в открытом",
        "Zebra_подчёркивание",
        "Скидка 100% на zebra",
      ].sort(),
    );
    assert(!names(body.tasks).some((t) => t?.includes("закрыт")), "задача закрытого проекта — утечка");
    assert(!names(body.tasks).some((t) => t?.includes("чужого")), "чужой воркспейс — утечка");
  } finally {
    await db.end();
  }
});

Deno.test("подсказки: проекты — закрытый чужой и чужой воркспейс не попадают", async () => {
  const db = await connect();
  try {
    await seed(db);
    assertEquals(names((await search("zebra")).projects), [
      "Zebra мой закрытый проект",
      "Zebra открытый проект",
    ]);
    assertEquals(names((await search("zebra", COLLEAGUE)).projects), [
      "Zebra закрытый проект",
      "Zebra открытый проект",
    ]);
  } finally {
    await db.end();
  }
});

Deno.test("подсказки: записи — чужая личная, архив, чужой воркспейс и несогласованная встреча не попадают", async () => {
  const db = await connect();
  try {
    await seed(db);
    const body = await search("zebra");
    assertEquals(names(body.notes), ["Zebra моя личная заметка", "Zebra общая заметка"]);
    assertEquals(names(body.meetings), ["Zebra встреча по названию", "Zebra согласованная встреча"]);
    // Коллега видит свою личную, но не мою.
    const theirs = await search("zebra", COLLEAGUE);
    assert(names(theirs.notes).includes("Zebra личная заметка коллеги"));
    assert(!names(theirs.notes).includes("Zebra моя личная заметка"), "личная запись видна не владельцу");
    assert(names(theirs.meetings).includes("Zebra личная встреча коллеги"));
  } finally {
    await db.end();
  }
});

Deno.test("подсказки: % и _ в запросе — обычные символы, а не подстановки", async () => {
  const db = await connect();
  try {
    await seed(db);
    assertEquals(names((await search("100%")).tasks), ["Скидка 100% на zebra"]);
    assertEquals(names((await search("zebra_")).tasks), ["Zebra_подчёркивание"]);
  } finally {
    await db.end();
  }
});

Deno.test("подсказки: короче двух символов — пусто без обращения к базе", async () => {
  const body = await search("z");
  assertEquals([body.tasks, body.projects, body.meetings, body.notes], [[], [], [], []]);
});
