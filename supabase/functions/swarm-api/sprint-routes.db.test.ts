// Гварды роутов спринтов — на настоящем обработчике и настоящей базе.
//
// Почему не мок: здесь проверяется не логика, а РЕШЕНИЕ О ДОСТУПЕ и код ответа. Мок клиента
// базы проверил бы мою же модель запроса; ошибка в гварде выглядит как работающий продукт и
// вылезает утечкой. Поэтому запрос идёт через тот же handleSprintCycleRoutes, что в проде.
//
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Доступы берутся из окружения и никогда не зашиваются в файл: ключ в репозитории — это
// ключ, который однажды окажется не от локального контура. Значения даёт сам контур:
//   eval "$(supabase status -o env | sed 's/^/export /')"
// или проще — прогон через scripts/check, он подставляет их сам.
for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!Deno.env.get(name)) {
    throw new Error(
      `Не задана переменная ${name}. Подними локальный контур (supabase start) и прогоняй ` +
        `через ./scripts/check — он подставит доступы. Пропустить этот тест нельзя: ` +
        `непроверенный гвард выглядит как проверенный.`,
    );
  }
}

// Импорт динамический: клиент базы создаётся на уровне модуля, и переменные обязаны стоять
// раньше него.
const { handleSprintCycleRoutes } = await import("./sprint-cycles.ts");

const WS = "t_routes";
const OTHER_WS = "t_routes_other";
const ME = 111;
const SOMEONE_ELSE = 222;

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

async function seed(db: Client) {
  // Порядок удаления — от зависимых строк к тем, на кого они ссылаются: задачи держат
  // владельца (tasks.owner_id → allowed_users), пользователи держат воркспейс. Наоборот
  // база не даст, и тест упадёт на уборке, а не на деле.
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from sprint_cycles where group_id = ${ws}`;
    await db.queryArray`delete from tasks where group_id = ${ws}`;
    await db.queryArray`delete from projects where group_id = ${ws}`;
    await db.queryArray`delete from sprints where group_id = ${ws}`;
  }
  await db
    .queryArray`delete from allowed_users where telegram_id in (${ME}, ${SOMEONE_ELSE})`;
  for (const ws of [WS, OTHER_WS]) {
    await db.queryArray`delete from workspaces where id = ${ws}`;
    await db
      .queryArray`insert into workspaces (id, name) values (${ws}, ${ws})`;
  }

  // Владелец приватной задачи — настоящая строка в allowed_users: у tasks.owner_id внешний
  // ключ туда, и без неё проверка приватности не доходит до дела.
  for (const person of [ME, SOMEONE_ELSE]) {
    await db.queryArray`
      insert into allowed_users (telegram_id, username, added_by, group_id)
      values (${person}, ${"u" + person}, 0, ${WS})`;
  }

  const tab = await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status, kind)
    values (gen_random_uuid(), ${WS}, 'Пространство', current_date, current_date + 30, 'active', 'space')
    returning id`;
  const foreignTab = await db.queryObject<{ id: string }>`
    insert into sprints (id, group_id, name, start_date, end_date, status, kind)
    values (gen_random_uuid(), ${OTHER_WS}, 'Чужое', current_date, current_date + 30, 'active', 'space')
    returning id`;
  return { tabId: tab.rows[0].id, foreignTabId: foreignTab.rows[0].id };
}

function call(
  method: string,
  path: string,
  opts: { body?: unknown; admin?: boolean; as?: number } = {},
) {
  const req = new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const routePath = path.split("?")[0];
  return handleSprintCycleRoutes(
    req,
    routePath,
    opts.as ?? ME,
    WS,
    opts.admin ?? false,
    "https://web.test",
  );
}

Deno.test("вкладка чужого воркспейса — отказ 400, а не спринт в чужом пространстве", async () => {
  const db = await connect();
  try {
    const { foreignTabId } = await seed(db);
    const res = await call("POST", "/sprint-cycles", {
      body: {
        name: "Спринт 1",
        start_date: "2026-09-01",
        end_date: "2026-09-14",
        tab_id: foreignTabId,
      },
    });
    assertEquals(res?.status, 400);
  } finally {
    await db.end();
  }
});

