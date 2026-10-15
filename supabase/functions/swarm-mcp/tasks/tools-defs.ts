// Определения инструментов MCP — только данные, без обработчиков и клиента базы: тест аннотаций и tools/list
// грузят их, не втягивая в покрытие модули с логикой. Обработчики — в tools.ts.

export const TASK_TOOL_DEFINITIONS = [
  {
    name: "add_task",
    description:
      "Создать новую задачу. По умолчанию задача сразу попадает на доску и видна в вебе. Для доски укажи project_name (имя из get_projects), иначе задача уйдёт только в общий список.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Название задачи" },
        description: { type: "string", description: "Описание или детали (опционально)" },
        assignee_name: { type: "string", description: "Имя, фамилия или ник исполнителя (опционально)" },
        country: { type: "string", description: "Рынок/страна (опционально)" },
        due_date: {
          type: "string",
          description: "Дедлайн в формате YYYY-MM-DD (опционально). Год — от текущей даты, не из головы",
        },
        source: { type: "string", enum: ["transcript", "claude", "manual"], description: "Источник задачи" },
        context_id: { type: "string", description: "ID записи в базе знаний (опционально)" },
        task_role: {
          type: "string",
          enum: ["marketing", "bd", "rnd"],
          description:
            "Роль исполнителя: marketing — маркетинг, rnd — продукт/разработка, bd — всё остальное (операционка, бизнес)",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Имена твоих личных смарт-меток (списков); ставятся на любую задачу.",
        },
        project_name: {
          type: "string",
          description:
            "Имя проекта или подпроекта доски (Проекты/SprintBoard) — без него задача на доску не попадёт, только в общий список. При неточном совпадении берётся ближайшее по имени; при отсутствии — предупреждение в ответе, задача всё равно создаётся.",
        },
        recur_freq: {
          type: ["string", "null"],
          enum: ["daily", "weekly", "monthly", "yearly", null],
          description:
            "Цикличность: задача не закрывается, а переносится на следующее вхождение графика (daily — каждый день, weekly — тот же день недели, monthly — то же число месяца, yearly — та же дата каждый год). ТРЕБУЕТ due_date: день недели, число и месяц берутся из срока, интервал отсчитывается от него. null — снять цикличность вместе со всеми полями правила.",
        },
        recur_interval: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: 99,
          description:
            "Каждые N дней/недель/месяцев/лет (по recur_freq), от срока. По умолчанию 1. «Каждые 2 недели» = weekly + 2.",
        },
        recur_weekdays: {
          type: ["array", "null"],
          items: { type: "integer", minimum: 1, maximum: 7 },
          description:
            "Только для weekly: дни недели, 1 = пн … 7 = вс («пн и чт» = [1, 4]). null — день недели срока. Недели с шагом recur_interval считаются от недели срока.",
        },
        recur_setpos: {
          type: ["integer", "null"],
          description:
            "Только для monthly: n-й (1–5) или последний (-1) день недели срока в месяце. «Каждый 3-й понедельник» = monthly + 3 при сроке в понедельник. Если 5-го такого дня в месяце нет — месяц пропускается. null — по числу месяца.",
        },
        remind_date: {
          type: "string",
          description:
            "Пинг — день напоминания YYYY-MM-DD, отдельно от дедлайна («срок 1 марта, напомнить 1 декабря»). Бот пришлёт напоминание исполнителям в этот день, один раз.",
        },
        status: {
          type: "string",
          enum: ["backlog", "open", "in_progress", "done", "cancelled"],
          description:
            "Колонка доски, куда положить задачу. По умолчанию open («Открыто»); backlog — колонка «Бэклог».",
        },
        created_by_name: {
          type: "string",
          description:
            "ТОЛЬКО АДМИН, для заливки задач из других систем: имя, фамилия или ник того, кто будет указан создателем (участник твоего пространства). По умолчанию создатель — ты. Подмена пишется в журнал задачи.",
        },
        mute_created_by: {
          type: "boolean",
          description:
            "Вместе с created_by_name: выключить подставленному создателю уведомления о комментариях к этой задаче (если он не исполнитель). По умолчанию true.",
        },
        parent_task_id: {
          type: "string",
          description:
            "id родительской задачи — создать ПОДЗАДАЧУ. Вложенность одна: родитель — задача верхнего уровня. Подзадача берёт проект и срок (если не задан) родителя",
        },
        confirmed: {
          type: "boolean",
          description:
            "По умолчанию true — задача сразу на доске. false кладёт её в очередь «На проверке», которая видна ТОЛЬКО в Telegram-боте (в вебе такой задачи не видно вообще) — используй только если человек прямо попросил очередь.",
        },
      },
      required: ["title", "source"],
    },
  },
  {
    name: "update_task",
    description:
      "Обновить задачу по ID. Передай только поля которые нужно изменить. due_date: null — убрать дедлайн. ⚠️ У РЕГУЛЯРНОЙ задачи (recur_freq заполнен) status: done задачу НЕ закрывает: срок переносится на следующее вхождение, статус снова open.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID задачи" },
        title: { type: "string" },
        description: { type: "string" },
        assignee_name: { type: "string", description: "Новый исполнитель. Пустая строка — убрать исполнителя." },
        country: { type: "string" },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD или null чтобы убрать" },
        status: {
          type: "string",
          enum: ["backlog", "open", "in_progress", "done", "cancelled"],
          description: "Колонка доски. backlog — «Бэклог» (issue #200).",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description:
            "Имена твоих личных смарт-меток (списков) — ставятся на любую задачу; меняются только твои метки, чужие на задаче сохраняются.",
        },
        task_role: {
          type: "string",
          enum: ["marketing", "bd", "rnd"],
          description:
            "Роль исполнителя: marketing — маркетинг, rnd — продукт/разработка, bd — всё остальное (операционка, бизнес)",
        },
        project_name: {
          type: "string",
          description:
            "Имя проекта или подпроекта доски. Пустая строка — снять проект (задача уйдёт с доски в общий список).",
        },
        recur_freq: {
          type: ["string", "null"],
          enum: ["daily", "weekly", "monthly", "yearly", null],
          description:
            "Цикличность: задача не закрывается, а переносится на следующее вхождение графика (daily — каждый день, weekly — тот же день недели, monthly — то же число месяца, yearly — та же дата каждый год). ТРЕБУЕТ due_date: день недели, число и месяц берутся из срока, интервал отсчитывается от него. null — снять цикличность вместе со всеми полями правила.",
        },
        recur_interval: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: 99,
          description:
            "Каждые N дней/недель/месяцев/лет (по recur_freq), от срока. По умолчанию 1. «Каждые 2 недели» = weekly + 2.",
        },
        recur_weekdays: {
          type: ["array", "null"],
          items: { type: "integer", minimum: 1, maximum: 7 },
          description:
            "Только для weekly: дни недели, 1 = пн … 7 = вс («пн и чт» = [1, 4]). null — день недели срока. Недели с шагом recur_interval считаются от недели срока.",
        },
        recur_setpos: {
          type: ["integer", "null"],
          description:
            "Только для monthly: n-й (1–5) или последний (-1) день недели срока в месяце. «Каждый 3-й понедельник» = monthly + 3 при сроке в понедельник. Если 5-го такого дня в месяце нет — месяц пропускается. null — по числу месяца.",
        },
        remind_date: {
          type: ["string", "null"],
          description:
            "Пинг — день напоминания YYYY-MM-DD, отдельно от дедлайна. Перенос даты взводит пинг заново, даже если старый уже сработал. null — снять пинг.",
        },
        parent_task_id: {
          type: "string",
          description:
            "Сделать подзадачей задачи с этим id (того же проекта, верхнего уровня). Пустая строка — отвязать от родителя",
        },
        hidden_from_hub: {
          type: "boolean",
          description:
            "true — не показывать задачу в публичной дорожной карте хаба проектов (даже если доска опубликована); false — вернуть.",
        },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["id", "requesting_user_id"],
    },
  },
  {
    name: "delete_task",
    description: "Удалить задачу по ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID задачи" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["id", "requesting_user_id"],
    },
  },
];

