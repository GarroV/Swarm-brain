// Публичная дорожная карта (issue #562) — на настоящем обработчике и настоящей базе.
//
// Почему не мок: здесь проверяется то, что уходит НАРУЖУ без авторизации. Мок клиента базы
// проверил бы мою же модель запроса; забытый фильтр или лишняя колонка выглядят как работающий
// продукт и вылезают утечкой. Поэтому запрос идёт через тот же handlePublicRoadmap, что в проде,
// а в базе лежат строки со всеми закрытыми полями заполненными.
//
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";
import { createClient } from "@supabase/supabase-js";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) {
    throw new Error(
      `Не задана переменная ${name}. Подними локальный контур (supabase start) и прогоняй ` +
        `через ./scripts/with-local-db — он подставит доступы. Пропустить этот тест нельзя: ` +
        `непроверенная публичная выдача выглядит как проверенная.`,
    );
  }
}

const { handlePublicRoadmap } = await import("./public-roadmap.ts");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const WS = "t_public_roadmap";
const BOARD = "7e570000-0000-4000-8000-000000000001";
const UNPUBLISHED = "7e570000-0000-4000-8000-000000000002";
const ARCHIVED_BOARD = "7e570000-0000-4000-8000-000000000003";
const PRIVATE_BOARD = "7e570000-0000-4000-8000-000000000004";
const SUB_A = "7e570000-0000-4000-8000-00000000000a";
const SUB_B = "7e570000-0000-4000-8000-00000000000b";
const SUB_PRIVATE = "7e570000-0000-4000-8000-00000000000c";
const SUB_ARCHIVED = "7e570000-0000-4000-8000-00000000000d";
const MISSING = "7e570000-0000-4000-8000-0000000000ff";

// Закрытые значения, которые обязаны остаться в базе. Каждое уникально, чтобы поиск по тексту
// ответа не давал ложных совпадений.
const SECRETS = {
  description: "ЗАКРЫТОЕ-ОПИСАНИЕ-42",
  assignee: "Исполнитель-Секретный",
  country: "Страна-Секретная",
  comment: "ЗАКРЫТЫЙ-КОММЕНТАРИЙ-42",
  tag: "метка-секретная",
};

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

async function cleanup(db: Client) {
  await db
    .queryArray`delete from task_comments where task_id in (select id from tasks where group_id = ${WS})`;
  await db.queryArray`delete from tasks where group_id = ${WS}`;
  await db
    .queryArray`update projects set parent_id = null where group_id = ${WS}`;
  await db.queryArray`delete from projects where group_id = ${WS}`;
  await db.queryArray`delete from workspaces where id = ${WS}`;
}

async function seed(db: Client) {
  await cleanup(db);
  await db.queryArray`insert into workspaces (id, name) values (${WS}, ${WS})`;
  await db.queryArray`
    insert into projects (id, group_id, name, public_roadmap, archived_at, parent_id, position, description) values
      (${BOARD},          ${WS}, 'Доска',          true,  null,  null,       null, ${SECRETS.description}),
      (${UNPUBLISHED},    ${WS}, 'Неопубликована', false, null,  null,       null, null),
      (${ARCHIVED_BOARD}, ${WS}, 'Архивная',       true,  now(), null,       null, null)`;
  // Личная доска с флагом публикации: флаг приватность не снимает.
  await db.queryArray`
    insert into projects (id, group_id, name, public_roadmap, is_private) values
      (${PRIVATE_BOARD}, ${WS}, 'Личная доска', true, true)`;
  await db.queryArray`
    insert into projects (id, group_id, name, parent_id, position, is_private, archived_at) values
      (${SUB_B},        ${WS}, 'Второй',   ${BOARD}, 2000, false, null),
      (${SUB_A},        ${WS}, 'Первый',   ${BOARD}, 1000, false, null),
      (${SUB_PRIVATE},  ${WS}, 'Личный',   ${BOARD}, 500,  true,  null),
      (${SUB_ARCHIVED}, ${WS}, 'В архиве', ${BOARD}, 600,  false, now())`;

  const t = (
    title: string,
    project: string,
    status: string,
    extra: {
      due?: string;
      completedDaysAgo?: number;
      hidden?: boolean;
      isPrivate?: boolean;
      confirmed?: boolean;
      archived?: boolean;
    } = {},
  ) =>
    db.queryArray`
      insert into tasks (title, project_id, group_id, status, due_date, completed_at, hidden_from_hub,
                         is_private, confirmed, archived_at, description, assignees, country, tags)
      values (${title}, ${project}, ${WS}, ${status}, ${extra.due ?? null},
              ${
      extra.completedDaysAgo === undefined
        ? null
        : new Date(Date.now() - extra.completedDaysAgo * 86_400_000)
    },
              ${extra.hidden ?? false}, ${extra.isPrivate ?? false}, ${
      extra.confirmed ?? true
    },
              ${extra.archived ? new Date() : null},
              ${SECRETS.description}, ${[
      SECRETS.assignee,
    ]}, ${SECRETS.country}, ${[SECRETS.tag]})`;

  await t("A: в работе", SUB_A, "in_progress", { due: "2026-12-01" });
  await t("A: план", SUB_A, "open", { due: "2026-10-06" });
  await t("A: бэклог", SUB_A, "backlog");
  await t("A: выкачено", SUB_A, "done", { completedDaysAgo: 2 });
  await t("A: выкачено давно", SUB_A, "done", { completedDaysAgo: 45 });
  await t("A: отменено", SUB_A, "cancelled", { completedDaysAgo: 1 });
  await t("A: скрыто", SUB_A, "open", { hidden: true });
  await t("A: личное", SUB_A, "open", { isPrivate: true });
  await t("A: на проверке", SUB_A, "open", { confirmed: false });
  await t("A: в архиве", SUB_A, "open", { archived: true });
  await t("Личный подпроект: задача", SUB_PRIVATE, "open");
  await t("Архивный подпроект: задача", SUB_ARCHIVED, "open");
  await t("Неопубликованная: задача", UNPUBLISHED, "open");
  await db.queryArray`
    insert into task_comments (task_id, content, added_by)
    select id, ${SECRETS.comment}, 'test' from tasks where group_id = ${WS}`;
}