Deno.test("вкладка доски «Проекты» — не пространство: спринт на ней не заводится и туда не переносится", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    // Таблица `sprints` держит обе сущности (issue #423). Спринт на вкладке проектов в разделе
    // «Спринты» не виден вовсе — так было в демо-данных до 24.09.2026.
    const board = await db.queryObject<{ id: string }>`
      insert into sprints (id, group_id, name, start_date, end_date, status, kind)
      values (gen_random_uuid(), ${WS}, 'Доска', current_date, current_date + 30, 'active', 'board_tab')
      returning id`;
    const boardTabId = board.rows[0].id;
    const onBoard = await call("POST", "/sprint-cycles", {
      body: {
        name: "Спринт на доске",
        start_date: "2026-09-01",
        end_date: "2026-09-14",
        tab_id: boardTabId,
      },
    });
    assertEquals(onBoard?.status, 400);

    const created = await call("POST", "/sprint-cycles", {
      body: {
        name: "Спринт 1",
        start_date: "2026-09-01",
        end_date: "2026-09-14",
        tab_id: tabId,
      },
    });
    const { id } = await created!.json();
    const moved = await call("PATCH", `/sprint-cycles/${id}`, {
      body: { tab_id: boardTabId },
    });
    assertEquals(moved?.status, 404);
  } finally {
    await db.end();
  }
});

Deno.test("второй незакрытый спринт в пространстве — 409 с человеческой причиной", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const body = {
      name: "Спринт 1",
      start_date: "2026-09-01",
      end_date: "2026-09-14",
      tab_id: tabId,
    };
    assertEquals((await call("POST", "/sprint-cycles", { body }))?.status, 201);

    const second = await call("POST", "/sprint-cycles", {
      body: { ...body, name: "Спринт 1-бис" },
    });
    assertEquals(second?.status, 409);
    const text = await second!.text();
    assertEquals(
      text.includes("незакрытый спринт"),
      true,
      `отказ должен объяснять причину, а пришло: ${text}`,
    );
  } finally {
    await db.end();
  }
});

Deno.test("спринт переносится в другое пространство, чужое — 404", async () => {
  // Перенос — про ВИДИМОСТЬ: уехав в чужой воркспейс, спринт остался бы в базе, но пропал
  // бы с экрана команды, и это выглядело бы как потеря данных.
  const db = await connect();
  try {
    const { tabId, foreignTabId } = await seed(db);
    const second = await db.queryObject<{ id: string }>`
      insert into sprints (id, group_id, name, start_date, end_date, status, kind)
      values (gen_random_uuid(), ${WS}, 'Второе пространство', current_date, current_date + 30, 'active', 'space')
      returning id`;
    const otherTab = second.rows[0].id;

    const created = await call("POST", "/sprint-cycles", {
      body: {
        name: "Спринт 1",
        start_date: "2026-09-01",
        end_date: "2026-09-14",
        tab_id: tabId,
      },
    });
    assertEquals(created?.status, 201);
    const id = (await created!.json()).id as string;

    const moved = await call("PATCH", `/sprint-cycles/${id}`, {
      body: { tab_id: otherTab },
    });
    assertEquals(moved?.status, 200);
    assertEquals((await moved!.json()).tab_id, otherTab);

    const foreign = await call("PATCH", `/sprint-cycles/${id}`, {
      body: { tab_id: foreignTabId },
    });
    assertEquals(foreign?.status, 404, "чужое пространство принимать нельзя");
    const stayed = await db.queryObject<{ tab_id: string }>`
      select tab_id from sprint_cycles where id = ${id}::uuid`;
    assertEquals(
      stayed.rows[0].tab_id,
      otherTab,
      "отказ не должен ничего менять",
    );
  } finally {
    await db.end();
  }
});

