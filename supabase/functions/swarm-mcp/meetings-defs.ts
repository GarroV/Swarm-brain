// Определения инструментов MCP — только данные, без обработчиков и клиента базы: тест аннотаций и tools/list
// грузят их, не втягивая в покрытие модули с логикой. Обработчики — в meetings.ts.

const IDENTITY = { type: "number", description: "Заполняется из токена" };
const MEETING_ID = { type: "string", description: "id черновика из get_review_queue" };

export const MEETING_REVIEW_TOOL_DEFINITIONS = [
  {
    name: "get_review_queue",
    description:
      "Очередь вычитки: черновики встреч, которые записал ты и которые ещё не опубликованы в базу. У каждого печатается id. Чужие черновики не видны никому, включая владельца.",
    inputSchema: { type: "object", properties: { requesting_user_id: IDENTITY } },
  },
  {
    name: "get_draft_meeting",
    description: "Открыть черновик встречи: название, время, участники, тезисы.",
    inputSchema: {
      type: "object",
      properties: { meeting_id: MEETING_ID, requesting_user_id: IDENTITY },
      required: ["meeting_id"],
    },
  },
  {
    name: "update_draft_meeting",
    description:
      "Поправить черновик до публикации: тезисы (notes, markdown целиком — заменяют прежние) и/или название. Правленые тезисы считаются вычитанными человеком.",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: MEETING_ID,
        notes: { type: "string", description: "Новые тезисы целиком (markdown)" },
        title: { type: "string", description: "Новое название встречи" },
        requesting_user_id: IDENTITY,
      },
      required: ["meeting_id"],
    },
  },
  {
    name: "publish_draft_meeting",
    description:
      "Опубликовать черновик в базу знаний (то же, что «Согласовать» в вебе). Если эта встреча уже лежит в базе, черновик привязывается к ней, а остаётся более полная версия. По умолчанию — в базу команды.",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: MEETING_ID,
        base: {
          type: "string",
          enum: ["team", "personal"],
          description:
            "team — база команды (по умолчанию), personal — личная. Встречу нескольких владельцев в личную нельзя; исключение — встреча 1-1 (ровно двое): тогда одна личная запись видна обоим",
        },
        countries: {
          type: "array",
          items: { type: "string" },
          description:
            "Рынки на английском (Serbia, Croatia…). Не передан — определит классификатор по тезисам. Пустой список — «Общее»",
        },
        requesting_user_id: IDENTITY,
      },
      required: ["meeting_id"],
    },
  },
  {
    name: "extract_tasks_from_meeting",
    description:
      "Предложить задачи по тезисам встречи — тем же экстрактором, что кнопка «Сгенерировать» в вебе. Ничего не создаёт: покажи список человеку и заведи согласованные через add_task. Источник — черновик (meeting_id) или запись в базе (entry_id).",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: { type: "string", description: "id черновика из get_review_queue" },
        entry_id: { type: "string", description: "id записи-встречи в базе (из get_meetings / search_knowledge)" },
        requesting_user_id: IDENTITY,
      },
    },
  },
];
