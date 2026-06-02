# Time + Buildin Integration Design

**Date:** 2026-06-02  
**Branch:** sandbox_vas  
**Status:** Approved, ready for implementation planning

---

## Контекст

Команда использует Time (Mattermost) как основной мессенджер и Buildin как wiki + канбан. Цель — дать Swarm Brain доступ к этим источникам: читать треды и страницы, сохранять в базу знаний, публиковать из базы обратно в Buildin.

Реализация строится под будущий рост: Mini App уже в разработке, веб-сервис возможен. Вся логика живёт в `_shared/`, REST-эндпоинты в `swarm-api/` — любой будущий клиент просто дёргает их.

---

## Архитектурный принцип

```
_shared/time/ + _shared/buildin/    ← бизнес-логика, HTTP-клиенты
swarm-api/time/ + swarm-api/buildin/ ← REST endpoints (Mini App, веб, любой клиент)
swarm-bot/handlers/time.ts + buildin.ts ← Telegram UX, тонкая обёртка
swarm-mcp/buildin/tools.ts          ← MCP-инструменты для Claude Desktop
```

Нет общей папки-свалки — каждый файл в папке своей интеграции.

---

## Конфигурация (app_settings)

| Ключ | Тип | Описание |
|------|-----|----------|
| `time_token` | string | Токен Mattermost (workspace-level, ставит суперадмин) |
| `time_channels` | JSON array | `[{ id, name, display_name }]` — список отслеживаемых каналов |
| `buildin_token` | string | Токен Buildin (workspace-level) |
| `buildin_space_id` | string | UUID пространства Buildin |

Токены хранятся только в `app_settings`, не в env-переменных. Доступ через существующий `supabase` клиент.

---

## Time (Mattermost)

### Shared-слой

**`_shared/time/client.ts`**
- `getChannelPosts(token, channelId, since, until)` — посты канала за период
- `searchChannels(token, term)` — поиск по названию среди доступных каналов
- Все ошибки — typed exceptions, никакого throw без catch

**`_shared/time/summary.ts`**
- `summarizeChannel(posts, channelName)` — GPT-саммари: участники, темы, решения
- `summarizeMultiChannel(channelSummaries)` — объединённый дайджест нескольких каналов

### swarm-api endpoints

| Endpoint | Описание |
|----------|----------|
| `GET /time/channels` | Список сохранённых каналов из `app_settings.time_channels` |
| `POST /time/summary { channel_id, period }` | Саммари одного канала |
| `POST /time/digest { period }` | Дайджест всех каналов |

### Bot UX — on-demand саммари

```
/time
  → инлайн-кнопки: [#general] [#product] [#dev] ...  (из time_channels)

User выбирает #product
  → "За какой период?" [Сегодня] [7 дней] [30 дней]

User выбирает
  → "⏳ Читаю канал..."
  → GPT-саммари
  → Показывает текст + [💾 Сохранить в базу] [🔁 Заново] [✖️ Закрыть]

User: Сохранить
  → saveEntry({ source: "time", type: "summary",
      metadata: { channel_id, channel_name, period } })
```

### Bot UX — дайджест

```
/time digest
  → "За какой период?" [Сегодня] [7 дней] [30 дней]

  → читает все каналы из time_channels
  → объединённый GPT-дайджест
  → отправляет запросившему пользователю
  → [💾 Сохранить в базу] [✖️ Закрыть]
```

Дайджест — pull-модель: только по запросу, только тому кто запросил.

**Callback-префикс:** `tm_`  
**Session action-префикс:** `time_*`

---

## Buildin

### Shared-слой

**`_shared/buildin/client.ts`**
- `getPages(token, spaceId)` — дерево страниц верхнего уровня
- `getPage(token, pageId)` — содержимое страницы (рекурсивно)
- `searchPages(token, spaceId, query)` — поиск по названию
- `createPage(token, spaceId, { title, content, parentId? })` — создать страницу
- `updatePage(token, pageId, { title?, content? })` — обновить страницу
- `getBoards(token, spaceId)` — список канбан-досок
- `getBoardState(token, boardId)` — колонки + карточки доски

**`_shared/buildin/types.ts`** — типы: `BuildinPage`, `BuildinBoard`, `BuildinCard`

### swarm-api endpoints

