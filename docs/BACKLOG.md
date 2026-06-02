# Backlog

## Фичи

### Mini App — порядок кнопок статуса в карточке
В статусе `in_progress` кнопки стоят: `→ Done` слева, `← Open` справа. Нужно наоборот: возврат (← Open) слева, продвижение (→ Done) справа — логика лево=назад, право=вперёд.
- Файл: `miniapp/src/components/TaskCard.tsx`, объект `STATUS_ACTIONS.in_progress`



### Веб-интерфейс — граф знаний
Визуальный интерфейс в стиле Obsidian для всей команды. Узлы = записи, встречи, задачи, люди. Кластеры по странам (цветом). Рёбра = семантическая близость через pgvector (cosine distance, автоматически) + структурные связи (задача → встреча через `meeting_id`). Кликабельные ноды с боковой панелью.
- Стек: Next.js / SvelteKit + shadcn/ui + react-force-graph
- Бэкенд: Supabase Auth + существующие Edge Functions

---

### Дедупликация встреч Granola при нескольких участниках
Если несколько пользователей бота были на одной встрече и оба импортируют её через `/granola` — в базе появятся два дубля одной встречи. Сейчас дедупликация работает только в рамках одного пользователя (по `metadata->>granola_note_id` + `added_by_telegram_id`), но не по воркспейсу.

Варианты решения (выбрать один):
- **Проверка перед сохранением**: при `gc_` (сохранить в базу) проверять нет ли уже записи с тем же `granola_note_id` в `group_id`. Если есть — сообщить "эта встреча уже в базе, добавлена [username]" и пропустить
- **Первый выигрывает**: сохраняет тот кто первый нажал "В базу", остальным предложить пропустить автоматически
- **Слияние**: при обнаружении дубля — сравнить саммари и предложить обновить существующую запись

Нужно обсудить с командой прежде чем делать — зависит от того хотят ли люди иметь личные версии одной встречи или одну общую.

---

### Админка — управление пользователями и интеграциями
Инструмент для просмотра и управления состоянием системы без прямого SQL. Минимальный scope:
- Список пользователей (`allowed_users`): кто подключён, в каком воркспейсе, когда добавлен
- Интеграции (`user_integrations`): у кого подключена Granola, когда последний poll, есть ли ошибки
- Возможность сбросить `last_polled_at` или `skipped_note_ids` без SQL
- Добавить/удалить пользователя из `allowed_users` с выбором группы

Форм-фактор: либо Telegram-команды для суперадмина (`/admin users`, `/admin integrations`), либо простая веб-страница на swarm-api. Актуально когда пользователей станет больше 5-10.

---

## Mini App — расширение функционала

> Принцип: изменения только в `swarm-api` и `miniapp/`. Бот, mcp, `_shared` — не трогать.
>
> ⚠️ **Privacy-флаг для всех endpoint'ов `/entries`**: фильтровать по `is_private + owner_id` через `visibilityFilter()` из `lib/storage.ts`. Без этого чужие приватные записи будут видны.

### 0. Экран «Команда»

Показывает участников воркспейса: имя, роль, рынки. Только frontend — `GET /users` уже есть.
- Что меняется: **frontend** — новый экран «Команда»
- 🟢 Просто

---

### Фаза 1 — База знаний (просмотр и поиск)

#### 1.1 GET /entries — список записей

Список записей воркспейса с фильтрами по source, type, дате. ⚠️ Privacy-флаг обязателен.
- Что меняется: **backend** — `GET /entries?source=&type=&date_from=&date_to=`; **frontend** — экран «База знаний»
- 🟢 Просто

#### 1.2 GET /entries/:id — просмотр записи

Получить одну запись по ID с проверкой visibility. ⚠️ Privacy-флаг обязателен.
- Что меняется: **backend** — `GET /entries/:id`; **frontend** — экран «Запись»
- 🟢 Просто

#### 1.3 DELETE /entries/:id — удалить запись

Удалить запись (и файл из Storage если есть). Только owner может удалить — проверять `owner_id = telegram_id`.
- Что меняется: **backend** — `DELETE /entries/:id`; **frontend** — кнопка «Удалить» в карточке записи
- 🟢 Просто

#### 1.4 PATCH /entries/:id — редактировать запись

Обновить content/summary/metadata. Только owner может редактировать — проверять `owner_id = telegram_id`.
- Что меняется: **backend** — `PATCH /entries/:id`; **frontend** — экран редактирования записи
- 🟢 Просто

#### 1.5 GET /search?q= — семантический поиск

Семантический поиск по базе знаний: `getEmbedding(q)` → `match_entries()` RPC. ⚠️ Privacy-флаг обязателен.
- Что меняется: **backend** — `GET /search?q=`; **frontend** — экран «Поиск»
- 🟡 Средне (вызов getEmbedding + Supabase RPC)

