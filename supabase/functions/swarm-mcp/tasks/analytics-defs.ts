// Определения инструментов MCP — только данные, без обработчиков и клиента базы: тест аннотаций и tools/list
// грузят их, не втягивая в покрытие модули с логикой. Обработчики — в analytics.ts.

export const ANALYTICS_TOOL_DEFINITIONS = [
  {
    name: "get_task_stats",
    description:
      "Статистика по задачам за период: создано/закрыто (с раскладкой по дням или месяцам), время от постановки до закрытия, время ожидания начала работы и время в работе по журналу, дисциплина сроков, кто сколько закрыл, что просрочено. Фильтры по исполнителю, проекту, рынку.",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["day", "week", "month", "quarter", "year"],
          description: "Окно статистики, по умолчанию week",
        },
        since: {
          type: "string",
          description:
            "Точная дата начала (ISO, 2026-09-01) — важнее period. Неразобранное значение = отказ, а не тихий дефолт",
        },
        assignee: { type: "string", description: "Имя исполнителя — считать только его задачи" },
        project: { type: "string", description: "Имя проекта или подпроекта (точные имена — get_projects)" },
        country: { type: "string", description: "Страна или рынок" },
        requesting_user_id: {
          type: "number",
          description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу",
        },
      },
      required: ["requesting_user_id"],
    },
  },
  {
    name: "get_task_history",
    description:
      "История одной задачи: что, когда и кем менялось — статус, срок, исполнитель, проект, спринт, приоритет. ID задачи печатает get_tasks.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID задачи — полный uuid из строки задачи в get_tasks" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["task_id", "requesting_user_id"],
    },
  },
  {
    name: "get_recent_task_changes",
    description:
      "Все изменения по доступным задачам за период одной выдачей — «где, когда, куда передвинули». Сгруппировано по задаче, у каждой печатается id.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "С какого момента (ISO). По умолчанию — неделя. Неразобранное значение = отказ",
        },
        limit: {
          type: "number",
          description:
            "Сколько изменений показать: по умолчанию 100, максимум 400. Если больше — выдача честно скажет, что обрезана",
        },
        requesting_user_id: {
          type: "number",
          description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу",
        },
      },
      required: ["requesting_user_id"],
    },
  },
];
