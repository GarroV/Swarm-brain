// Определения инструментов MCP — только данные, без обработчиков и клиента базы: тест аннотаций и tools/list
// грузят их, не втягивая в покрытие модули с логикой. Обработчики — в sprints.ts.

// ── Определения ───────────────────────────────────────────────────────────────

const ME = {
  type: "number",
  description: "Твой Telegram user ID — обязателен для проверки доступа",
};
const SPRINT_ID = {
  type: "string",
  description: "id спринта из get_sprints / get_sprint_spaces",
};
const SPACE = {
  type: "string",
  description:
    "Пространство спринтов: имя или id из get_sprint_spaces. Вкладки доски «Проекты» сюда не подходят — это другая сущность.",
};
const DATE = (what: string) => ({
  type: "string",
  description: `${what}, YYYY-MM-DD. Год — от текущей даты, не из головы`,
});

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { ...properties, requesting_user_id: ME },
      required: [...required, "requesting_user_id"],
    },
  };
}

export const SPRINT_TOOL_DEFINITIONS = [
  tool(
    "get_sprint_spaces",
    "Пространства раздела «Спринты» (НЕ вкладки доски «Проекты»): id, живой спринт, сколько принято. Вызывай первым — имена пространств угадать нельзя.",
    {},
  ),
  tool(
    "create_sprint_space",
    "Создать пространство спринтов. Может любой участник.",
    {
      name: { type: "string", description: "Имя пространства" },
    },
    ["name"],
  ),
  tool(
    "create_sprint_group",
    "Создать группу задач (инициативу) в пространстве спринтов — как «+ Группа» в вебе. Задачи в неё кладутся add_task с project_name = имя группы. Может любой участник.",
    {
      space: SPACE,
      name: { type: "string", description: "Имя группы" },
    },
    ["space", "name"],
  ),
  tool(
    "rename_sprint_space",
    "Переименовать пространство спринтов. Только админ.",
    {
      space: SPACE,
      name: { type: "string", description: "Новое имя" },
    },
    ["space", "name"],
  ),
  tool(
    "archive_sprint_space",
    "Убрать пространство спринтов в архив (не удаление: спринты и состав сохраняются). Только админ.",
    { space: SPACE },
    ["space"],
  ),
  tool(
    "get_sprints",
    "Спринты: по пространству или все. По умолчанию без принятых.",
    {
      space: SPACE,
      include_accepted: {
        type: "boolean",
        description: "true — показать и принятые (архив периодов)",
      },
    },
  ),
  tool(
    "get_sprint_journal",
    "Журнал пространства спринтов: правки и комментарии задач его спринтов, состав, сверка, старт и приёмка — новые сверху. Отвечает на «что было за неделю по спринту».",
    {
      space: SPACE,
      days: {
        type: "string",
        enum: ["1", "3", "7", "all"],
        description: "Период в днях или all; по умолчанию 7",
      },
    },
    ["space"],
  ),
  tool(
    "get_sprint",
    "Спринт целиком: этап, даты, план/факт, сверка и состав по проектам с task_id.",
    { sprint_id: SPRINT_ID },
    ["sprint_id"],
  ),
  tool(
    "create_sprint",
    "Создать спринт в пространстве (этап «планирование»). Будущие спринты можно заводить заранее, сколько угодно; идёт один — старт второго отказ, пока идущий не принят.",
    {
      space: SPACE,
      name: {
        type: "string",
        description: "Имя спринта, например «Спринт 24.09 — 07.10»",
      },
      start_date: DATE("Старт"),
      end_date: DATE("Финал (приёмка)"),
      check_date: DATE("Чекпоинт-сверка; по умолчанию шестой день от старта"),
    },
    ["space", "name", "start_date", "end_date"],
  ),
  tool(
    "update_sprint",
    "Изменить спринт: имя, даты, чекпоинт, итог, перенос в другое пространство.",
    {
      sprint_id: SPRINT_ID,
      name: { type: "string" },
      start_date: DATE("Старт"),
      end_date: DATE("Финал"),
      check_date: {
        type: ["string", "null"],
        description: "Чекпоинт YYYY-MM-DD или null — снять",
      },
      summary: {
        type: ["string", "null"],
        description: "Итог спринта текстом",
      },
      space: SPACE,
    },
    ["sprint_id"],
  ),
  tool(
    "start_sprint",
    "Начать спринт: планирование → идёт. Текущий состав становится планом, всё добавленное позже — «сверх плана».",
    { sprint_id: SPRINT_ID },
    ["sprint_id"],
  ),
  tool(
    "accept_sprint",
    "Финал — приёмка: фиксирует итоги и переносит незакрытое в ближайший запланированный спринт пространства (если его нет — создаёт следующий).",
    {
      sprint_id: SPRINT_ID,
      summary: {
        type: "string",
        description: "Итог спринта текстом (опционально)",
      },
    },
    ["sprint_id"],
  ),
  tool("delete_sprint", "Убрать непринятый спринт в архив. Только админ.", {
    sprint_id: SPRINT_ID,
  }, ["sprint_id"]),
  tool(
    "add_sprint_tasks",
    "Добавить задачи в состав спринта. До старта — в план, после — «сверх плана». Личные задачи в спринт не попадают.",
    {
      sprint_id: SPRINT_ID,
      task_ids: {
        type: "array",
        items: { type: "string" },
        description: "id задач из get_tasks (полные uuid)",
      },
    },
    ["sprint_id", "task_ids"],
  ),
  tool(
    "remove_sprint_task",
    "Убрать задачу из состава спринта (сама задача остаётся).",
    {
      sprint_id: SPRINT_ID,
      task_id: { type: "string", description: "task_id из get_sprint" },
    },
    ["sprint_id", "task_id"],
  ),
  tool(
    "mark_sprint_task",
    "Отметка по задаче в спринте: сверка на чекпоинте (идёт/риск/проблема + комментарий) и пометка «к переносу» с причиной.",
    {
      sprint_id: SPRINT_ID,
      task_id: { type: "string", description: "task_id из get_sprint" },
      check_status: {
        type: ["string", "null"],
        enum: ["ok", "risk", "problem", null],
        description: "ok — идёт, risk — риск, problem — проблема, null — снять",
      },
      check_note: {
        type: ["string", "null"],
        description: "Комментарий к сверке",
      },
      to_carry: {
        type: "boolean",
        description: "true — пометить к переносу в следующий спринт",
      },
      carry_reason: {
        type: ["string", "null"],
        description: "Почему переносится",
      },
    },
    ["sprint_id", "task_id"],
  ),
];
