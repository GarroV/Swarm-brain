# Changelog

## 2026-06-09 — test: первые автотесты на security-критичные функции

- **supabase/functions/deno.json**: тест-таск `deno task test` (`deno test --allow-net`).
- **_shared/countries.test.ts**: 7 тестов на `normalizeCountry` / `normalizeCountries` (ISO, алиасы RU/EN, legacy-скобки, дедуп, неизвестные).
- **swarm-api/entries-guard.test.ts**: 8 тестов на `getEntrySecure` / `buildEntriesQuery` — три слоя защиты (воркспейс-изоляция, приватность 404-неотличимость, ownership 403) на mock-supabase.
- **swarm-api/auth.test.ts**: 8 тестов на `verifyInitData` — валидная подпись, подделка хеша, мутация payload, протухший `auth_date`, чужой токен, отсутствие hash/user, битый JSON.
- Итого 23 теста, все зелёные. Запуск: `cd supabase/functions && deno task test`.

## 2026-06-09 — fix(api+miniapp): поиск в базе знаний не работал

- **swarm-api/index.ts** GET /search: embedding передавался как JS-array вместо строки `"[0.1,0.2,...]"` — `match_entries` RPC ожидает Postgres vector literal. Исправлено на `` `[${embedding.join(",")}]` `` (аналогично боту и MCP). Порог снижен с 0.35 до 0.3.
- **miniapp/src/components/KnowledgeScreen.tsx**: добавлен `catch` в `handleSearch` — ошибки поиска теперь показываются пользователю вместо молчаливого «Ничего не найдено».

## 2026-06-08 — fix(miniapp): свайп между табами задач + не работал скролл списка

- **miniapp/src/components/KanbanBoard.tsx**: Добавлен свайп влево/вправо для переключения табов Open / In Progress / Done — хук `useTabSwipe` на нативных touch-событиях (без новых зависимостей), порог 60px, отсекает вертикальные жесты по соотношению dx/dy.
- Исправлен баг «нельзя проскроллить список задач вниз»: контейнер экрана использовал `min-h-screen`, разрастаясь больше доступной высоты родителя (`flex-1 overflow-hidden` в `page.tsx`), из-за чего скролл не работал — заменено на `h-full`. Дополнительно у `<Tabs>` (flex-item с `flex-1`) добавлен `min-h-0`: без него `min-height: auto` не давал контейнеру сжаться до выделенного места, и весь контент раздувал страницу вместо скролла внутри списка.

## 2026-06-04 — feat(bot): после сохранения/пропуска Granola-встречи бот предлагает следующую

- **swarm-bot/handlers/granola.ts**: Добавлен хелпер `offerNextGranolaNote(chatId, telegramId)` — запрашивает заметки Granola за последние 30 дней, фильтрует уже обработанные, показывает первую оставшуюся карточку с кнопками «🔍 Тезисы» / «🗑 Пропустить» и счётчиком «ещё N» если их больше одной.
- Хелпер вызывается после успешного сохранения (`gc_`, `gcp_`) и после пропуска (`gd_`). При ошибке сохранения следующая встреча не предлагается.
- `saveGranolaNote` возвращает `boolean` вместо `void` — `true` только при успешной записи в БД.

## 2026-06-04 — feat(bot): показываем источник задачи в детальном сообщении

- **swarm-bot/tasks/handlers.ts**: В `buildTaskDetailMessage` добавлена строка `📍 Источник: …`. Добавлена константа `SOURCE_LABEL_BOT` — маппинг значений поля `task.source` (`transcript`, `claude`, `manual`, `mini_app`) в человекочитаемые метки с эмодзи. Для неизвестных источников выводится сырое значение поля; если поле `null/undefined` — прочерк `—`.

## 2026-06-04 — feat(miniapp): добавлено поле created_by_name к типу Task

- **miniapp/src/types.ts**: Добавлено поле `created_by_name: string | null` в тип `Task`
- **miniapp/src/lib/api.ts**: Обновлены mock-задачи — добавлено `created_by_name` для каждой:
  - Task id "1": `created_by_name: "Dev User"`
  - Task id "2": `created_by_name: "Alice Smith"`
  - Task id "3": `created_by_name: null`
  - В функции `createTask()` новые задачи получают `created_by_name` из `MOCK_ME.name`

## 2026-06-04 — refactor(api): убраны лишние type cast в batch-резолве created_by_name

- **swarm-api/index.ts**: В GET /tasks два ненужных каста `(t as { created_by_telegram_id?: number | null })` заменены прямым обращением `t.created_by_telegram_id` — поле уже объявлено в типе `Task` из `_shared/tasks/types.ts`. Второй `map` переписан в стрелочную функцию с объектом вместо `{ return }`.

## 2026-06-04 — feat(api): GET /tasks возвращает created_by_name

- **swarm-api/index.ts**: После вызова `listTasks` добавлен batch-резолв имён создателей задач. Собираются уникальные `created_by_telegram_id`, одним запросом достаются `first_name` из `user_profiles`, каждая задача дополняется полем `created_by_name: string | null`. Один доп. SQL-запрос на весь список вместо N запросов.

## 2026-06-04 — fix(bot): новости по стране — фильтр по countries[], не ILIKE

- **swarm-bot/handlers/knowledge.ts**: `get_recent_by_country(country="Serbia")` раньше искал через ILIKE по тексту — попадали любые записи где страна упоминалась (CEE biweekly, IT+BD где Сербия была одной из 10 стран). Теперь основной фильтр — поле `countries[]` с ISO-кодом (RS/HR/...). ILIKE остался только как fallback для стран не из реестра. Тот же ISO-фильтр применяется к результатам векторного поиска.

## 2026-06-04 — fix(bot): «дай апдейт по новостям» теперь находит записи

- **swarm-bot/handlers/knowledge.ts**: `get_recent_by_country(country="General")` раньше фильтровал по `contains("countries", ["General"])` — такого тега у записей нет, поэтому запрос всегда возвращал пустой список и бот отвечал что ничего не нашёл. Теперь General-путь возвращает все свежие записи без фильтра по странам (`source != digest` исключён)

## 2026-06-04 — feat(mcp): list_entries показывает страны + фильтр has_no_countries

- **swarm-mcp/index.ts**: `list_entries` теперь выводит страны каждой записи (⚠️ нет стран если пусто); новый фильтр `has_no_countries: true` — показывает только записи без тегов стран, удобно для поиска того что нужно переиндексировать

## 2026-06-04 — feat(mcp): reindex_entry + countries в update_entry

- **swarm-mcp/index.ts**:
  - `update_entry`: новое поле `countries` — нормализует через `normalizeCountries()`, применяет General-тег
  - Новый инструмент `reindex_entry(id, summary?)` — перечитывает запись, запускает GPT-анализ контента, обновляет `countries` + `embedding` + `keywords`. Если `summary` не передан — использует существующий. Позволяет через Claude Desktop точечно переиндексировать записи со старыми/пустыми тегами

## 2026-06-04 — feat: ISO-нормализация стран + суперадминка + BUG-2 fix

**_shared/countries.ts** (новый файл):
- Канонический реестр ISO-3166-1 кодов: 27 стран с русскими названиями
- `normalizeCountry(raw)` — нормализует одно название (русское/английское/alias) → ISO код
- `normalizeCountries(raw[])` — массовая нормализация с дедупликацией

**DB миграции:**
- `20260603000000_workspace_markets.sql` — добавлен `allowed_markets text[]` в таблицу `workspaces`
- `20260603000001_normalize_countries_data.sql` — однократная нормализация существующих `entries.countries` и `user_profiles.markets` к ISO кодам

**swarm-bot/lib/storage.ts:**
- `buildEntryIndex` и `extractEntryMeta` теперь возвращают нормализованные ISO коды через `normalizeCountries()`

**read-ai-webhook/index.ts:**
- `extractCountries` нормализует результат GPT через `normalizeCountries()`

**swarm-api/index.ts:**
- Импорт `normalizeCountries` и `COUNTRY_NAMES` из `_shared/countries.ts`
- `POST /entries` inline GPT parse: страны нормализуются перед сохранением
- `PATCH /entries/:id`: `body.countries` нормализуется
- `PATCH /me`: `body.markets` нормализуется перед записью в `user_profiles`
- `GET /me`: добавлен `is_admin: boolean` (true для telegram_id 744230399)
- Новый `GET /config`: возвращает `{ allowed_markets: string[] }` — список из `workspaces.allowed_markets` или глобальный список если null
- Admin routes: `handleAdminRoutes` вызывается до всех остальных роутов