---

### Фаза 2 — Встречи

#### 2.1 GET /meetings — список встреч

Список встреч воркспейса — entries где `source IN ("read_ai", "granola")` с фильтрами.
- Что меняется: **backend** — `GET /meetings?confirmed=&limit=`; **frontend** — экран «Встречи»
- 🟢 Просто

#### 2.2 GET /meetings/:id — просмотр встречи

Получить одну встречу по ID.
- Что меняется: **backend** — `GET /meetings/:id`; **frontend** — экран «Встреча»
- 🟢 Просто

#### 2.3 PATCH /meetings/:id — подтвердить / редактировать тезисы

Обновить поле `confirmed` или `summary` встречи.
- Что меняется: **backend** — `PATCH /meetings/:id { confirmed, summary }`; **frontend** — кнопка «Подтвердить» + редактирование тезисов
- 🟢 Просто

#### 2.4 DELETE /meetings/:id — удалить встречу

Удалить запись встречи.
- Что меняется: **backend** — `DELETE /meetings/:id`; **frontend** — кнопка «Удалить» в карточке встречи
- 🟢 Просто

---

### Фаза 3 — Granola

#### 3.1 GET /integrations — статус подключения

Показать подключена ли Granola у текущего пользователя (читает `user_integrations`).
- Что меняется: **backend** — `GET /integrations`; **frontend** — экран «Настройки / Интеграции»
- 🟢 Просто

#### 3.2 POST /integrations/granola — подключить Granola

Принять API-ключ, провалидировать через `GET /v1/notes?limit=1` на Granola API, сохранить в `user_integrations`.
- Что меняется: **backend** — `POST /integrations/granola { api_key }`; **frontend** — форма подключения Granola
- 🟡 Средне (внешний запрос к Granola API для валидации)

#### 3.3 DELETE /integrations/granola — отключить Granola

Удалить строку `user_integrations` для текущего пользователя.
- Что меняется: **backend** — `DELETE /integrations/granola`; **frontend** — кнопка «Отключить»
- 🟢 Просто

#### 3.4 GET /granola/notes — список необработанных заметок

Загрузить заметки Granola за период (today / 7d / 30d), отфильтровать skipped и уже импортированные. Переиспользует `fetchNotesSince()` из `granola.ts`.
- Что меняется: **backend** — `GET /granola/notes?period=today|7d|30d`; **frontend** — экран «Заметки Granola»
- 🟡 Средне (вызов fetchNotesSince + дедупликация по skipped_note_ids)

#### 3.5 GET /granola/notes/:id/preview — предпросмотр тезисов

Сгенерировать краткие тезисы по заметке через GPT перед импортом.
- Что меняется: **backend** — `GET /granola/notes/:id/preview`; **frontend** — модалка предпросмотра заметки
- 🔴 Медленно (GPT генерация тезисов, ~3–5 сек)

#### 3.6 POST /granola/notes/:id/import — сохранить заметку в базу

Импортировать заметку Granola в entries через `saveGranolaNote()`. Принять visibility.
- Что меняется: **backend** — `POST /granola/notes/:id/import { visibility: public|private }`; **frontend** — кнопка «Сохранить» + выбор видимости
- 🟡 Средне (переиспользует saveGranolaNote из granola.ts)

#### 3.7 POST /granola/notes/:id/skip — пропустить заметку

Добавить noteId в `skipped_note_ids` (JSON-массив) в `user_integrations`.
- Что меняется: **backend** — `POST /granola/notes/:id/skip`; **frontend** — кнопка «Пропустить» в списке заметок
- 🟡 Средне (обновление JSON-массива)

---

### Фаза 4 — Создание контента

#### 4.1 POST /entries — добавить текст в базу знаний

Сохранить текст: GPT-саммари + embedding через `saveEntry()`. `group_id` и `owner_id` берутся из initData, не из тела запроса.
- Что меняется: **backend** — `POST /entries`; **frontend** — форма «Добавить запись»
- 🟡 Средне (GPT + embedding, ~1–3 сек; saveEntry из storage.ts)

#### 4.2 POST /feedback — отправить фидбек

Сохранить фидбек в таблицу и переслать в Telegram-канал.
- Что меняется: **backend** — `POST /feedback { text, photo_url? }`; **frontend** — форма «Фидбек»
- 🟡 Средне (insert + Telegram forward)

#### 4.3 PATCH /me — обновить профиль

Обновить поля `role` и `markets` в `user_profiles`.
- Что меняется: **backend** — `PATCH /me { role, markets }`; **frontend** — экран «Профиль» с редактированием
- 🟢 Просто

---

### Фаза 5 — Тяжёлые операции

