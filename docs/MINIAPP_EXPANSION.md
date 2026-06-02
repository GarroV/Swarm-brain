# Mini App Expansion — Разведка и план

> Дата: 2026-06-02  
> Цель: обернуть функционал swarm-bot в UI Mini App через тонкие endpoint'ы в swarm-api.  
> Принцип: никакой новой бизнес-логики — только новые маршруты поверх уже существующего кода.

---

## 1. Что уже есть в swarm-api (v1)

| Метод | Путь | Что делает |
|-------|------|-----------|
| GET | `/me` | Профиль текущего пользователя (telegram_id, name, group_id, language) |
| GET | `/users` | Участники воркспейса с профилями (name, role, markets) |
| GET | `/tasks` | Список задач с фильтрами (status, country, assignee, mine, limit) |
| POST | `/tasks` | Создать задачу |
| GET | `/tasks/:id` | Получить одну задачу |
| PATCH | `/tasks/:id` | Обновить задачу |
| DELETE | `/tasks/:id` | Удалить задачу |

---

## 2. Полная таблица: функция → покрыта?

### Задачи

| Функция бота | В swarm-api? | Endpoint |
|-------------|-------------|---------|
| Список задач (/tasks) | ✅ GET /tasks | — |
| Создать задачу (/addtask) | ✅ POST /tasks | — |
| Просмотр задачи | ✅ GET /tasks/:id | — |
| Редактировать задачу | ✅ PATCH /tasks/:id | — |
| Удалить задачу | ✅ DELETE /tasks/:id | — |
| AI-парсинг задач из текста (analyzeAndCreateTasks) | ❌ | POST /tasks/extract — GPT разбирает текст → массив задач |

### База знаний (entries)

| Функция бота | В swarm-api? | Endpoint |
|-------------|-------------|---------|
| Добавить текст в базу (/add) | ❌ | POST /entries — сохраняет с summary + embedding |
| Семантический поиск (/ask) | ❌ | GET /search?q=... — embedding + match_entries RPC |
| Список записей | ❌ | GET /entries?source=&type=&date_from=&date_to= |
| Просмотр записи | ❌ | GET /entries/:id |
| Редактировать запись | ❌ | PATCH /entries/:id |
| Удалить запись | ❌ | DELETE /entries/:id |
| Загрузить файл | ❌ | POST /entries/upload (multipart) — Storage + entry |

### Встречи

| Функция бота | В swarm-api? | Endpoint |
|-------------|-------------|---------|
| Список встреч (/meetings) | ❌ | GET /meetings?confirmed=&limit= |
| Просмотр встречи | ❌ | GET /meetings/:id |
| Подтвердить встречу | ❌ | PATCH /meetings/:id { confirmed: true } |
| Удалить встречу | ❌ | DELETE /meetings/:id |
| Редактировать тезисы встречи | ❌ | PATCH /meetings/:id { summary } |

### Granola

| Функция бота | В swarm-api? | Endpoint |
|-------------|-------------|---------|
| Список необработанных заметок Granola | ❌ | GET /granola/notes?period=today|7d|30d |
| Тезисы по заметке | ❌ | GET /granola/notes/:id/preview |
| Сохранить заметку в базу | ❌ | POST /granola/notes/:id/import { visibility: public|private } |
| Пропустить заметку | ❌ | POST /granola/notes/:id/skip |
| Проверить подключение Granola | ❌ | GET /integrations |
| Подключить Granola | ❌ | POST /integrations/granola { api_key } |
| Отключить Granola | ❌ | DELETE /integrations/granola |

### Пользователи

| Функция бота | В swarm-api? | Endpoint |
|-------------|-------------|---------|
| Список участников воркспейса | ✅ GET /users | — |
| Обновить свой профиль (role, markets) | ❌ | PATCH /me { role, markets } |

### Дайджест

| Функция бота | В swarm-api? | Endpoint |
|-------------|-------------|---------|
| Сгенерировать дайджест (/digest) | ❌ | POST /digest { days: 7 } → { text } |

### Фидбек

| Функция бота | В swarm-api? | Endpoint |
|-------------|-------------|---------|
| Отправить фидбек (/feedback) | ❌ | POST /feedback { text, photo_url? } |

### Не актуально для Mini App (пропустить)

| Функция | Почему |
|---------|--------|
| /superadmin, /workspace | Только для ADMIN_USER_ID, не нужен UI |
| /broadcast | Telegram-специфично |
| /mytoken, /connect_claude, /claude | Для Claude Desktop, не для Mini App |
| Голос (voice → Whisper) | Telegram file API, не работает в Mini App напрямую |
| Telegram-документы (PDF, Excel через fileId) | То же — Mini App получает файлы иначе (через input[type=file]) |
| Read.ai интеграция | OAuth только через Telegram, один токен на всю группу — нет per-user flow |

---

## 3. Технически сложно (gotchas)