**swarm-api/admin.ts** (новый файл):
- `GET /admin/workspaces` — список воркспейсов с количеством пользователей
- `GET /admin/workspaces/:id/users` — пользователи воркспейса с профилями
- `POST /admin/workspaces/:id/users` — добавить пользователя по telegram_id или username
- `DELETE /admin/workspaces/:wsId/users/:userId` — удалить пользователя из воркспейса
- `PATCH /admin/workspaces/:id` — обновить name или allowed_markets воркспейса
- Все роуты защищены: доступ только для telegram_id 744230399

**swarm-mcp/index.ts:**
- Локальный `extractEntryMeta` нормализует страны через `normalizeCountries()`

**miniapp/src/lib/countries.ts** (новый файл):
- Frontend-копия code→name map: `COUNTRY_NAMES`, `countryName(code)`

**miniapp/src/types.ts:**
- `Me`: добавлен `is_admin: boolean`
- Новые типы: `AdminWorkspace`, `AdminUser`

**miniapp/src/lib/api.ts:**
- `fetchConfig()` — загружает список рынков из `GET /config`
- `fetchAdminWorkspaces/Users`, `addUserToWorkspace`, `removeUserFromWorkspace`, `patchAdminWorkspace` — admin API functions
- `MOCK_ME.is_admin = true` для dev-режима

**miniapp/src/components/SettingsScreen.tsx:**
- `ProfileSection`: рынки теперь загружаются из `GET /config` (ISO коды), отображаются через `countryName()`
- Удалены хардкоженные `MARKETS_EUROPE`, `MARKETS_OTHER`, `normalizeMarket()`

**miniapp/src/components/AdminScreen.tsx** (новый файл):
- `WorkspaceList` — список воркспейсов с количеством пользователей
- `WorkspaceUsers` — пользователи воркспейса + добавление/удаление
- `WorkspaceMarkets` — настройка `allowed_markets`: глобальный список или свой
- `WorkspaceDetail` — вкладки Пользователи / Рынки

**miniapp/src/components/BottomNav.tsx:**
- Принимает `isAdmin?: boolean` prop
- При `isAdmin=true` добавляет таб «Админ» с иконкой ShieldCheck

**miniapp/src/app/page.tsx:**
- Рендерит `<AdminScreen />` при `section === "admin"`
- Передаёт `isAdmin={me?.is_admin ?? false}` в BottomNav

**miniapp/src/components/TeamScreen.tsx:**
- Числовое имя (пользователь без профиля) отображается как `#12345678` вместо сырого ID

## 2026-06-03 — refactor(bot): единый пайплайн индексирования записей

**storage.ts:**
- Новая функция `buildEntryIndex(content, existingSummary?)` — **один GPT-вызов** вместо двух (`generateSummary` + `extractEntryMeta`). Возвращает `{summary, countries, entry_type, entry_date, keywords}`
- `saveEntry()` теперь возвращает `{id: string, summary: string | null}` вместо строки
- **Enriched embedding:** строится на `"${summary}\nСтраны: ${countries}\nКлючевые слова: ${keywords}"` — вектор теперь несёт страновой контекст
- **General тег:** записи без конкретной страны (countries=[]) или с широким охватом (3+ стран) автоматически получают `"General"` в массив `countries`
- `source='note'` (короткие заметки): всегда `countries=["General"]`, без лишних GPT-вызовов

**granola.ts:**
- Embedding теперь строится на `tezisy + страны` (не на 10k символах сырого контента)
- General тег применяется по тем же правилам

**knowledge.ts:**
- `handleAdd`, `save_shared`, `save_private`: убраны redundant вызовы `generateSummary` — summary генерируется внутри `saveEntry`
- `get_recent_by_country`: поддержка `country='General'` — запрос через `.contains("countries", ["General"])`
- Системный промпт: общекомандные запросы ("что нового вообще") → `get_recent_by_country(country='General')`

**media.ts:**
- `handleVoice`: убран отдельный `generateSummary`, использует `saveEntry` return value

## 2026-06-03 — feat(bot): короткие заметки — source='note', find_note, keyword enrichment

- **swarm-bot/handlers/knowledge.ts**:
  - `handleAdd`: текст < 300 символов → `source='note'` + GPT генерирует поисковый индекс (синонимы, тема, назначение). Ответ бота — 📌 Заметка сохранена. Текст ≥ 300 символов — прежнее поведение (`source='telegram'`, тезисы)
  - Новый инструмент `find_note`: ищет только `source='note'` записи, возвращает содержимое напрямую без синтеза. Используется для "пароль от X", "логин от X", "доступ к X", "ключ от X"
  - Системный промпт: добавлен пункт 3 — "пароль/логин/доступ/ключ от X" → `find_note` первым

## 2026-06-03 — feat(bot): find_link tool — поиск только по сохранённым ссылкам

- **swarm-bot/handlers/knowledge.ts**:
  - Новый инструмент `find_link` — ищет исключительно по `source='link'` записям (сохранённые ссылки, дашборды, отчёты). Возвращает URL напрямую
  - Системный промпт: "дай ссылку / дашборд / отчёт по X" → сначала `find_link`, только если пусто — `search_knowledge`. Устраняет баг когда вместо ссылки бот синтезировал ответ из транскриптов встреч

## 2026-06-03 — feat(bot): GPT-enriched summary for saved links

- **swarm-bot/handlers/media.ts**: при сохранении ссылки с описанием запускается GPT-промпт, который генерирует расширенный `summary` — синонимы названия, что содержит ресурс, для чего используется. Это устраняет vocabulary mismatch при поиске ("дашборд" vs "отчёт" теперь оба находят одну запись).

## 2026-06-03 — fix(tasks): поменять порядок кнопок «Назад» и «Удалить» в карточке задачи

- **swarm-bot/tasks/handlers.ts**: в `buildTaskDetailMessage` кнопка «🔙 Назад» теперь слева, «🗑 Удалить» справа

## 2026-06-03 — feat(tasks): edit button, "Для меня" view, авто-задачи из встреч

- **swarm-bot/tasks/handlers.ts**:
  - `buildTaskDetailMessage`: добавлена строка кнопок «✏️ Название · 📅 Дедлайн · 👤 Исполнитель» для редактирования любой задачи из «Мои задачи» / «Команда»
  - `tren_<taskId>` callback + `task_rename` session handler: переименование задачи в свободном тексте
  - `buildMainMenuMessage`: «👥 Все задачи» разбит на «📋 Для меня» (`tk_all`) + «👥 Команда» (`tk_team`)
  - `tk_all` («Для меня»): показывает командные задачи (без исполнителя или с тегом `#all`) + задачи назначенные текущему пользователю
  - `tk_team` («Команда»): все задачи воркспейса, сгруппированные по исполнителю (старое поведение `tk_all`)
- **swarm-bot/handlers/meetings.ts**:
  - `mc_` callback: при подтверждении встречи теперь выбирает `content` записи и вызывает `analyzeAndCreateTasks` — задачи из транскрипта автоматически попадают в «⏳ На проверке»
  - Добавлен импорт `analyzeAndCreateTasks` из `../tasks/handlers.ts`

## 2026-06-03 — feat(miniapp): markets chips picker + meeting countries editing

- **miniapp/src/components/SettingsScreen.tsx**:
  - Поле рынков заменено на toggle-chips сгруппированные по регионам (Европа / Другие рынки)
  - Нормализация устаревших написаний при загрузке (Croatia→Хорватия и т.п.)
  - Имя и @username теперь отображаются в секции профиля
- **miniapp/src/components/MeetingsScreen.tsx**:
  - В диалоге встречи добавлено редактирование стран: chips с кнопкой удаления + поле добавления новой страны
- **supabase/functions/swarm-api/index.ts**: `PATCH /meetings/:id` теперь принимает поле `countries`

## 2026-06-03 — feat(api): GET /me returns role/markets/username; fix null telegram_id in /users

- **supabase/functions/swarm-api/index.ts**:
  - `GET /me`: теперь возвращает `role`, `markets`, `username` из `user_profiles` / `allowed_users`
  - `GET /users`: фильтрует записи с `telegram_id = null` (пользователи добавленные по username до первого входа в бот)
- **miniapp/src/types.ts**: `Me` тип дополнен полями `username`, `role`, `markets`
- **miniapp/src/lib/api.ts**: `MOCK_ME` и `UpdateMeetingInput` обновлены под новые поля

## 2026-06-03 — feat(tasks): swarm-api sets confirmed=true on POST, supports ?confirmed= filter

- **supabase/functions/swarm-api/index.ts**:
  - `POST /tasks` handler: создаваемые задачи теперь получают `confirmed: true` и `created_by_telegram_id: telegram_id`
  - `POST /tasks/extract` handler: задачи извлечённые из текста GPT теперь также получают `confirmed: true` и `created_by_telegram_id: telegram_id`
  - `GET /tasks` handler: добавлена поддержка параметра `?confirmed=true|false` для фильтрации по статусу подтверждения