| Endpoint | Описание |
|----------|----------|
| `GET /buildin/pages` | Дерево страниц пространства |
| `GET /buildin/pages/:id` | Содержимое страницы |
| `POST /buildin/pages` | Создать страницу `{ title, content, parent_id? }` |
| `PATCH /buildin/pages/:id` | Обновить страницу |
| `GET /buildin/boards` | Список досок |
| `GET /buildin/boards/:id` | Состояние доски (колонки + карточки) |

### Bot UX — импорт в базу

```
/buildin import
  → дерево страниц (инлайн-кнопки, пагинация если много)
  → User выбирает страницу
  → превью содержимого
  → [💾 Импортировать в базу] [✖️ Отмена]
  → saveEntry({ source: "buildin", metadata: { page_id, page_title, url } })
```

```
/buildin board
  → список досок
  → User выбирает доску
  → показывает: колонки + количество карточек
  → [💾 Сохранить снэпшот в базу] [✖️ Закрыть]
  → saveEntry({ source: "buildin_board", type: "board_snapshot" })
```

### Bot UX — публикация из базы в Buildin

```
/buildin publish
  → "Что публиковать?"
    [Последнее саммари встречи] [Последний дайджест] [Поиск по базе]
  → User выбирает запись
  → показывает превью текста
  → "Куда в Buildin?" → пикер дерева страниц
  → [Создать новую страницу] [Обновить существующую]
  → createPage() или updatePage()
  → "✅ Опубликовано: [ссылка]"
```

### MCP-инструменты (Claude Desktop)

```typescript
buildin_read_page({ page_id })         // вернуть содержимое страницы
buildin_write_page({ title, content, parent_id?, page_id? }) // создать или обновить
buildin_search({ query })              // найти страницы по названию
buildin_get_board({ board_id })        // состояние доски
```

**Callback-префикс:** `bd_`  
**Session action-префикс:** `buildin_*`

---

## Безопасность и изоляция

### Изоляция модулей
- `time.ts` и `buildin.ts` — независимые handlers. Падение одного не влияет на остальной бот
- Каждый handler обёрнут в `try/catch` с graceful error message пользователю
- Если токен не настроен — вежливое "Интеграция не настроена, обратитесь к администратору"

### Entries через guard (обязательно)
- Любое сохранение записей — через `saveEntry()` или `buildEntriesQuery()` из `entries-guard.ts`
- Запрещено прямое `supabase.from("entries")` в новых handlers
- Privacy-флаг автоматически применяется через guard: `is_private=false OR owner_id=telegramId`

### Доступ к токенам
- `time_token` и `buildin_token` читаются из `app_settings` через существующий supabase-клиент
- Токены не передаются пользователям, не логируются, не попадают в Telegram-сообщения
- Суперадмин-команды для управления токенами защищены проверкой `ADMIN_USER_ID`

### Мутации Buildin
- При `publish` — проверять что пользователь `allowed_users` в нужном воркспейсе
- При `import` — `owner_id` устанавливается из `telegramId` запросившего

---

## Беклог реализации

### Фундамент
- **F-1** `_shared/time/client.ts` — Mattermost HTTP-клиент
- **F-2** `_shared/time/summary.ts` — GPT-саммари
- **F-3** `_shared/buildin/client.ts` + `types.ts` — Buildin HTTP-клиент
- **F-4** Суперадмин-команды: настройка токенов и списка каналов

### Time — бот
- **T-1** `/time` — on-demand саммари канала
- **T-2** `/time digest` — дайджест всех каналов
- **T-3** `swarm-api` Time endpoints (для Mini App)

### Buildin — бот + MCP
- **B-1** `/buildin import` — страницы в базу
- **B-2** `/buildin publish` — из базы в Buildin
- **B-3** `/buildin board` — снэпшот доски в базу
- **B-4** MCP: `buildin_read_page`, `buildin_write_page`, `buildin_search`, `buildin_get_board`
- **B-5** `swarm-api` Buildin endpoints (для Mini App)

### Позже
- **Z-1** Scheduled дайджест Time с broadcast в настроенный чат воркспейса
- **Z-2** Mini App: экран Time (каналы, саммари, дайджест)
- **Z-3** Mini App: экран Buildin (страницы, import/publish, доски)
- **Z-4** Holst интеграция: экспорт доски → Swarm entry

### Порядок
F-1 → F-2 → T-1 → T-2 → F-3 → B-1 → B-2 → B-4 → остальное по потребности