export const PROJECT_TOOL_DEFINITIONS = [
  {
    name: "get_projects",
    description:
      "Показать доски воркспейса деревом: проекты, их подпроекты, id и счётчики задач. Вызывай ПЕРЕД add_task/get_tasks с project_name — имена проектов угадать нельзя.",
    inputSchema: {
      type: "object",
      properties: {
        requesting_user_id: {
          type: "number",
          description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу и приватности проектов",
        },
      },
      required: ["requesting_user_id"],
    },
  },
];

export const LABEL_TOOL_DEFINITIONS = [
  {
    name: "list_task_labels",
    description: "Показать твои личные смарт-метки (папки) задач: имя + id.",
    inputSchema: {
      type: "object",
      properties: { requesting_user_id: { type: "number", description: "Твой Telegram user ID" } },
      required: ["requesting_user_id"],
    },
  },
];

export const COMMENT_TOOL_DEFINITIONS = [
  {
    name: "get_recent_comments",
    description:
      "Свежие комментарии-апдейты по ВСЕМ доступным тебе задачам одним запросом — для дайджеста «что нового». Сгруппированы по задаче, у каждой печатается id.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description:
            "С какого момента брать комментарии: ISO-дата (2026-09-09) или момент (2026-09-09T07:00:00Z). По умолчанию — последние 24 часа. Неразобранное значение = отказ, а не тихий дефолт",
        },
        limit: {
          type: "number",
          description:
            "Сколько комментариев показать: по умолчанию 50, максимум 200. Если свежих больше — выдача честно скажет, что обрезана",
        },
        requesting_user_id: {
          type: "number",
          description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу",
        },
      },
      required: ["requesting_user_id"],
    },
  },
  {
    name: "get_task_comments",
    description:
      "Показать комментарии-апдейты к задаче по её ID (если задача доступна тебе). ID берётся из выдачи get_tasks — он печатается в строке задачи.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "ID задачи — полный uuid из строки задачи в get_tasks (сокращённый префикс не резолвится)",
        },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["task_id", "requesting_user_id"],
    },
  },
  {
    name: "add_task_comment",
    description:
      "Добавить комментарий-апдейт к задаче по её ID от твоего лица. Исполнители, создатель, владелец и подписчики задачи получат уведомление (колокольчик и пуш в бота), а ты будешь подписан на дальнейшие комментарии.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "ID задачи — полный uuid из строки задачи в get_tasks (сокращённый префикс не резолвится)",
        },
        content: { type: "string", description: "Текст комментария" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен" },
      },
      required: ["task_id", "content", "requesting_user_id"],
    },
  },
  {
    name: "delete_task_comment",
    description:
      "Удалить СВОЙ комментарий к задаче. Чужой удалить нельзя. Правки текста нет: чтобы исправить опечатку, удали комментарий и добавь заново. id комментария печатается в get_task_comments.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID задачи — полный uuid" },
        comment_id: { type: "string", description: "ID комментария из выдачи get_task_comments" },
        requesting_user_id: { type: "number", description: "Заполняется из токена" },
      },
      required: ["task_id", "comment_id"],
    },
  },
];