## 2026-06-03 — security(mcp): workspace isolation for get/delete/update task; add_task notifies creator

- **swarm-mcp/tasks/tools.ts**:
  - `TELEGRAM_BOT_TOKEN` + `notifyCreator(telegramId, taskTitle)` — после создания задачи через MCP создатель получает Telegram-уведомление "📋 Новая задача на проверке"
  - `toolGetTasks`: `requesting_user_id` стал обязательным; без валидного пользователя возвращает ошибку вместо задач всей БД без фильтра
  - `toolDeleteTask`: добавлена воркспейс-проверка (`task.group_id === groupId`), `requesting_user_id` обязателен
  - `toolUpdateTask`: добавлена воркспейс-проверка (`task.group_id === groupId`), `requesting_user_id` обязателен
  - `toolAddTask`: передаёт `confirmed: false` и `created_by_telegram_id` в `createTask`; вызывает `notifyCreator` после создания
  - `TASK_TOOL_DEFINITIONS`: `delete_task` и `update_task` — `requesting_user_id` добавлен в `properties` и `required`
- **swarm-mcp/index.ts**:
  - `get_tasks` tool definition: `requesting_user_id` добавлен в `required`; уточнено описание поля
  - call-site касты для `get_tasks`, `update_task`, `delete_task` обновлены под новые типы с обязательным `requesting_user_id`

## 2026-06-02 — feat(tasks): set confirmed+created_by on creation, broadcast on addtask complete

- **swarm-bot/tasks/handlers.ts**:
  - `handleTaskSessionInput` signature: `_userId` → `userId` (параметр теперь используется)
  - `addtask_title` block: `dbCreateTask` теперь передаёт `confirmed: false` и `created_by_telegram_id: userId`
  - `addtask_due` block (skip и date ветки): `dbUpdateTask` теперь устанавливает `confirmed: true`; после создания вызывается `broadcastTaskAssigned(task, groupId)` — исполнители получают уведомление сразу при завершении wizard'а
  - `analyzeAndCreateTasks`: добавлен параметр `userId: number` (третья позиция); `dbCreateTask` теперь передаёт `confirmed: false` и `created_by_telegram_id: userId`

## 2026-06-02 — feat(tasks): confirm sets confirmed=true, broadcasts to assignees

- **swarm-bot/tasks/handlers.ts**:
  - Добавлена новая функция `broadcastTaskAssigned()` для отправки Telegram-уведомлений исполнителям задачи
  - Функция собирает список получателей: `assignee_telegram_ids` + все пользователи воркспейса если в тегах есть `#all`
  - Отправляет каждому: "📋 Тебе назначена задача: <b>{title}</b> · {country} · до {due_date}"
  - Callback `tc_<taskId>` (подтверждение pending-задачи) расширена:
    - Теперь устанавливает `confirmed=true` в БД (вместо просто `status="open"`)
    - После обновления вызывает `broadcastTaskAssigned()` чтобы уведомить исполнителей
    - Добавлена проверка что задача существует перед обновлением

## 2026-06-02 — feat(tasks): pending/today views, tag picker, deadline edit from card

