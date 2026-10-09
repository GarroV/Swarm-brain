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
  // Порядок удаления — от зависимых строк к тем, на кого они ссылаются: пользователи держат
  // воркспейс. Наоборот база не даст, и тест упадёт на уборке, а не на деле.
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

  // Участники воркспейса — настоящие строки в allowed_users.
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

Deno.test("будущие спринты заводятся заранее, а второй идущий — 409 с человеческой причиной", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const body = {
      name: "Спринт 1",
      start_date: "2026-09-01",
      end_date: "2026-09-14",
      tab_id: tabId,
    };
    const first = await call("POST", "/sprint-cycles", { body });
    assertEquals(first?.status, 201);
    const future = await call("POST", "/sprint-cycles", {
      body: {
        ...body,
        name: "Спринт 2",
        start_date: "2026-09-15",
        end_date: "2026-09-28",
      },
    });
    assertEquals(
      future?.status,
      201,
      "запланированный спринт обязан создаваться рядом с текущим",
    );

    const idFirst = (await first!.json()).id as string;
    const idFuture = (await future!.json()).id as string;
    assertEquals(
      (await call("POST", `/sprint-cycles/${idFirst}/start`))?.status,
      200,
    );
    const second = await call("POST", `/sprint-cycles/${idFuture}/start`);
    assertEquals(second?.status, 409);
    const text = await second!.text();
    assertEquals(
      text.includes("уже идёт спринт"),
      true,
      `отказ должен объяснять причину, а пришло: ${text}`,
    );
    // Отказ ничего не трогает: будущий остался в планировании.
    const st = await db.queryObject<{ status: string }>`
      select status from sprint_cycles where id = ${idFuture}::uuid`;
    assertEquals(st.rows[0].status, "draft");
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
    const idB = (await b!.json()).id as string;
    // Занято — значит, там ИДЁТ спринт: запланированных может быть сколько угодно.
    assertEquals(
      (await call("POST", `/sprint-cycles/${idA}/start`))?.status,
      200,
    );
    assertEquals(
      (await call("POST", `/sprint-cycles/${idB}/start`))?.status,
      200,
    );

    const clash = await call("PATCH", `/sprint-cycles/${idA}`, {
      body: { tab_id: busyTab },
    });
    assertEquals(clash?.status, 409);
    const text = await clash!.text();
    assertEquals(
      text.includes("уже идёт спринт"),
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

// «Личных» задач нет (решение 2026-10-09): состав спринта одинаков для всех участников.
Deno.test("задача коллеги в составе видна целиком", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const project = await db.queryObject<{ id: string }>`
      insert into projects (group_id, name) values (${WS}, 'Инициатива') returning id`;
    const task = await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, project_id, created_by, created_by_telegram_id)
      values ('Дело коллеги', 'open', ${WS}, ${project.rows[0].id}, 'test', ${SOMEONE_ELSE})
      returning id`;
    const cycle = await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'Спринт 1', current_date, current_date + 13, 'active')
      returning id`;
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan)
      values (${cycle.rows[0].id}, ${task.rows[0].id}, true)`;

    const mine = await (await call("GET", `/sprint-cycles/${cycle.rows[0].id}`))!
      .json();
    assertEquals(mine.items.length, 1);
    assertEquals(mine.items[0].title, "Дело коллеги");
    assertEquals(mine.items[0].task_id, task.rows[0].id);
    assertEquals(
      "hidden" in mine.items[0],
      false,
      "поля скрытости в ответе больше нет",
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
      .queryArray`update sprint_cycles set status = 'accepted' where id = ${cycle.rows[0].id}`;
    assertEquals(
      (await call("PATCH", path, { body: { check_status: "ok" } }))?.status,
      409,
      "принятый спринт — снимок, отметки в нём не меняются",
    );
  } finally {
    await db.end();
  }
});

Deno.test("сроки идущего спринта сдвигаются, принятого — 409 (#297)", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const cycle = await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'Спринт 1', '2026-09-01', '2026-09-14', 'active')
      returning id`;
    const path = `/sprint-cycles/${cycle.rows[0].id}`;
    const moved = await call("PATCH", path, {
      body: { start_date: "2026-09-02", end_date: "2026-09-16" },
    });
    assertEquals(moved?.status, 200);
    assertEquals((await moved!.json()).end_date, "2026-09-16");

    await db
      .queryArray`update sprint_cycles set status = 'accepted' where id = ${cycle.rows[0].id}`;
    assertEquals(
      (await call("PATCH", path, { body: { end_date: "2026-09-20" } }))?.status,
      409,
      "сроки принятого спринта — история, задним числом не сдвигаются",
    );
    assertEquals(
      (await call("PATCH", path, { body: { summary: "итог" } }))?.status,
      200,
      "итог принятого спринта править можно",
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

    const off = await (await call("PATCH", path, { body: { to_carry: false } }))!
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

// #576: снятие задачи из идущего спринта не должно поднимать процент. Раньше DELETE удалял
// строку состава, и плановая задача уходила из знаменателя бесследно.
Deno.test("снятая из идущего спринта плановая задача остаётся в плане невыполненной", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const mk = async (title: string, status: string) =>
      (await db.queryObject<{ id: string }>`
        insert into tasks (title, status, group_id, created_by)
        values (${title}, ${status}, ${WS}, 'test') returning id`).rows[0].id;
    const done = await mk("Сделана", "done");
    const lagging = await mk("Отстаёт", "open");
    const cycle = (await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'Спринт 1 · 01.09 — 14.09', current_date - 13, current_date, 'active')
      returning id`).rows[0].id;
    for (const t of [done, lagging]) {
      await db.queryArray`
        insert into sprint_items (cycle_id, task_id, in_plan) values (${cycle}, ${t}, true)`;
    }

    assertEquals(
      (await call("DELETE", `/sprint-cycles/${cycle}/tasks/${lagging}`))
        ?.status,
      204,
    );
    const detail = await (await call("GET", `/sprint-cycles/${cycle}`))!.json();
    assertEquals(detail.items.map((i: { title: string }) => i.title), [
      "Сделана",
    ]);
    assertEquals(
      detail.withdrawn.map((i: { title: string; in_plan: boolean }) => [
        i.title,
        i.in_plan,
      ]),
      [["Отстаёт", true]],
      "снятая строка должна остаться следом, а не исчезнуть",
    );
    const row = await db.queryObject<{ withdrawn_by: string | null }>`
      select withdrawn_by from sprint_items where cycle_id = ${cycle} and task_id = ${lagging}`;
    assertEquals(row.rows[0].withdrawn_by, String(ME));

    // Отметка на снятой строке не ставится: из спринта она ушла.
    assertEquals(
      (await call("PATCH", `/sprint-cycles/${cycle}/tasks/${lagging}`, {
        body: { check_status: "ok" },
      }))?.status,
      404,
    );

    const accepted = await call("POST", `/sprint-cycles/${cycle}/accept`, {
      body: {},
    });
    assertEquals(accepted?.status, 200);
    const result = await accepted!.json();
    assertEquals(
      [
        result.cycle.stats.plan,
        result.cycle.stats.planDone,
        result.cycle.stats.planPercent,
        result.cycle.stats.withdrawn,
      ],
      [2, 1, 50, 1],
      "процент считается от плана старта: снятая — невыполненная, а не исчезнувшая",
    );
    assertEquals(result.carried, 0, "снятая задача в следующий спринт не едет");
  } finally {
    await db.end();
  }
});

Deno.test("снять и вернуть в идущий спринт — задача остаётся плановой", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const task = (await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, created_by)
      values ('Задача', 'open', ${WS}, 'test') returning id`).rows[0].id;
    const cycle = (await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'Спринт 1', current_date - 13, current_date, 'active')
      returning id`).rows[0].id;
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan, carry_count)
      values (${cycle}, ${task}, true, 2)`;

    await call("DELETE", `/sprint-cycles/${cycle}/tasks/${task}`);
    const back = await call("POST", `/sprint-cycles/${cycle}/tasks`, {
      body: { task_ids: [task] },
    });
    assertEquals((await back!.json()).added, 1);

    const detail = await (await call("GET", `/sprint-cycles/${cycle}`))!.json();
    assertEquals(detail.withdrawn, []);
    assertEquals(
      detail.items.map((i: { in_plan: boolean; carry_count: number }) => [
        i.in_plan,
        i.carry_count,
      ]),
      [[true, 2]],
      "возврат — та же строка: план и счётчик переносов на месте",
    );
  } finally {
    await db.end();
  }
});

Deno.test("в черновике убранная задача удаляется — план ещё не зафиксирован", async () => {
  const db = await connect();
  try {
    const { tabId } = await seed(db);
    const task = (await db.queryObject<{ id: string }>`
      insert into tasks (title, status, group_id, created_by)
      values ('Задача', 'open', ${WS}, 'test') returning id`).rows[0].id;
    const cycle = (await db.queryObject<{ id: string }>`
      insert into sprint_cycles (group_id, tab_id, name, start_date, end_date, status)
      values (${WS}, ${tabId}, 'Спринт 1', current_date, current_date + 13, 'draft')
      returning id`).rows[0].id;
    await db.queryArray`
      insert into sprint_items (cycle_id, task_id, in_plan) values (${cycle}, ${task}, true)`;

    assertEquals(
      (await call("DELETE", `/sprint-cycles/${cycle}/tasks/${task}`))?.status,
      204,
    );
    const left = await db.queryObject<{ n: bigint }>`
      select count(*) as n from sprint_items where cycle_id = ${cycle}`;
    assertEquals(Number(left.rows[0].n), 0);
  } finally {
    await db.end();
  }
});
