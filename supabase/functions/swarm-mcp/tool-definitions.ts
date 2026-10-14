// Определения инструментов MCP одним списком: index.ts отдаёт их в tools/list, тесты проверяют покрытие
// аннотациями (annotations.ts). Вынесено из index.ts, чтобы список можно было импортировать без запуска сервера.
import {
  COMMENT_TOOL_DEFINITIONS,
  LABEL_TOOL_DEFINITIONS,
  PROJECT_TOOL_DEFINITIONS,
  TASK_TOOL_DEFINITIONS,
} from "./tasks/tools.ts";
import { ANALYTICS_TOOL_DEFINITIONS } from "./tasks/analytics.ts";
import { SPRINT_TOOL_DEFINITIONS } from "./tasks/sprints.ts";
import { PERSONAL_TOOL_DEFINITIONS } from "./tasks/personal.ts";
import { MARKET_TOOL_DEFINITIONS } from "./market.ts";
import { INSPECTION_TOOL_DEFINITIONS } from "./inspections.ts";
import { MEETING_REVIEW_TOOL_DEFINITIONS } from "./meetings.ts";

export const TOOLS = [
  {
    name: "whoami",
    description:
      "Кто я: имя, внутренний ID и воркспейс пользователя, от чьего имени работает этот коннектор (определяется токеном).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_knowledge",
    description: "Семантический поиск по командной базе знаний. Ищет по смыслу — документы, заметки, встречи, ссылки.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос" },
        limit: { type: "number", description: "Количество результатов (по умолчанию 5, макс 20)" },
        requesting_user_id: {
          type: "number",
          description: "Your Telegram user ID — include to see your private entries in results",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_tasks",
    description:
      "Получить задачи команды с фильтрами по исполнителю, стране, статусу или проекту (в том числе «без проекта»). Не больше 30 строк: если подошло больше, первой строкой печатается «показаны N из M». В каждой строке — id задачи (им вызываются get_task_comments, add_task_comment и update_task) и проект.",
    inputSchema: {
      type: "object",
      properties: {
        assignee: { type: "string", description: "Имя исполнителя" },
        country: { type: "string", description: "Страна или рынок" },
        status: { type: "string", enum: ["backlog", "open", "in_progress", "done", "cancelled"] },
        period: { type: "string", enum: ["week"], description: "Задачи на этой неделе" },
        label: { type: "string", description: "Имя личной смарт-метки для фильтра" },
        project: {
          type: "string",
          description:
            "Имя проекта или подпроекта доски — фильтр по нему. Не найден — отказ со списком доступных проектов (задачи НЕ показываются). Точные имена — get_projects. Подпроекты сюда не входят: у каждого свой фильтр.",
        },
        no_project: {
          type: "boolean",
          description:
            "true — только задачи вне проектов (висят в общем списке, не на доске). Нельзя вместе с project.",
        },
        requesting_user_id: {
          type: "number",
          description: "Твой Telegram user ID — обязателен для фильтрации по воркспейсу",
        },
      },
      required: ["requesting_user_id"],
    },
  },
  ...TASK_TOOL_DEFINITIONS,
  ...PROJECT_TOOL_DEFINITIONS,
  ...LABEL_TOOL_DEFINITIONS,
  ...COMMENT_TOOL_DEFINITIONS,
  ...ANALYTICS_TOOL_DEFINITIONS,
  ...SPRINT_TOOL_DEFINITIONS,
  ...PERSONAL_TOOL_DEFINITIONS,
  ...MARKET_TOOL_DEFINITIONS,
  ...INSPECTION_TOOL_DEFINITIONS,
  ...MEETING_REVIEW_TOOL_DEFINITIONS,
  {
    name: "get_meetings",
    description: "Получить последние встречи из Read.ai сохранённые в базе знаний.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Количество встреч (по умолчанию 10)" },
        requesting_user_id: {
          type: "number",
          description: "Your Telegram user ID — filters meetings to your workspace",
        },
      },
    },
  },
  {
    name: "get_users",
    description: "Получить список пользователей команды с их профилями: имя, роль, рынки, контакты.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Фильтр по рынку/стране" },
        requesting_user_id: { type: "number", description: "Your Telegram user ID — filters users to your workspace" },
      },
    },
  },
  {
    name: "get_feedback",
    description:
      "Фидбек пользователей (баги/идеи) из бота и веба. Только для владельца. По умолчанию — незакрытые (new/triaged). Фильтры: status, category.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["new", "triaged", "done", "wontfix"],
          description: "Фильтр по статусу (по умолчанию — незакрытые)",
        },
        category: {
          type: "string",
          description: "Раздел: recorder|meetings|search|tasks|knowledge|digest|auth|integrations|claude|ui|other",
        },
        limit: { type: "number", description: "Сколько вернуть (по умолчанию 30, макс 100)" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен (только владелец)" },
      },
    },
  },
  {
    name: "resolve_feedback",
    description:
      "Пометить фидбек статусом (triaged/done/wontfix) и опционально привязать к задаче (task_id). Только для владельца.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID фидбека из get_feedback" },
        status: {
          type: "string",
          enum: ["new", "triaged", "done", "wontfix"],
          description: "Новый статус (по умолчанию done)",
        },
        task_id: { type: "string", description: "ID задачи, если фидбек превращён в задачу" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен (только владелец)" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_entry",
    description:
      "Получить полный текст записи из базы знаний по ID. Используй когда search_knowledge вернул обрезанный текст.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи из результатов search_knowledge" },
        requesting_user_id: {
          type: "number",
          description: "Your Telegram user ID — required to access your private entries",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "add_knowledge",
    description:
      "Добавить текст в командную базу знаний. summary обязателен. content — ВСЕГДА передавай полный оригинальный текст целиком, не сокращая. Инструмент сам разобьёт на части при необходимости.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Полный оригинальный текст целиком — обязательно передавай весь, без сокращений",
        },
        summary: { type: "string", description: "Детальные тезисы — согласованные с пользователем ключевые пункты" },
        source: { type: "string", description: "Источник (название файла, тип контента)" },
        is_private: {
          type: "boolean",
          description: "Set true to save in personal private storage, invisible to other users",
        },
        owner_telegram_id: { type: "number", description: "Your Telegram user ID — required when is_private is true" },
      },
      required: ["summary"],
    },
  },
  {
    name: "list_entries",
    description:
      "Список записей в базе знаний с фильтрами. Используй для ревизии — посмотреть что есть, найти старые или дублирующие записи.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Фильтр по источнику: telegram, voice, pdf, document, read_ai, url, claude и др.",
        },
        entry_type: {
          type: "string",
          description: "Тип записи: meeting (транскрипт/тезисы созвона) или note (всё остальное)",
        },
        date_from: { type: "string", description: "Дата от в формате YYYY-MM-DD" },
        date_to: { type: "string", description: "Дата до в формате YYYY-MM-DD" },
        limit: { type: "number", description: "Количество записей (по умолчанию 20, макс 100)" },
        has_file: {
          type: "boolean",
          description: "true — только записи с прикреплённым файлом, false — только без файла",
        },
        has_no_countries: {
          type: "boolean",
          description: "true — только записи без тегов стран (нужна переиндексация)",
        },
        requesting_user_id: {
          type: "number",
          description: "Your Telegram user ID — include to see your private entries in results",
        },
      },
    },
  },
  {
    name: "delete_entry",
    description:
      "Удалить запись из базы знаний по ID. Запись уходит в архив вместе с задачами встречи и пропадает из поиска и списков; прикреплённый файл по ссылке больше не открывается. Можно удалить только свою запись (owner_id = requesting_user_id).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи из list_entries или search_knowledge" },
        requesting_user_id: {
          type: "number",
          description: "Твой Telegram user ID — обязателен для проверки права на удаление",
        },
      },
      required: ["id", "requesting_user_id"],
    },
  },
  {
    name: "update_entry",
    description:
      "Обновить содержимое записи: текст, тезисы или метаданные. Используй чтобы исправить или дополнить существующую запись.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи" },
        content: { type: "string", description: "Новый полный текст (опционально)" },
        summary: { type: "string", description: "Новые тезисы (опционально)" },
        title: { type: "string", description: "Новый заголовок в metadata (опционально)" },
        entry_date: { type: "string", description: "Новая дата события YYYY-MM-DD (опционально)" },
        countries: {
          type: "array",
          items: { type: "string" },
          description: "Список стран/рынков на английском: Serbia, Croatia, Moldova и т.д. (опционально)",
        },
        file_content_base64: {
          type: "string",
          description: "Новый файл в base64 — заменяет текущий файл (требует file_name)",
        },
        file_name: { type: "string", description: "Имя нового файла с расширением" },
      },
      required: ["id"],
    },
  },
  {
    name: "reindex_entry",
    description:
      "Перечитать запись и пересчитать страны + embedding через GPT. Используй когда у записи пустые или неправильные страны, или embedding устарел. Можно передать новый summary — иначе берётся существующий.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID записи из list_entries или search_knowledge" },
        summary: {
          type: "string",
          description: "Новые тезисы (опционально — если не передан, используется существующий)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "upload_file",
    description:
      "Загрузить файл в хранилище Swarm Brain. Передай содержимое файла в base64. Максимальный размер ~4 MB. После загрузки создаётся запись в базе знаний с публичной ссылкой на файл.",
    inputSchema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Имя файла с расширением, например contract.pdf" },
        file_content_base64: { type: "string", description: "Содержимое файла, закодированное в base64" },
        mime_type: { type: "string", description: "MIME-тип (опционально, определяется по расширению автоматически)" },
        summary: { type: "string", description: "Описание файла / тезисы содержимого для индексации" },
        source: { type: "string", description: "Источник (по умолчанию: file)" },
        requesting_user_id: { type: "number", description: "Your Telegram user ID — sets workspace for uploaded file" },
      },
      required: ["file_name", "file_content_base64", "summary"],
    },
  },
  {
    name: "get_storage_stats",
    description: "Статистика базы знаний: общее количество записей, количество файлов, разбивка по типам и источникам.",
    inputSchema: {
      type: "object",
      properties: {
        requesting_user_id: { type: "number", description: "Your Telegram user ID — filters stats to your workspace" },
      },
    },
  },
];