- **swarm-bot/tasks/handlers.ts**:
  - `buildMainMenuMessage()`: добавлены кнопки «⏳ На проверке» (`tk_pending`) и «📅 На сегодня» (`tk_today`) — первая строка меню
  - `/tasks` команда (handleTasks): меню синхронизировано с buildMainMenuMessage — те же 4 кнопки
  - `tk_pending` — список задач со статусом `pending`, созданных текущим пользователем; каждая задача кликабельна → `tk_pen_<taskId>`
  - `tk_pen_<taskId>` — открывает карточку задачи через `sendPendingTaskCard`
  - `tk_today` — задачи со сроком сегодня или просроченные (красный/жёлтый маркер), клик → `tk_t_<taskId>`
  - `tdue_<taskId>` — запрашивает новый дедлайн в свободной форме (из карточки pending); добавлен ПЕРЕД `tdate_` чтобы не было конфликта префиксов
  - `tctag_<taskId>` — показывает два меню: страны (Serbia/Bulgaria/Croatia/Hungary/Moldova/Romania + «Без страны») и теги (#all/#marketing/#rnd/#bd)
  - `tctagc_<taskId>:<country|none>` — устанавливает страну задачи
  - `tctagr_<taskId>:<tag>` — переключает тег (toggle): добавляет если не было, убирает если был
- **import**: добавлены `dbListPending`, `dbListToday` в импорт из `./db.ts`

## 2026-06-02 — feat(tasks): bot helpers + sendPendingTaskCard full card

- **swarm-bot/tasks/db.ts**: 
  - `dbListPending(createdBy, groupId?)` — новая задача: вернуть 20 неподтверждённых задач созданных пользователем
  - `dbListToday(telegramId, groupId?)` — вернуть задачи на сегодня для пользователя + все задачи с тегом #all; дедупликация по id
- **swarm-bot/tasks/formatter.ts**: 
  - `sendPendingTaskCard()` полностью переписана: теперь показывает страну, теги, дедлайн, 6 кнопок редактирования вместо 3
  - Исполнитель: если не назначен → "⚠️ Исполнитель не назначен"; if assigned → "👤 Исполнитель" вместо "👤 Назначить"
  - Кнопки: подтвердить + удалить (first row), исполнитель + дедлайн + страна/теги (second row)

## 2026-06-02 — feat(tasks): shared types + db layer support confirmed/createdBy/dueToday

- **types.ts**: добавлены поля `confirmed: boolean` и `created_by_telegram_id: number | null` в `Task` и `TaskInput`
- **db.ts**: 
  - `createTask()` теперь сохраняет `confirmed` (дефолт `false`) и `created_by_telegram_id` (дефолт `null`)
  - `listTasks()` расширен тремя новыми фильтрами: `confirmed`, `createdBy`, `dueToday`
  - `dueToday` возвращает задачи с `due_date <= сегодня` и `confirmed = true`
- Контракт в ARCHITECTURE.md обновлён

## 2026-06-02 — fix(security): техдолг — cron защита, MCP ownership, OpenAI retry, session TTL

- **cron-защита**: `X-Cron-Secret` header теперь обязателен для `setup_commands` / `digest_cron` / `readai_token_refresh` в swarm-bot и granola-poller. Без заголовка — 403. Секрет из env `CRON_SECRET`.
- **MCP delete_entry**: добавлен ownership check — удалить можно только свою запись (`owner_id = requesting_user_id`). Параметр `requesting_user_id` стал обязательным в схеме инструмента.
- **OpenAI retry**: экспоненциальный retry (3 попытки, задержка 500ms/1s/2s) в `chatComplete` и `getEmbedding` — падения при 429/500 больше не молчат.
- **Session TTL**: зависшая сессия теперь истекает через 30 мин (`updated_at` + проверка в `getSession`). Миграция `20260602_sessions_ttl` добавила колонку `updated_at` в таблицу `sessions`.

## 2026-06-02 — miniapp: навигация + 4 новых экрана (Фазы 0–5, frontend)

- `BottomNav`: 5 вкладок — Задачи / База / Встречи / Команда / Настройки; fixed bottom, icons из lucide-react
- `TeamScreen`: список участников воркспейса (имя, роль, рынки, аватар из инициалов)
- `KnowledgeScreen`: список записей, семантический поиск, просмотр/редактирование/удаление записи (только owner), добавление новой записи с флагом is_private
- `MeetingsScreen`: список встреч (Granola + Read.ai) с табами Все/Ожидают/Подтверждены; подтверждение встречи, редактирование тезисов, удаление
- `SettingsScreen`: профиль (role, markets), Granola (подключение/отключение + список необработанных заметок с preview/import/skip), дайджест (GPT, период 7/14/30 дней), загрузка файла, фидбек
- `types.ts`: добавлены Entry, Integration, GranolaNote
- `api.ts`: полный набор API-функций для entries, meetings, integrations, granola, feedback, digest, upload + DEV_MODE моки для всех
- fix(miniapp): порядок кнопок статуса in_progress — ← Open слева, → Done справа

## 2026-06-02 — swarm-api: entries-guard.ts — обязательный слой защиты личного хранилища

- `entries-guard.ts`: два хелпера для всех entry-endpoints в swarm-api:
  - `getEntrySecure(supabase, id, { groupId, telegramId, requireOwner? })` — одиночный доступ с тремя слоями: workspace-изоляция → visibility → ownership
  - `buildEntriesQuery(supabase, select, { groupId, telegramId })` — list-запросы с фильтрами уже встроены, нельзя случайно забыть
- `index.ts`: добавлен `withEntries(origin, fn)` — перехватывает `EntryAccessError` → правильный 404/403 автоматически
- Оба случая недоступности (не существует / приватная чужая) возвращают 404 — утечка о существовании записи исключена
- Правило закреплено в `CLAUDE.md` и `ARCHITECTURE.md` как обязательное: `supabase.from("entries")` напрямую в endpoint'ах запрещено

## 2026-06-01 — miniapp: канбан-доска задач (полная реализация)

- `KanbanBoard`: три таба (Open / In Progress / Done), одна колонка за раз, поллинг 10 сек + дозапрос при `visibilitychange`, шапка с именем пользователя
- `TaskCard`: карточка с кнопками статуса (open→in_progress, in_progress→done/open, done→in_progress), Edit, Delete с confirm
- `TaskModal`: shadcn Dialog для создания и редактирования — поля title, description, due_date, role (select: marketing/bd/rnd), country, assignee (select из /users)
- Обработка ошибок: 401 → экран «No access», 403 → экран «No workspace»
- Сборка `npm run build` → `miniapp/out/` готов к деплою на Cloudflare Pages

## 2026-06-01 — miniapp: TelegramProvider + layout

- `TelegramProvider`: вызывает `initApp()` (expand + ready) при монтировании
- `layout.tsx`: подключён TelegramProvider, заголовок "Swarm Tasks"
- `page.tsx`: заглушка, будет заменена KanbanBoard

## 2026-06-01 — miniapp: типы и API-клиент

- `src/types.ts`: Task, User, Me — зеркало типов swarm-api
- `src/lib/telegram.ts`: `getInitData()` + `initApp()` через @twa-dev/sdk
- `src/lib/api.ts`: все fetch-функции (fetchMe, fetchUsers, fetchTasks, createTask, updateTask, deleteTask) + полный DEV_MODE mock без обращений к API

## 2026-06-01 — miniapp: shadcn/ui + @twa-dev/sdk

- Инициализирован shadcn/ui (Tailwind v4 compatible): `components.json`, CSS-переменные, `src/lib/utils.ts`
- Добавлены компоненты: `button`, `card`, `dialog`, `select`, `input`, `textarea`, `label`, `badge`, `tabs`
- Установлен `@twa-dev/sdk` — обёртка над `Telegram.WebApp` для получения `initData`
- Сборка `npm run build` проходит после добавления зависимостей

## 2026-06-01 — swarm-bot: инфо о Granola и Claude Desktop в /start

- Стартовое сообщение дополнено: блок "Подключить автоматический импорт встреч" (Granola + команда подключения) и "Работать из Claude Desktop" (ссылка на /connect_claude)

## 2026-06-01 — swarm-bot: скрыть /mytoken из справки и меню

- `/mytoken` убран из `/help` и меню команд — команда работает, но не светится пользователям

## 2026-06-01 — swarm-bot: /connect_claude + доработка справки

- Новая команда `/connect_claude`: пошаговая инструкция по подключению Claude Desktop (URL сервера → добавить коннектор → создать проект)
- `/claude`: убрана ошибочная отсылка "сначала /mytoken", инструкции сокращены и структурированы без потери смысла; в конце — ссылка на `/connect_claude` если сервер ещё не подключён
- `/help`: раздел "Claude Desktop" переписан — добавлен `/connect_claude`, `/mytoken` теперь помечен как опциональный
- Меню команд бота (`setMyCommands`) обновлено

## 2026-06-01 — swarm-bot: /mytoken теперь показывает сам токен

- Баг: `/mytoken` генерировал токен, сохранял хэш и говорил "сохранён" — не отображая реальное значение `smcp_...`. Пользователь не мог настроить Claude Desktop.
- Исправлено: токен теперь выводится в ответе бота как моноширинный текст + подсказка перейти к `/claude`.
- Обновлена `docs/SETUP_CLAUDE_DESKTOP.md`: полный пошаговый гайд — `/mytoken` → Authorization header в Connectors → `/claude` для инструкций проекта + FAQ.

## 2026-06-01 — miniapp: scaffold Next.js static export

- Создан `miniapp/` — Next.js 16 + TypeScript + Tailwind CSS внутри монорепо как отдельный субпроект
- `miniapp/next.config.ts`: `output: "export"`, `images: { unoptimized: true }` — статический экспорт в `out/` для деплоя на Cloudflare Pages без сервера
- `miniapp/.env.local.example`: шаблон переменных окружения (в git); `miniapp/.env.local`: локальный конфиг (gitignored)
- `NEXT_PUBLIC_API_URL` указывает на `swarm-api` Edge Function; `NEXT_PUBLIC_DEV_MODE=true` для локальной разработки
- Сборка `npm run build` проходит, `miniapp/out/index.html` генерируется

## 2026-06-01 — База знаний: справки по Granola + бот выводит инструкции целиком

- Добавлены две справочные статьи в базу знаний: «Как добавить встречу из Granola (copy-paste)» и «Как подключить Granola через API-ключ» — покрывают вопросы «как подключить гранолу», «где взять ключ», «как импортировать встречи»
- `swarm-bot/handlers/knowledge.ts` system prompt: добавлен явный триггер для вопросов вида «как подключить / как использовать / где взять» — бот обязан сначала искать в базе через `search_knowledge`; найденную инструкцию выводить текстом целиком без пересказа и сокращений

## 2026-05-31 — swarm-api: новый Edge Function для Mini App

- `swarm-api/auth.ts`: `verifyInitData()` — официальный алгоритм Telegram (HMAC-SHA256, secret_key = HMAC("WebAppData", BOT_TOKEN)), проверка свежести auth_date
- `swarm-api/index.ts`: REST API поверх `_shared/tasks/db.ts` — `GET /me`, `GET /users`, `GET /tasks`, `GET /tasks/:id`, `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`
- Auth: `Authorization: tma <initData>` на каждый запрос; `group_id` только из проверенной личности, из тела не принимается
- CORS через `MINIAPP_ORIGIN` env; `assignee_telegram_id` → резолв в имя через `user_profiles`
- Документация: `MINIAPP_ARCHITECTURE.md` (план→факт, API контракт), `ARCHITECTURE.md`, `decisions/2026-05-31-swarm-api.md`

## 2026-05-31 — MCP-аутентификация: токен + хеш

- Миграция `20260531_mcp_auth.sql`: колонка `allowed_users.claude_mcp_token_hash`, индекс, SQL-функция `generate_mcp_token(telegram_id)` — создаёт `smcp_<uuid>`, сохраняет sha256-хеш, возвращает plaintext один раз
- `swarm-mcp/index.ts`: прослойка проверки — одна точка после разбора тела; sha256(Bearer token) → lookup → `verifiedTelegramId` → инжектируется в `args.requesting_user_id` перед dispatch
- Мягкий режим по умолчанию; `MCP_AUTH_REQUIRED=true` → жёсткий (без токена — -32001 Unauthorized)
- CORS: `Authorization` уже был в `Access-Control-Allow-Headers` — ничего не менялось
- Документация: `MCP_AUTH_FIX.md` (план→факт), `ARCHITECTURE.md`, `QUICK_REF.md`, `decisions/2026-05-31-mcp-auth.md`

## 2026-05-31 — Рефактор: единый движок задач (_shared/tasks/)

Рефактор без изменения поведения. Дублированный CRUD задач вынесен в общий движок.

- Создан `_shared/tasks/types.ts` — единственный источник типов `Task` и `TaskInput`
- Создан `_shared/tasks/db.ts` — `createTask / getTask / listTasks / updateTask / deleteTask`; принимает готовый `group_id` и исполнителей; бросает исключения; `nullsFirst:false` везде; лимит дефолт 200
- `swarm-mcp/tasks/tools.ts` стал прослойкой: резолвит `requesting_user_id→group_id` и `assignee_name` через fuzzy-матч, вызывает движок, форматирует строки для Claude
- `swarm-bot/tasks/db.ts` стал тонкой обёрткой (`dbListAllOpen` — локально, сортировка по `assignees`)
- `swarm-bot/tasks/types.ts` реэкспортирует из `_shared` — импорты в handlers.ts/formatter.ts/matcher.ts не менялись
- Три коммита: `27f1ff9`, `b723d94`, `0840a3f`
- Документация: `ARCHITECTURE.md`, `QUICK_REF.md`, `SHARED_TASKS_ENGINE.md`, `decisions/2026-05-31-shared-tasks-engine.md`

## 2026-05-30 — Фидбек: имя бота в сообщениях канала

- Добавлена env-переменная `BOT_NAME` в `handlers/feedback.ts`
- Сообщения в канале теперь начинаются с `[BOT_NAME]` — позволяет собирать фидбеки от нескольких ботов в одну общую группу
- `BOT_NAME=swarm-bot` задеплоен через `supabase secrets set`

## 2026-05-30 — Интерактивный UI, суперадмин, улучшения задач

### /superadmin — интерактивная панель управления воркспейсами

- Новая команда `/superadmin` (только для ADMIN_USER_ID) — полная inline-навигация
- Просмотр всех воркспейсов с количеством пользователей
- Создание и переименование воркспейсов
- Просмотр пользователей внутри воркспейса, детальный профиль
- Перемещение пользователей между воркспейсами
- Удаление пользователей (с серверной защитой от удаления суперадмина)
- Добавление новых пользователей по Telegram ID или @username
- Новый файл `handlers/superadmin.ts`, callback-коды с префиксом `sa_`

### Edit-in-place — сервисные сообщения не засоряют чат

- `/superadmin` и `/users` — вся навигация по кнопкам редактирует одно сообщение вместо отправки новых
- Добавлена `editInlineMessage()` в `lib/telegram.ts`
- `showProfile`, `showProfileEditMenu`, `handleUsers` принимают опциональный `messageId`

### /tasks — интерактивный браузер задач

- `/tasks` теперь показывает одно inline-меню: Мои задачи / Все задачи / Создать
- "Мои задачи" и "Все задачи" — кликабельные кнопки, навигация edit-in-place
- Детальная карточка задачи: смена статуса, удаление с подтверждением
- Callback-коды с префиксом `tk_`
- Исправлен матчинг "Мои задачи": ищет и по `assignee_telegram_ids`, и по имени из профиля
- `dbListAllOpen` теперь включает `pending`-задачи

### Назначение исполнителей задач — fuzzy matching

- GPT теперь возвращает `assignee_mention` — сырой текст упоминания из транскрипта
- Если GPT не нашёл ID → локальный fuzzy-матчинг по всем полям профиля (имя, фамилия, email, username, алиасы)
- Новая функция `findUserByMention()` в `tasks/matcher.ts`
- Новый файл `lib/name-aliases.ts` — автогенерация алиасов (уменьшительные формы, транслитерация, вариации)
- При сохранении имени/фамилии в профиле алиасы пересчитываются автоматически
- Все существующие профили бэкфиллены алиасами (Вася/Vasya/vasek для Василия и т.д.)

### Исправления

- `handleUsers`, `handleTasks`, `handleBroadcast` теперь получают `groupId` (были сломаны после воркспейсов)
- `assignUserToWorkspace` вставляет `added_by` (исправлен NOT NULL constraint)
- `dbListAllOpen` включает `pending` задачи
- Дедупликация задач в БД (43 → 27), удалены артефакты разработки

## 2026-05-29 — Воркспейсы (мультитенантность)

### Воркспейсы — изоляция данных внутри одного бота

- Новая таблица `workspaces (id TEXT PK, name TEXT, created_at)` — тенанты системы
- `allowed_users.group_id TEXT FK → workspaces.id` — каждый пользователь принадлежит одному воркспейсу
- `tasks.group_id TEXT FK → workspaces.id` — задачи изолированы по воркспейсу
- `entries.group_id` теперь получил FK на `workspaces.id` — записи базы знаний также изолированы
- Новый файл `lib/workspace.ts` — `getUserGroupId()`, `checkAllowedWithGroup()`, CRUD воркспейсов
- Новый файл `handlers/workspace.ts` — команды `/workspace list/create/add/move` (только суперадмин)
- MCP-сервер резолвит `group_id` из `requesting_user_id` — данные через Claude Desktop также изолированы
- Личные записи (`is_private=true`) привязаны к `owner_id` и переезжают с пользователем при смене воркспейса
- Read.ai webhook хардкодит `group_id = 'cee'` (один OAuth токен на один воркспейс)
- Воркспейсы: `cee` (CEE) и `other` (Other Markets)

## 2026-05-29

### Фидбек — /feedback

- Новая команда `/feedback` — двухшаговая форма: текст → опциональный скриншот
- Сохраняется в таблицу `feedback` в БД
- Пересылается в Telegram-канал (chat_id настраивается через `app_settings.feedback_channel_id`)
- Команда видна в боковом меню Telegram и в /help
- Если канал не настроен — фидбек только в БД, пользователю всё равно "принято"
- Автоматическая обработка migrate_to_chat_id — если группа стала супергруппой, бот обновляет ID в app_settings и ретраит

### Флоу встреч — тезисы перед сохранением + AI-редактирование

- **Поллер (автоматический):** кнопки изменены с "✅ В базу / 🔒 В личное / 🗑 Пропустить" на "🔍 Тезисы / 🗑 Пропустить" — нельзя сохранить встречу не увидев тезисов
- **granola-poller** (отдельная Edge Function) — обновлён аналогично
- **Preview тезисов:** добавлена кнопка "✏️ Переписать" — пользователь пишет инструкцию ("убери раздел Финансы"), GPT переписывает тезисы с учётом оригинала; итерация возможна (можно переписывать несколько раз)
- **Post-save (✏️ Тезисы в /meetings):** вместо полной замены текста теперь AI-инструкция — тот же механизм что в preview
- Добавлен `ARCHITECTURE.md` — полная документация системы (функции, БД, флоу, callback-коды, сессии)
- Обновлён `CLAUDE.md` — инструкция читать архитектуру перед изменениями и поддерживать её актуальной

## 2026-05-28

### Система распределения задач (Tasks) — разрешение исполнителей

- UserProfile расширен: добавлены поля `email` и `name_aliases`
- Новая функция `resolveAssignees()` в matcher.ts — каскадное разрешение исполнителей:
  1. Явные Telegram ID от GPT
  2. По роли + стране
  3. Только по стране
  4. Общий пул (если нет совпадений)
- Подготовка к интеграции с системой автоматического распределения задач

### Перемещение записей между личным и общим хранилищем
- `update_entry` теперь принимает `is_private: bool` — переносит запись из личного в общее и обратно
- "перенеси в общую базу", "сделай публичным", "убери в личное" — GPT вызывает `update_entry(id=..., is_private=...)`
- Защита: нельзя перенести чужую личную запись в общую базу

### Сохранение — роутинг "добавь в базу" напрямую в handleAdd
- "Добавь в базу: ..." теперь роутится в handleAdd на уровне index.ts — GPT не вызывается совсем
- Исправлено: раньше GPT вызывал search_knowledge вместо save_shared для таких сообщений
- Покрывает: "добавь в базу:", "сохрани в базу:", "занеси в базу:", "добавь в знания:"

### Сохранение — фикс ложного срабатывания TASK_KEYWORDS
- Исправлено: "Добавь в базу: [текст со словом задача]" запускало поиск задач вместо сохранения
- `TASK_KEYWORDS` теперь не проверяется если сообщение начинается с "добавь/сохрани/занеси/запомни" — это явный интент на сохранение, а не запрос задач

### Сохранение в базу знаний — публичный инструмент save_shared
- Добавлен инструмент `save_shared` — сохраняет в **общую** командную базу знаний (используется по умолчанию для "добавь в базу", "сохрани", "занеси")
- Исправлено: раньше "добавь в базу" попадало в личное хранилище — `save_private` был единственным инструментом сохранения
- `save_private` теперь срабатывает только при явном "личное", "только для меня", "приватно"

### Список встреч и поиск по стране
- Включён инструмент `list_meetings_by_country` — возвращает все встречи по стране с датой, заголовком и кратким саммари, отсортированные по убыванию даты
- `get_recent_by_country` теперь также срабатывает на "последняя встреча по X", "что было на встрече в X"
- `list_meetings_by_country` теперь фетчит только встречи и транскрипты (entry_type = transcript/meeting, source = read_ai/granola/voice)

### Личное хранилище — инструмент list_personal
- Добавлен инструмент `list_personal` — показывает **только** личные записи пользователя (`is_private = true`)
- Исправлено: раньше "Что в моём личном хранилище?" возвращало все видимые записи (публичные + личные)

### Метаданные встреч — ретегирование существующих записей
- SQL-миграция `20260528200000_backfill_entry_metadata.sql` — проставляет `entry_type` (из `source`: read_ai→transcript, granola→meeting, voice→note) и `entry_date` (из `metadata->>'entry_date'`) для всех записей где эти поля были NULL
- Granola: `entry_type` теперь авто-определяется через `extractEntryMeta()` вместо хардкода `"meeting"` — корректно работает для транскриптов в trial-режиме

### Метаданные встреч — авто-детект стран, типа и даты
- `saveEntry()` теперь вызывает `extractEntryMeta()` параллельно с `getEmbedding()` — все записи через бот получают `countries`, `entry_type`, `entry_date` автоматически
- `granola.ts`: insert теперь включает `entry_type: "meeting"`, `entry_date` (из заголовка "Дата: ..."), `countries` от GPT
- `read-ai-webhook`: insert теперь включает `entry_type: "transcript"`, `entry_date` (из `startTime`), `countries` от GPT — добавлен хелпер `extractCountries()`
- Исправлено: встречи, сохранённые через бота или Read.ai вебхук, ранее имели `NULL` в полях `countries`/`entry_type`/`entry_date` — теперь заполняются при сохранении

### Задачи — роли и умное назначение
- Добавлены роли пользователей: `marketing`, `bd`, `rnd` (в `user_profiles.role`)
- Поле `task_role` в задачах — GPT проставляет при извлечении из транскрипта
- Поля `email` и `name_aliases` в профилях — матчинг исполнителей учитывает почту и псевдонимы
- `assignee_telegram_id` → `assignee_telegram_ids[]` — задача может назначаться нескольким людям
- Каскадная резолюция: имя → роль+страна → страна → общий пул
- Несколько BD/маркетологов в одной стране — задача уходит всем сразу

## 2026-05-27

### On-demand Granola poll + фикс /digest + улучшение дайджеста по стране

- `/meetings` теперь сразу проверяет Granola на свежие встречи — не нужно ждать часового крона
- `/digest` — исправлен роутинг (команда существовала, но не обрабатывалась в index.ts)
- `get_recent_by_country`: дефолтный период 7 дней вместо 60, параллельный поиск (прямой по дате + векторный), сортировка по дате
- Дайджест использует `summary` вместо `content` — точнее и короче, лимиты контекста снижены

## 2026-05-25 — Личное хранилище (Private Space)

- Добавлены поля `is_private` / `owner_id` в таблицу `entries`
- `match_entries` RPC обновлена: принимает `requesting_user_id`, возвращает только доступные записи
- `saveEntry()` поддерживает `isPrivate` / `ownerId` параметры
- `visibilityFilter()` — единый хелпер фильтрации, используется во всех запросах
- Telegram-бот: кнопка "🔒 В личное" при сохранении встреч Granola и Read.ai
- Telegram-бот: `save_private` tool — GPT сохраняет в личное по намерению пользователя
- MCP: `add_knowledge` поддерживает `is_private` + `owner_telegram_id`
- MCP: `search_knowledge`, `list_entries`, `get_entry` принимают `requesting_user_id` для видимости личных записей
- Claude Desktop инструкции обновлены: добавлен раздел про личное хранилище

## 2026-05-25

### Granola: кнопка сохранения в личное пространство
- Автоматические уведомления Granola теперь включают кнопку «🔒 В личное» (callback `gcp_`) между «✅ В базу» и «🗑 Пропустить»
- Позволяет сохранять встречи в личное пространство прямо из уведомления

## 2026-05-23

### Фикс: /help не отвечал из-за невалидного HTML
- `<ключ>` в тексте справки ломал HTML-парсер Telegram — сообщение падало молча (sendMessage не проверяет ответ API)
- Заменено на `<code>&lt;ключ&gt;</code>`

### Документация: подключение Granola
- README.md: добавлена секция «Встречи (Granola)» — описание изоляции по пользователю, шаги подключения, автополлинг, ручной импорт
- README.md: обновлены технический стек и структура проекта (granola-poller, handlers/granola.ts)
- help.ts: в справку бота добавлена подсказка где взять API ключ (Granola → Settings → API Key)

## 2026-05-21

### Интеграция Granola (granola-poller + swarm-bot)
- `/granola` — новая команда: выбор периода (Сегодня / 7 дней / 30 дней / Свой период), показывает список заметок с кнопками «✅ В базу / 🗑 Пропустить»
- Свой период: вводишь дату текстом, GPT парсит в ISO

### Интеграция Granola (granola-poller + swarm-bot) — базовая
- Новая Edge Function `granola-poller` — каждый час поллит Granola API, находит новые заметки, шлёт уведомление в Telegram с кнопками «✅ В базу / 🗑 Пропустить»
- Новый обработчик `handlers/granola.ts` — при подтверждении тянет полную заметку (транскрипт + саммари), генерирует тезисы, сохраняет в базу знаний
- Cron job `granola-poller-hourly` — запускается каждый час (`0 * * * *`)
- Таблица `app_settings` — хранит курсор `granola_last_polled_at` чтобы не слать дубли

### Уведомления Read.ai (read-ai-webhook)
- Добавлена кнопка «🗑 Удалить» в Telegram-уведомление при получении новой встречи — удаляет запись и все связанные задачи без захода в панель.

### Загрузка файлов и управление хранилищем (swarm-mcp)
- `upload_file` — новый MCP-инструмент: загружает файл в base64 в `swarm_drive` Storage, создаёт запись в базе знаний с публичной ссылкой. Поддержка PDF, DOCX, изображений, CSV и др. Лимит ~4 MB.
- `get_storage_stats` — новый MCP-инструмент: статистика базы знаний — всего записей, файлов, разбивка по типам и источникам.
- `list_entries`: новый фильтр `has_file: true/false` — показывает только записи с файлами или только без файлов.
- `update_entry`: новые параметры `file_content_base64` + `file_name` — заменяют файл в Storage (старый удаляется автоматически).

## 2026-05-19

### Read.ai webhook: тезисы строго из транскрипта, без домыслов
- Если транскрипт доступен — GPT генерирует тезисы только из него (до 12000 символов), игнорируя Read.ai summary
- Если транскрипта нет — fallback на summary+chapters
- Промпт обновлён: "только то что реально обсуждалось, без выдумок"

### Read.ai webhook: полный транскрипт + тезисы при сохранении
- `read-ai-webhook`: добавлен `fetchFullMeeting()` — после получения вебхука делает `GET /v1/meetings/{id}` через OAuth токен и забирает полный транскрипт
- `read-ai-webhook`: GPT генерирует структурированные тезисы (`summary`) при сохранении каждой встречи — с широкими названиями секций
- `knowledge.ts` `get_recent_by_country`: переписан на векторный поиск через эмбеддинги вместо keyword SQL — больше не зависит от падежей и форм слов

### Фикс поиска: русская морфология и полный вывод тезисов
- `search_knowledge`: стемминг для длинных слов — "муравьев" → ищет и `%муравьев%` и `%муравь%`, находит все падежи
- `handleAsk`: `max_tokens` 2000 → 3500 — GPT теперь может вывести полные тезисы без обрезки

### Фикс: фильтрация sandbox:// ссылок из Claude Desktop
- `search_knowledge` и `export_entry`: `sandbox:/mnt/data/...` пути теперь игнорируются — бот не показывает их как ссылки и не блокирует экспорт файлом

### Фикс: полные тезисы в чате без обрезки
- `search_knowledge`: приоритет на `entry.summary` (полные тезисы из Claude Desktop) вместо `entry.content` (первый чанк, обрезан). Лимит отображения поднят до 4000 символов
- `export_entry`: экспортирует `entry.summary` если он полнее `entry.content`; если нет summary — собирает все чанки по `group_id` в нужном порядке
- System prompt: при запросе экспорта файлом бот сначала делает поиск (чтобы получить id), затем вызывает `export_entry`

### Поиск по базе знаний: тезисы в чате, не файлом
- System prompt: бот по умолчанию выводит содержимое прямо в сообщение; `export_entry` вызывается только если пользователь явно просит "скачать/файлом/выгрузи"
- `search_knowledge`: лимит инлайн-текста увеличен с 500 до 2500 символов — тезисы встреч влезают в сообщение без обрезки

### Поиск по базе знаний: дайджест по стране и правильный экспорт выдержки
- `knowledge.ts`: добавлен активный инструмент `get_recent_by_country(country, days=60)` — возвращает записи за последние N дней по стране; если свежих нет — показывает последние найденные
- System prompt: для "последние новости по X" используется `get_recent_by_country` (не `search_knowledge`); для "выдержка/тезисы встречи" сразу вызывается `export_entry` вместо показа урезанной версии в чате
- `swarm-mcp add_knowledge`: убран совет "если транскрипт большой, не передавай content" — теперь всегда требуется полный текст; chunking сам справится с большим объёмом

### Фикс /addtask: BUTTON_DATA_INVALID и имена исполнителей
- `tac_${taskId}:${marketName}` → `tac_${taskId}:${index}` — кириллические названия рынков превышали лимит Telegram 64 байта; теперь передаётся числовой индекс
- Обработчик `tac_` обновлён: получает индекс → делает lookup в markets[]; совместим со старыми кнопками (fallback на строку)
- `buildDisplayNameMap(ids[])` — новая функция в matcher.ts, прямой запрос `user_profiles` по списку telegram_id
- Фильтрация null-telegram_id из `allowed_users` — null в массиве ломал `.in()` запрос и давал пустой nameMap
- Кнопки исполнителей теперь показывают `first_name + last_name` из профиля

### Фикс /addtask: кнопки выбора исполнителя показывают имя и фамилию
- `tasks/matcher.ts`: добавлена функция `buildDisplayNameMap(telegramIds)` — прямой запрос `user_profiles` по списку ID, возвращает `first_name + last_name`
- `tasks/handlers.ts`: оба места построения кнопок (шаг /addtask и callback `ta_`) теперь используют `buildDisplayNameMap` вместо `buildProfileMap` + fallback через `@username`
- Если профиля нет — остаётся fallback `@username` или `ID`

### Tasks module — изолированный модуль задач
- `swarm-bot/tasks/` — новый изолированный модуль (types, db, matcher, formatter, handlers, index); удалён монолитный `handlers/tasks.ts`
- `/addtask` — пошаговый диалог: название → исполнитель (кнопками) → рынок → дедлайн
- `/tasks` — мои задачи; `/tasks все` — все с разбивкой по исполнителям; `/tasks Имя` — задачи человека
- Новый формат карточки: `📌 Название / 👤 Имя | 🌍 Рынок | 📅 до ДД.ММ` + кнопки `[✅ Готово] [🗑 Удалить] [📅 Дедлайн]`
- MCP: `add_task`, `update_task`, `delete_task` — Claude Desktop управляет задачами; `get_tasks` расширен фильтром `country`
- `/addtask` добавлен в боковое меню бота (setMyCommands)
- Schema: добавлены `description`, `source`, `country`, `assignee_telegram_id` в таблицу `tasks`
- `analyzeAndCreateTasks`: теперь заполняет `assignee_telegram_id` и `country` из транскрипта

### Schema migration: расширение tasks таблицы
- Добавлены колонки: `description` (text), `source` (text, default 'manual'), `country` (text), `assignee_telegram_id` (bigint)
- Миграция создана и задеплоена через `supabase db push`

### LLM-матчинг пользователей из транскриптов
- `analyzeAndCreateTasks`: LLM теперь получает список команды с `telegram_id` и возвращает `assignee_id` вместо строки с именем — прямой lookup по ID заменяет ненадёжный `string.includes`-матчинг. Имена в кириллице, сокращения и никнеймы теперь корректно резолвятся в профиль.

## 2026-05-14

### Фикс MCP: swarm-mcp задеплоен с --no-verify-jwt, content стал опциональным
- `swarm-mcp` передеплоен с флагом `--no-verify-jwt` — без него Claude Desktop получал 401
- `add_knowledge`: поле `content` сделано опциональным; если не передано — сохраняются тезисы (`summary`) как основной текст
- `storage.ts` (`swarm-bot`): убрана авто-экспирация сессий по 30 мин (требовала колонку `updated_at`), добавлено логирование ошибок getSession/setSession

## 2026-05-11

### Фикс рефакторинга: восстановлены session handlers для meeting_rename_ и meeting_tag_
- `handlers/meetings.ts`: добавлены обработчики `meeting_rename_` и `meeting_tag_` в `handleMeetingSessionInput`
- `meeting_rename_` — сохраняет новое название встречи после нажатия ✏️ Переименовать
- `meeting_tag_` — сохраняет теги/страны, ищет запись по `meeting_id` или прямому `id`

### Task 14: Завершение рефакторинга — чистый диспетчер index.ts
- `index.ts` переписан с 2769 строк до 247 строк — теперь только диспетчер
- Создан `handlers/help.ts` с функцией `getHelpText()`
- Все callback-обработчики делегированы в `handleTaskCallbacks`, `handleMeetingCallbacks`, `handleUserCallbacks`
- Session routing: активен только `handleMeetingSessionInput` (`meeting_title_`, `meeting_date_`, `meeting_rename_`, `meeting_tag_`); `handleTaskSessionInput` и `handleUserSessionInput` — disabled, не подключены
- Cron-триггеры (`setup_commands`, `digest_cron`, `readai_token_refresh`) остались в index.ts
- Stale meeting alert теперь использует `sendMessage` из `lib/telegram.ts` вместо прямого fetch
- 14-задачный рефакторинг завершён: вся бизнес-логика вынесена в lib/ и handlers/

### Рефакторинг swarm-bot: вынос knowledge handlers + фикс получения исходника
- Создан `handlers/knowledge.ts`: `KNOWLEDGE_TOOLS`, `KNOWLEDGE_TOOLS_DISABLED`, `executeTool`, `handleAdd`, `handleAsk`
- Фикс source text: `search_knowledge` теперь возвращает summary + хинт `[Полный текст: export_entry(id=X)]` для длинных записей (>500 символов), GPT использует хинт для вызова `export_entry`
- Удалён параметр `wants_full_text` из `search_knowledge` (инструмент больше не нужен — GPT сам решает через хинт)
- Обновлён system prompt в `handleAsk`: добавлена инструкция реагировать на хинт `[Полный текст: ...]` и не выдавать длинный текст в сообщении

## 2026-05-08

### Read.ai: подтверждение встречи перед сохранением
- `read-ai-webhook`: встреча сохраняется с `metadata.confirmed = false`, не сразу активируется
- Telegram-уведомление показывает название и дату и содержит кнопки: ✅ Сохранить / ✏️ Название / 📅 Дата
- `swarm-bot`: новые callback-обработчики `mc_`, `met_`, `med_` — подтверждение/правка названия/даты
- Новые session-обработчики `meeting_title_` и `meeting_date_` — ввод текста для правок с возвратом к кнопкам подтверждения

## 2026-05-06 (v5)

### Нормализация стран + fuzzy поиск по массиву
- `extractEntryMeta` промпт обновлён: строго короткие ISO-имена без "Republic of", "Kingdom of" и т.п.
- Новый SQL RPC `search_entries_by_country`: `ANY(countries) ILIKE '%Serbia%'` — матчит "Serbia", "Republic of Serbia", "Serbian market" и т.д.
- Structured search теперь: fuzzy RPC → exact contains → source ilike (три уровня надёжности)

## 2026-05-06 (v4)

### Фикс: countries array вместо source ilike для поиска по стране
- Structured search теперь использует `.contains("countries", ["Serbia"])` — прямой запрос к массиву стран, не к тексту source
- Source ilike остаётся как запасной (для русских названий в source)
- Добавлен последний fallback: если ВСЕ три поиска вернули пусто но страна известна → прямой запрос по countries array
- Корень бага: "[Serbia]" в списке записей — это рендеринг поля `countries`, не часть текста `source`. Source.ilike.%Serbia% никогда не работал.

## 2026-05-06 (v3)

### Фикс structured search — убран entry_type фильтр + try-catch на все поиски
- Structured search больше не фильтрует по `entry_type` — только по стране через `source.ilike` (entry_type в базе может быть неверным после extractEntryMeta)
- Все три поиска (structured, vector, keyword) обёрнуты в try-catch — ошибка OpenAI больше не убивает весь поиск

## 2026-05-06 (v2)

### Фикс keyword search — кириллица vs латиница, stopwords, больше слов
- Keyword search теперь берёт слова из ОБОИХ полей: `intent.q` (с английским от классификатора) + оригинальный вопрос → дедупликация → до 8 слов
- Убраны stopwords ("дай", "точный", "кусок", "про" и др.) — topic-слова больше не вытесняются
- Векторный поиск при `wants_full_text`: порог снижен 0.1→0.05, match_count увеличен 10→15
- Итог: "пепси" из вопроса + "pepsi" из q классификатора оба попадают в filter → `content.ilike.%pepsi%` находит "Pepsi" в транскрипте

## 2026-05-06

### wants_full_text — режим исходника и детализации
- Классификатор теперь возвращает `wants_full_text: true` для запросов "исходник/дословно/точный кусок/подробнее"
- При `wants_full_text` бот берёт `content` (полный текст) вместо `summary`, GPT цитирует дословно
- Поле `q` в классификаторе теперь включает русский И английский варианты — keyword search находит "Pepsi" по запросу "пепси"
- Страна возвращается на английском (Serbia, Bulgaria...) — надёжнее для ilike поиска по source

## 2026-05-05 (v4)

### Автотезисы при добавлении через бота
- Добавлена функция `generateSummary()` — генерирует краткие тезисы через `gpt-4o-mini` (имена, цифры, решения, даты)
- `handleAdd`: текст теперь сохраняется с тезисами, пользователь видит их сразу после сохранения
- `handleVoice`: голосовое тоже получает тезисы вместо сырой транскрипции в ответе
- Тезисы передаются в `saveEntry` как `summary` → эмбеддинг строится по ним, качество поиска выше
- Обновлено описание бота: разграничение Telegram (быстрые заметки, авто) vs Claude Desktop (большие тексты, с проверкой)

## 2026-05-05 (v3)

### Фикс семантического поиска — три параллельных стратегии
- Исправлен `.contains("countries", [...])` → заменён на `ilike` по полю `source` (надёжнее, не зависит от точного написания страны)
- Добавлен keyword-fallback: ilike по `source` и `content` по словам из запроса — работает даже если классификатор не определил country
- `max_tokens` классификатора увеличен с 80 до 150 — предотвращает обрезку JSON если модель добавляет преамбулу
- Три поиска выполняются параллельно: structured + vector + keyword → merge

## 2026-05-05 (v2)

### GPT-классификатор запросов — рефакторинг handleAsk
- Убрана вся regex-лапша (COUNTRY_LIST_RE, COUNTRY_GROUPED_RE, DIGEST_RE, isGenericList, SELF_KEYWORDS и др.)
- Добавлена `classifyQuery()` — один вызов `gpt-4o-mini` с `max_tokens:80`, возвращает JSON с интентом
- Добавлена `chatCompleteMini()` — отдельная функция с ограниченным `max_tokens` для дешёвых задач
- Удалён лишний `expandedQuery` вызов — классификатор сам уточняет запрос в поле `q`
- Убраны шумные keyword `ilike` поиски — только чистый векторный поиск
- `handleAsk` теперь: classify → route → execute. Работает с любой формулировкой

**Интенты:** `semantic_search`, `countries_list`, `entries_by_country`, `digest`, `tasks`, `bot_info`

**Токены:** classifier ~150 input + 30 output (mini). Основной ответ без лишнего expandedQuery call.

## 2026-05-05

### Мета-запросы о странах — два новых обработчика в `handleAsk`
- **"по каким странам есть транскрибации/встречи/записи?"** — прямой запрос к полю `countries` в таблице `entries`, возвращает отсортированный список стран с количеством записей. Опционально фильтрует по `entry_type` (transcript/meeting/summary/document)
- **"дай последние новости по странам"** — возвращает самую свежую запись для каждой страны с датой и кратким описанием
- Оба обработчика срабатывают до семантического поиска и не отправляют "пчелы в работе..." — мгновенный ответ

- **"а еще новости?" / "что нового?" / "дай обзор"** — общий срез базы: последние 30 записей сгруппированных по типу (транскрипции, встречи, саммари, документы, заметки) с датой, странами и кратким описанием
- Все мета-handlers теперь выставляют `clarify_ready` сессию — follow-up вопросы работают корректно

**Причина бага:** это были мета-запросы о структуре БД, а не о содержании. Семантический поиск находил записи (транскрипции), но их контент не отвечал на "по каким странам" — Claude честно говорил "нет информации".

## 2026-05-04

### GitHub Actions — автодеплой
- При каждом `git push` в `main` автоматически деплоятся все 4 функции на Supabase
- Токен хранится в GitHub Secrets (`SUPABASE_ACCESS_TOKEN`)

## 2026-04-30

### Google Drive — хранение файлов
- Голосовые, фото и документы, загруженные через бот, автоматически сохраняются в Google Drive
- Создаются подпапки по типу контента
- Ссылка на Drive сохраняется в метаданных записи

### Онбординг новых пользователей
- При первом сообщении новый пользователь получает приветственное сообщение с инструкцией

## 2026-05-02

### Тезисы — новая схема хранения знаний
- Добавлена колонка `summary` в таблицу `entries`
- Эмбеддинг строится по тезисам (не по исходнику) — точнее семантический поиск
- `saveEntry` принимает опциональный `summary`, использует его для эмбеддинга
- MCP `add_knowledge` теперь принимает `content` + `summary` (оба обязательны)
- Поиск в боте использует `summary` для контекста GPT если доступно
- Инструкции Claude Desktop обновлены: детальный формат тезисов с конкретикой, именами, числами

### Интент-детекция вместо кнопок "Добавить/Спросить"
- Убраны кнопки "📝 Добавить" и "❓ Спросить" из клавиатуры
- Любое сообщение автоматически классифицируется: `question` / `add` / `ignore`
- Команды `/add` и `/ask` остались как принудительный вариант
- Улучшена классификация: "выгрузи", "покажи", "дай", "перечисли" → всегда `question`

### Telegram меню команд
- Убрана reply-keyboard, подключено нативное меню Telegram (`setMyCommands`)
- Команды: /help, /tasks, /status, /add, /ask, /reindex, /start
- Кнопка Menu появляется в поле ввода

### Равные права пользователей
- Упразднена система admin/superadmin — все пользователи равны
- Все команды доступны любому допущенному пользователю
- Убраны проверки `if (!admin)`

### Поиск — гибридный с кросс-языковой поддержкой
- Расширение запроса через GPT: перевод на английский + синонимы перед поиском
- Эмбеддинг строится по расширенному запросу
- Параллельный keyword-поиск по стемам слов (до 4 запросов одновременно)
- `match_count` увеличен до 15
- При старте поиска бот отправляет "🔍 Ищу..." чтобы показать активность
- `/reindex` — переиндексирует все англоязычные записи с русскими ключевыми словами

### Claude Desktop — интеграция через MCP
- Файл `SETUP_CLAUDE_DESKTOP.md` с инструкцией подключения для коллег
- MCP `add_knowledge` поддерживает чанкинг длинных текстов (3000 символов с перекрытием 200)
- Параллельная генерация эмбеддингов для чанков
- Инструкции проекта: Claude сам генерирует тезисы → пользователь подтверждает → сохраняет

### Встречи — улучшения
- Кнопка "✏️ Переименовать" в карточке встречи
- Теги автоматически назначают задачи через матчинг по имени/фамилии/рынкам/email/username
- Роль убрана из матчинга тегов (вызывала ложные назначения через совпадение роли "БД")
- Уведомление в бот если Read.AI токен истёк, кнопка переподключения вместо ссылки
- Ежедневный cron через pg_cron для проактивного обновления токена Read.AI
- Алерт если встречи не поступали более 3 дней
- Вебхук read-ai-webhook задеплоен с `--no-verify-jwt` (исправлен молчаливый 401)

### Профили пользователей
- Добавлены поля "Имя" и "Фамилия" в редактирование профиля
- При редактировании поля показывается текущее значение
- Username синхронизируется и в `user_profiles`, и в `allowed_users`

### "Мои задачи" — исправлен фильтр
- Раньше исключал `pending` задачи → показывал пустой список
- Теперь показывает pending отдельным блоком с подсказкой подтвердить

### Кнопка "Подробнее" — исправлен BUTTON_DATA_INVALID
- Кнопка "Удалить" передавала два UUID (76 байт > лимит 64 байта)
- Исправлено: передаётся только `entryId`, `meetingId` берётся из базы

### Деплой — критическое правило
- Все функции деплоить только с `--no-verify-jwt` (без флага Telegram/Read.AI получают 401)

## 2026-04-28

### Персонализированный дайджест
- Команда `/digest` — генерирует персональный дайджест за 7 дней (или `/digest 30` за 30 дней)
- `/digest on` / `/digest off` — подписка на еженедельный автодайджест
- Еженедельный крон каждый понедельник 9:00 UTC через pg_cron
- Фильтрация: личные записи (по рынкам/роли/имени) + общие новости (без привязки к стране)
- Дайджесты сохраняются в `entries` с `source: "digest"` — доступны через `/ask`

### Добавление пользователей по @username
- `/users add @username` — добавляет как pending, ID резолвится автоматически при первом сообщении боту
- `telegram_id` в `allowed_users` стал nullable
- `checkAllowed` теперь матчит по username для pending-записей

### Автосинхронизация профиля из Telegram
- Имя, фамилия, username подтягиваются автоматически при каждом сообщении
- Убраны из ручного редактирования профиля
- Ручные поля: роль, рынки, email

## 2026-04-24

### Автоматическое создание задач из контента
- Любой добавленный контент (текст, голос, файл, фото, URL, встреча) → GPT извлекает задачи
- Задачи создаются со статусом `pending`, матчатся на пользователей по имени и рынкам
- Фильтрация по уровню уверенности GPT (≥ 0.7)

### Менеджмент задач — подменю
- Кнопка "📋 Задачи" → подменю: На подтверждении / Мои задачи / Все открытые / Выполненные / Экспорт
- Карточки pending-задач с кнопками: Подтвердить / Назначить / Удалить
- Кнопка "Назначить" показывает список пользователей, task_id передаётся через telegram_id (обход лимита 64 байта на кириллицу)

### MCP — полный текст записей
- `search_knowledge` возвращает до 3000 символов + подсказку `get_entry("id")` при обрезке
- Новый инструмент `get_entry(id)` — возвращает полный текст записи по ID

### Исправления MCP
- Переподключение с флагом `--no-verify-jwt` (JWT-верификация ломала коннектор Claude.ai)
