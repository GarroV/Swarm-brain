// Определения инструментов MCP — только данные, без обработчиков и клиента базы: тест аннотаций и tools/list
// грузят их, не втягивая в покрытие модули с логикой. Обработчики — в personal.ts.

const ME = { type: "number", description: "Твой Telegram user ID" };

export const PERSONAL_TOOL_DEFINITIONS = [
  {
    name: "create_task_label",
    description: "Создать личную смарт-метку (папку) задач. Метки видишь только ты.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Название метки" }, requesting_user_id: ME },
      required: ["name", "requesting_user_id"],
    },
  },
  {
    name: "rename_task_label",
    description: "Переименовать свою метку. id — из list_task_labels.",
    inputSchema: {
      type: "object",
      properties: {
        label_id: { type: "string", description: "id метки" },
        name: { type: "string", description: "Новое название" },
        requesting_user_id: ME,
      },
      required: ["label_id", "name", "requesting_user_id"],
    },
  },
  {
    name: "delete_task_label",
    description: "Удалить свою метку. Она снимается со всех твоих задач, сами задачи остаются.",
    inputSchema: {
      type: "object",
      properties: { label_id: { type: "string", description: "id метки" }, requesting_user_id: ME },
      required: ["label_id", "requesting_user_id"],
    },
  },
  {
    name: "set_task_subscription",
    description:
      "Следить за задачей (notify=true): новые комментарии к ней придут уведомлением. notify=false — выключить уведомления по задаче.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "id задачи" },
        notify: { type: "boolean", description: "true — следить, false — не уведомлять" },
        requesting_user_id: ME,
      },
      required: ["task_id", "notify", "requesting_user_id"],
    },
  },
  {
    name: "get_notifications",
    description:
      "Твои уведомления (колокольчик Swarm): кто и что написал в задачах, плановые работы. Новые сверху, у каждого id.",
    inputSchema: {
      type: "object",
      properties: {
        only_unread: { type: "boolean", description: "Только непрочитанные" },
        limit: { type: "number", description: "Сколько последних, по умолчанию 30, максимум 100" },
        requesting_user_id: ME,
      },
      required: ["requesting_user_id"],
    },
  },
  {
    name: "mark_notifications_read",
    description: "Отметить уведомления прочитанными. Без ids — все сразу.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "id уведомлений из get_notifications" },
        requesting_user_id: ME,
      },
      required: ["requesting_user_id"],
    },
  },
  {
    name: "get_today_meetings",
    description:
      "Встречи на сегодня из твоего Google-календаря: время, название, с кем, ссылка на звонок. Для утреннего брифинга — дальше ищи этих людей через search_knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        tz_offset_minutes: {
          type: "number",
          description:
            "Смещение твоего пояса от UTC в минутах к востоку (Белград летом 120, зимой 60). Без него сутки и время — в UTC.",
        },
        requesting_user_id: ME,
      },
      required: ["requesting_user_id"],
    },
  },
];