### Granola
- API-ключ хранится в `user_integrations.api_key` plaintext (per-user).
- При подключении — нужна валидация ключа через `GET /v1/notes?limit=1` на Granola API.
- Дедупликация через `metadata.granola_note_id` + `user_integrations.skipped_note_ids` (json-массив).
- `calendar_event` может быть undefined — дата берётся из `scheduled_start_time`.
- Весь существующий код в `handlers/granola.ts` и `granola-poller` — можно переиспользовать функции `fetchGranolaNote`, `fetchNotesSince`.

### База знаний (entries) — сохранение
- `saveEntry()` в `lib/storage.ts` вызывает GPT (generateSummary) + OpenAI embedding (getEmbedding).
- Это асинхронная операция ~1-3 сек — endpoint должен ждать или возвращать job_id.
- Для длинных текстов работает chunking (>3000 символов, overlap 200), первый чанк — главный.
- `extractEntryMeta()` (GPT) извлекает countries, entry_type, entry_date — тоже добавляет latency.

### Семантический поиск
- Вызывает `getEmbedding()` для query → Supabase RPC `match_entries()`.
- Threshold 0.35 — иногда даёт нерелевантные результаты при размытом запросе.
- Нет пагинации в RPC — `match_count` ограничивает сверху.

### Дайджест
- `generatePersonalDigest()` читает все записи воркспейса за период, фильтрует по role/markets пользователя, затем GPT генерирует текст.
- Может занять 5-15 секунд — нужен streaming или background job с polling.
- Результат дайджеста сохраняется в entries (source: "digest") — можно читать из базы.

### Upload файлов
- В боте файлы приходят через Telegram (fileId → Telegram API URL → download).
- В Mini App нужен стандартный `multipart/form-data` upload прямо в swarm-api.
- Supabase Storage уже используется (bucket `swarm_drive`), функция `uploadToStorage()` в `lib/storage.ts` готова — нужно только принять файл по-другому.

### Privacy (is_private)
- Все entries имеют `is_private` + `owner_id`.
- swarm-api использует `service_role_key` — RLS не работает. Фильтрацию нужно делать в коде: `visibilityFilter(telegram_id)` в `lib/storage.ts` → SQL фрагмент.
- При создании entry через Mini App: если `is_private=true`, обязательно ставить `owner_id=telegram_id`.

---

## 4. Готово к реализации без сюрпризов

Эти endpoint'ы — тонкие обёртки над существующим кодом, без внешних вызовов, без latency.

| Endpoint | Что оборачивает | Сложность |
|----------|----------------|----------|
| GET /entries | `supabase.from("entries").select(...)` с visibility filter | 🟢 Просто |
| GET /entries/:id | `supabase.from("entries").select().eq("id")` | 🟢 Просто |
| DELETE /entries/:id | Удалить файл из Storage если есть + delete entry | 🟢 Просто |
| PATCH /entries/:id | update content/summary/metadata | 🟢 Просто |
| GET /meetings | `entries` где source IN ("read_ai", "granola") + фильтры | 🟢 Просто |
| GET /meetings/:id | То же, один entry | 🟢 Просто |
| PATCH /meetings/:id | update confirmed/summary | 🟢 Просто |
| DELETE /meetings/:id | Delete entry | 🟢 Просто |
| GET /integrations | `user_integrations` по telegram_id | 🟢 Просто |
| DELETE /integrations/granola | Delete row в user_integrations | 🟢 Просто |
| PATCH /me | update user_profiles | 🟢 Просто |
| POST /feedback | Insert в feedback + forward в channel | 🟡 Средне |
| POST /integrations/granola | Валидация ключа + insert user_integrations | 🟡 Средне |
| GET /granola/notes | `fetchNotesSince()` из granola.ts | 🟡 Средне |
| POST /granola/notes/:id/skip | Push noteId в skipped_note_ids | 🟡 Средне |
| GET /search?q= | `getEmbedding(q)` + `match_entries()` RPC | 🟡 Средне |
| POST /entries | `saveEntry()` из storage.ts (GPT + embedding) | 🟡 Средне |
| POST /granola/notes/:id/import | `saveGranolaNote()` из granola.ts | 🟡 Средне |
| POST /digest | `generatePersonalDigest()` из digest.ts | 🔴 Медленно (~10 сек) |
| POST /entries/upload | multipart → `uploadToStorage()` → `saveEntry()` | 🔴 Нестандартный Content-Type |
| GET /granola/notes/:id/preview | GPT preview генерация | 🔴 Медленно |
| POST /tasks/extract | GPT парсинг задач из текста | 🟡 Средне |

---

## 5. Рекомендуемый порядок реализации

**Фаза 1 — база знаний (просмотр и поиск):**
GET /entries, GET /entries/:id, DELETE /entries/:id, PATCH /entries/:id, GET /search

**Фаза 2 — встречи:**
GET /meetings, GET /meetings/:id, PATCH /meetings/:id, DELETE /meetings/:id

**Фаза 3 — Granola:**
GET /integrations, POST /integrations/granola, DELETE /integrations/granola, GET /granola/notes, POST /granola/notes/:id/import, POST /granola/notes/:id/skip

**Фаза 4 — создание контента:**
POST /entries, POST /feedback, PATCH /me

**Фаза 5 — тяжёлые операции (отдельно):**
POST /digest, POST /entries/upload, POST /tasks/extract
