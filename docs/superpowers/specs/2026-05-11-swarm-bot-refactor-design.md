# Swarm Bot — Рефакторинг (Подход Б)

**Дата:** 2026-05-11  
**Статус:** Approved

## Проблема

`swarm-bot/index.ts` вырос до 2769 строк — монолит, в котором смешаны Google Drive, Telegram API, OpenAI, хэндлеры сообщений, задачи, встречи, профили, дайджест. Добавление новых фич требует навигации по огромному файлу. Дополнительно: ~30% кода обёрнуто в `if (false && ...)` — отключённые функции, которые планируется вернуть.

Два рабочих бага:
1. Бот не выдаёт исходный текст записей — только саммари.
2. Параметр `wants_full_text` в `search_knowledge` ненадёжен — GPT не всегда его выставляет.

## Цели рефакторинга

1. Разбить монолит на модули без изменения внешнего поведения бота.
2. Мёртвый код (disabled) — вынести в соответствующие модули, не удалять.
3. Починить выдачу исходников через улучшение тула и system prompt.
4. Кнопки оставить без изменений (`📥 Добавить` + `❓ Спросить`).

## Структура файлов (целевая)

```
supabase/functions/swarm-bot/
├── index.ts                  (~250 строк)
│   └── Только: Deno.serve, роутинг callback/message, cron-триггеры
│
├── lib/
│   ├── telegram.ts           — sendMessage, sendInlineMessage, editMessageKeyboard,
│   │                           answerCallback, buildKeyboard, getTelegramFileUrl
│   ├── openai.ts             — getEmbedding, chatComplete, chatCompleteMini,
│   │                           KNOWLEDGE_TOOLS, executeTool
│   ├── storage.ts            — saveEntry, extractEntryMeta, generateSummary,
│   │                           getSession, setSession, clearSession,
│   │                           checkAllowed, autoSyncProfile
│   ├── drive.ts              — getGoogleAccessToken, getOrCreateDriveFolder,
│   │                           uploadToDrive
│   └── readai.ts             — getReadAiToken, readAiGet
│
└── handlers/
    ├── knowledge.ts          — handleAdd, handleAsk
    ├── media.ts              — handleVoice, handleDocument, handlePhoto,
    │                           handleUrl, transcribeAudio, describeImage,
    │                           fetchUrlContent, parseSpreadsheet
    ├── tasks.ts              — handleTasks, handleTaskListCallback,
    │                           handleTaskStatusChange, sendTaskCard,
    │                           analyzeAndCreateTasks, handleTasksExport,
    │                           smartTaskSearch
    │                           (+ disabled: task_date/title/url/comment сессии)
    ├── meetings.ts           — handleMeetings, handleMeetingCallback,
    │                           handleConnect, meeting callback handlers
    ├── users.ts              — handleUsers, showProfile, startOnboarding,
    │                           handleProfileEdit, showProfileEditMenu
    │                           (+ disabled: onboarding/profile сессии)
    └── digest.ts             — generatePersonalDigest, sendAllDigests
```

### Принцип разбивки

- `index.ts` импортирует хэндлеры и вызывает их. Никакой бизнес-логики.
- `lib/` — утилиты без состояния (API-обёртки, Supabase-операции).
- `handlers/` — логика обработки конкретных сценариев.
- Отключённые функции живут в модулях, но не вызываются из `index.ts`. Включить = добавить вызов в диспетчер.

## Исправление выдачи исходников

### Что меняется в `search_knowledge`

Убираем параметр `wants_full_text`. Новая логика возврата в `executeTool`:

```
if content.length <= 500:
  вернуть content целиком
else:
  вернуть summary (или content[:500] если summary нет)
  + добавить строку: "[Полный текст: export_entry(id=<uuid>)]"
```

### Что меняется в system prompt `handleAsk`

Добавить явное правило:
> "Если результат поиска содержит `[Полный текст: export_entry(id=...)]` и пользователь просит исходник, полный текст или дословно — вызови export_entry с этим id. Не пытайся передать длинный текст в сообщении — сразу отправляй файлом."

### Что не меняется

- Схема БД (`content`, `summary`, `embedding`) — без изменений.
- Логика `saveEntry` — без изменений.
- Тул `export_entry` — без изменений, работает корректно.

## Кнопки и роутинг

Клавиатура (`buildKeyboard`) — без изменений:
```
[ 📥 Добавить ]  [ ❓ Спросить ]
```

Роутинг текстовых сообщений — без изменений:
```
Свободный текст          → handleAsk
"📥 Добавить" нажата     → сессия waiting_add → handleAdd
"❓ Спросить" нажата     → handleAsk (явный режим вопроса)
/add [текст]             → handleAdd напрямую
/ask [текст]             → handleAsk напрямую
```

## Что не входит в рефакторинг

- Изменение схемы БД.
- Переработка алгоритмов поиска.
- Включение disabled-функционала (задачи, дайджест, пользователи) — отдельная задача.
- Изменение других Edge Functions (`swarm-mcp`, `read-ai-webhook`, `read-ai-auth`).

## Ожидаемый результат

- `index.ts`: ~250 строк вместо 2769.
- Каждый модуль: 100–400 строк с единственной ответственностью.
- Поведение бота не меняется для пользователей.
- Исходники выдаются файлом при запросе.