Deno.test("перенос в занятое пространство — 409, спринт остаётся на месте", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const second = await db.queryObject<{ id: string }>`
      insert into sprints (id, group_id, name, start_date, end_date, status, kind)
      values (gen_random_uuid(), ${WS}, 'Занятое', current_date, current_date + 30, 'active', 'space')
      returning id`;
    const busyTab = second.rows[0].id;

    const a = await call("POST", "/sprint-cycles", {
      body: {
        name: "Спринт A",
        start_date: "2026-09-01",
        end_date: "2026-09-14",
        tab_id: tabId,
      },
    });
    const b = await call("POST", "/sprint-cycles", {
      body: {
        name: "Спринт B",
        start_date: "2026-09-01",
        end_date: "2026-09-14",
        tab_id: busyTab,
      },
    });
    assertEquals(a?.status, 201);
    assertEquals(b?.status, 201);
    const idA = (await a!.json()).id as string;

    const clash = await call("PATCH", `/sprint-cycles/${idA}`, {
      body: { tab_id: busyTab },
    });
    assertEquals(clash?.status, 409);
    const text = await clash!.text();
    assertEquals(
      text.includes("незакрытый спринт"),
      true,
      `отказ должен объяснять причину, а пришло: ${text}`,
    );
  } finally {
    await db.end();
  }
});

Deno.test("день сверки ставится сам — на шестой день от старта", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const res = await call("POST", "/sprint-cycles", {
      body: {
        name: "Спринт 1",
        start_date: "2026-09-01",
        end_date: "2026-09-14",
        tab_id: tabId,
      },
    });
    const cycle = await res!.json();
    assertEquals(cycle.check_date, "2026-09-07");
    assertEquals(cycle.tab_id, tabId);
  } finally {
    await db.end();
  }
});

Deno.test("спринт создаёт и стартует любой участник, а удаляет только админ", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const created = await call("POST", "/sprint-cycles", {
      body: {
        name: "Спринт 1",
        start_date: "2026-09-01",
        end_date: "2026-09-14",
        tab_id: tabId,
      },
    });
    assertEquals(created?.status, 201, "создание больше не требует админа");
    const { id } = await created!.json();

    assertEquals(
      (await call("POST", `/sprint-cycles/${id}/start`))?.status,
      200,
      "старт спринта больше не требует админа",
    );
    assertEquals(
      (await call("DELETE", `/sprint-cycles/${id}`))?.status,
      403,
      "удаление спринта осталось за админом: оно необратимо",
    );
    assertEquals(
      (await call("DELETE", `/sprint-cycles/${id}`, { admin: true }))?.status,
      204,
    );
  } finally {
    await db.end();
  }
});