#### 5.1 POST /digest — сгенерировать дайджест

GPT-дайджест записей воркспейса за период, персонализированный по role/markets. Результат сохраняется в entries (source: "digest").
- Что меняется: **backend** — `POST /digest { days: 7 } → { text }`; **frontend** — экран «Дайджест» с кнопкой генерации
- 🔴 Медленно (~10 сек, `generatePersonalDigest()` из digest.ts); нужен streaming или polling по job_id

#### 5.2 POST /entries/upload — загрузить файл

Принять файл через `multipart/form-data`, загрузить в Storage (bucket `swarm_drive`), создать entry. `uploadToStorage()` из `storage.ts` готова — нужно только принять файл иначе чем в боте.
- Что меняется: **backend** — `POST /entries/upload (multipart)`; **frontend** — форма загрузки (input[type=file])
- 🔴 Нестандартный Content-Type (multipart/form-data в Deno Edge Function требует ручного парсинга)

#### 5.3 POST /tasks/extract — AI-парсинг задач из текста

GPT разбирает произвольный текст и извлекает массив задач с assignee, deadline, описанием.
- Что меняется: **backend** — `POST /tasks/extract`; **frontend** — поле ввода текста + превью извлечённых задач перед созданием
- 🟡 Средне (GPT вызов + пакетное создание задач)

---

### Задачи с другим подходом в Mini App

Функции, которые в боте не реализуемы через Mini App напрямую, но имеют альтернативный путь.

#### Голос — запись через Web Audio API

В боте: Telegram отдаёт `fileId` → скачать через Telegram File API → Whisper.  
В Mini App: доступа к `fileId` нет. Нужен `MediaRecorder` (Web Audio API) → запись прямо в браузере → blob → `POST /entries/upload`.  
- Что меняется: **frontend** — кнопка «Записать голос» + Web Audio API; **backend** — `POST /entries/upload` уже покрывает если принимает `audio/webm`
- **Отличие от бота**: нет зависимости от Telegram File API, браузер записывает сам

#### Загрузка файлов (PDF, Excel)

В боте: Telegram отдаёт `fileId` → скачать через Telegram File API.  
В Mini App: нет доступа к `fileId`. Нужен стандартный `input[type=file]` → multipart POST.  
- Что меняется: **frontend** — `input[type=file]`; **backend** — `POST /entries/upload` (покрывается Фазой 5.2)
- **Отличие от бота**: прямой upload без посредника Telegram

#### /broadcast — не реализовывать

Telegram-специфичная рассылка через Bot API. В Mini App нет доступа к Bot API, логика broadcast не имеет смысла в UI.

#### /superadmin, /workspace — не реализовывать в Mini App

Только для `ADMIN_USER_ID`. При необходимости — отдельная admin-страница вне Mini App.

#### /mytoken, /connect_claude, /claude — не реализовывать

Управление токенами для Claude Desktop. Не нужно в Mini App.

#### Read.ai интеграция — не реализовывать

OAuth только через Telegram, один токен на всю группу — нет per-user flow. Отложить до появления per-user Read.ai OAuth.

---

## Технический долг

### Безопасность
- **Защита cron-эндпоинтов** — `digest_cron`, `readai_token_refresh`, `setup_commands` принимают любой POST без аутентификации. Добавить проверку секретного токена в заголовке запроса
- **`delete_entry` в MCP без проверки владельца** — можно удалить чужую запись зная ID. Добавить ownership check перед удалением
- **`requesting_user_id` в MCP на доверии** — нет JWT-верификации вызывающего. Долгосрочно: привязать к Supabase Auth

### Надёжность
- **Retry на OpenAI** — при 429 / 500 операция падает молча. Добавить экспоненциальный retry (3 попытки) в `chatComplete` и `getEmbedding`
- **Экспирация сессий** — зависшая сессия блокирует пользователя навсегда. Добавить TTL (например, 30 мин) или `/reset` как явный escape

### Инфраструктура
- **Staging-окружение** — завести второй Supabase-проект + тестовый Telegram-бот. Схема: feature-branch → staging → main (prod)
- **Начальная схема в миграциях** — `CREATE TABLE entries`, `tasks`, `allowed_users` и др. нигде в `supabase/migrations/` нет. Нельзя поднять проект с нуля из репо. Выгрузить через `supabase db dump` и зафиксировать как `00000000_initial_schema.sql`

### Данные
- **Granola API-ключи plaintext** — хранятся в `user_integrations.api_key` без шифрования. Рассмотреть Supabase Vault или шифрование на уровне приложения
- **Файлы Storage по публичным URL** — `swarm_drive` bucket без авторизации и без срока действия ссылок. Рассмотреть signed URLs для чувствительных файлов