const get = (id: string, method = "GET") =>
  handlePublicRoadmap(
    supabase,
    new Request(`http://x/functions/v1/swarm-api/public/roadmap/${id}`, {
      method,
    }),
    `/public/roadmap/${id}`,
  );

Deno.test({
  name: "публичная дорожная карта на настоящей базе",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const db = await connect();
    try {
      await seed(db);

      await t.step(
        "404 одинаковый для неопубликованной, личной, архивной, несуществующей доски и мусора",
        async () => {
          for (
            const id of [
              UNPUBLISHED,
              PRIVATE_BOARD,
              ARCHIVED_BOARD,
              MISSING,
              "not-a-uuid",
              SUB_A,
            ]
          ) {
            const res = await get(id);
            assertEquals(res.status, 404, `доска ${id} должна быть 404`);
            assertEquals(await res.json(), { error: "not_found" });
            assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
          }
        },
      );

      const res = await get(BOARD);
      const text = await res.text();
      const body = JSON.parse(text);

      await t.step("200, CORS *, публичный кэш на 5 минут", () => {
        assertEquals(res.status, 200, text);
        assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
        assertEquals(res.headers.get("Cache-Control"), "public, max-age=300");
        assertEquals(body.board, "Доска");
      });

      await t.step(
        "закрытые поля не уходят: описание, исполнитель, страна, метки, комментарии, id задач",
        () => {
          for (const [what, secret] of Object.entries(SECRETS)) {
            assert(
              !text.includes(secret),
              `в публичный ответ утекло поле «${what}»: ${text}`,
            );
          }
          for (
            const key of [
              "description",
              "assignee",
              "country",
              "tags",
              "comments",
              "telegram",
              "group_id",
            ]
          ) {
            assert(
              !text.includes(`"${key}`),
              `в ответе ключ «${key}»: ${text}`,
            );
          }
          for (const p of body.projects) {
            assertEquals(Object.keys(p).sort(), ["id", "items", "name"]);
            for (const i of p.items) {
              assertEquals(Object.keys(i).sort(), [
                "due",
                "shipped_at",
                "state",
                "title",
              ]);
            }
          }
        },
      );

      await t.step(
        "проекты: только живые публичные подпроекты, в порядке доски; у доски своих задач нет — её нет",
        () => {
          assertEquals(body.projects.map((p: { name: string }) => p.name), [
            "Первый",
            "Второй",
          ]);
          assertEquals(body.projects[1].items, []);
        },
      );

      await t.step(
        "пункты: cancelled, скрытые, личные, неподтверждённые, архивные и done старше 30 дней не попадают",
        () => {
          const a = body.projects[0].items as Array<
            {
              title: string;
              state: string;
              due: string | null;
              shipped_at: string | null;
            }
          >;
          assertEquals(a.map((i) => [i.title, i.state]), [
            ["A: в работе", "in_progress"],
            ["A: план", "planned"],
            ["A: бэклог", "planned"],
            ["A: выкачено", "shipped"],
          ]);
          assertEquals(a[1].due, "2026-10-06");
          assert(
            /^\d{4}-\d{2}-\d{2}$/.test(a[3].shipped_at ?? ""),
            `shipped_at: ${a[3].shipped_at}`,
          );
        },
      );

      await t.step(
        "только GET/OPTIONS: POST — 405, OPTIONS — 204 с CORS",
        async () => {
          assertEquals((await get(BOARD, "POST")).status, 405);
          const pre = await get(BOARD, "OPTIONS");
          assertEquals(pre.status, 204);
          assertEquals(pre.headers.get("Access-Control-Allow-Origin"), "*");
        },
      );
    } finally {
      await cleanup(db);
      await db.end();
    }
  },
});