Deno.test("чужая приватная задача видна строкой, но без содержимого", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const project = await db.queryObject<{ id: string }>`
      insert into projects (group_id, name) values (${WS}, 'Инициатива') returning id`;
    const task = await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, is_private, owner_id, created_by)
      values ('Личное дело', 'open', ${WS}, ${
      project.rows[0].id
    }, true, ${SOMEONE_ELSE}, 'test')
      returning id`;
    const cycle = await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'Спринт 1', current_date, current_date + 13, 'active')
      returning id`;
    // Задача попала в состав до того, как её сделали приватной: добавление приватной задачи
    // в спринт и так отбивается, а вот смена признака после добавления — отдельный путь,
    // и правило видимости обязано работать и на нём.
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan)
      values (${cycle.rows[0].id}, ${task.rows[0].id}, true)`;

    const mine =
      await (await call("GET", `/sprint-cycles/${cycle.rows[0].id}`))!
        .json();
    assertEquals(
      mine.items.length,
      1,
      "строка состава должна остаться: иначе цифры разъедутся",
    );
    assertEquals(mine.items[0].hidden, true);
    assertEquals(mine.items[0].title, "Приватная задача");
    assertEquals(mine.items[0].assignees, []);
    assertEquals(
      mine.items[0].task_id,
      null,
      "по id чужую приватную задачу не открыть",
    );

    const owner =
      await (await call("GET", `/sprint-cycles/${cycle.rows[0].id}`, {
        as: SOMEONE_ELSE,
      }))!.json();
    assertEquals(owner.items[0].hidden, false, "владелец видит свою задачу");
    assertEquals(owner.items[0].title, "Личное дело");

    const admin =
      await (await call("GET", `/sprint-cycles/${cycle.rows[0].id}`, {
        admin: true,
      }))!.json();
    assertEquals(
      admin.items[0].hidden,
      true,
      "админ приватную задачу не открывает: решение владельца 07.08.2026",
    );
  } finally {
    await db.end();
  }
});

Deno.test("отметка сверки сохраняется, а на принятом спринте — 409", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const task = await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, created_by)
      values ('Задача', 'open', ${WS}, 'test') returning id`;
    const cycle = await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'Спринт 1', current_date - 13, current_date, 'active')
      returning id`;
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan)
      values (${cycle.rows[0].id}, ${task.rows[0].id}, true)`;
    const path = `/sprint-cycles/${cycle.rows[0].id}/tasks/${task.rows[0].id}`;

    const marked = await call("PATCH", path, {
      body: { check_status: "risk", check_note: "ждём смежников" },
    });
    assertEquals(marked?.status, 200);
    const item = await marked!.json();
    assertEquals(item.check_status, "risk");
    assertEquals(item.check_note, "ждём смежников");
    assertEquals(
      typeof item.check_at,
      "string",
      "время отметки должно записаться",
    );
    assertEquals(item.check_by, String(ME));

    assertEquals(
      (await call("PATCH", path, { body: { check_status: "лучше всех" } }))
        ?.status,
      400,
      "неизвестная отметка не должна тихо ложиться в базу",
    );

    await db
      .queryArray`update sprint_cycles set status = 'accepted' where id = ${
      cycle.rows[0].id
    }`;
    assertEquals(
      (await call("PATCH", path, { body: { check_status: "ok" } }))?.status,
      409,
      "принятый спринт — снимок, отметки в нём не меняются",
    );
  } finally {
    await db.end();
  }
});

Deno.test("снятая пометка «к переносу» уносит с собой причину", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const task = await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, created_by)
      values ('Задача', 'open', ${WS}, 'test') returning id`;
    const cycle = await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'Спринт 1', current_date - 13, current_date, 'active')
      returning id`;
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan)
      values (${cycle.rows[0].id}, ${task.rows[0].id}, true)`;
    const path = `/sprint-cycles/${cycle.rows[0].id}/tasks/${task.rows[0].id}`;

    const on = await (await call("PATCH", path, {
      body: { to_carry: true, carry_reason: "не успеваем по смежникам" },
    }))!.json();
    assertEquals(on.to_carry, true);
    assertEquals(on.carry_reason, "не успеваем по смежникам");

    const off =
      await (await call("PATCH", path, { body: { to_carry: false } }))!
        .json();
    assertEquals(off.to_carry, false);
    assertEquals(
      off.carry_reason,
      null,
      "причина без пометки всплыла бы в следующем спринте как чужое объяснение",
    );
  } finally {
    await db.end();
  }
});

Deno.test("список спринтов фильтруется по пространству, без параметра — все", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    await db.queryArray`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'В пространстве', current_date, current_date + 13, 'active')`;
    await db.queryArray`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, null, 'Без вкладки', current_date, current_date + 13, 'active')`;

    const all = await (await call("GET", "/sprint-cycles"))!.json();
    assertEquals(
      all.length,
      2,
      "без параметра список не должен сузиться — так ходит старый веб",
    );

    const inTab = await (await call("GET", `/sprint-cycles?tab_id=${tabId}`))!
      .json();
    assertEquals(inTab.map((c: { name: string }) => c.name), [
      "В пространстве",
    ]);

    const orphans = await (await call("GET", "/sprint-cycles?tab_id=none"))!
      .json();
    assertEquals(orphans.map((c: { name: string }) => c.name), ["Без вкладки"]);
  } finally {
    await db.end();
  }
});
