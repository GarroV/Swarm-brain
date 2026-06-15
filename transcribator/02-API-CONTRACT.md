# 02 — Контракт API: Swarm Meetings

Контракт между desktop-агентом и Swarm Brain — это **закон**, версионируется. Поток разнесён на два агентских вызова (claim → ingest) плюс веб-эндпоинты вычитки/публикации в `swarm-api`. Меняем только синхронно с обеими сторонами; при breaking change — новый путь функции, старый живёт до обновления всех агентов.

Точные имена полей и коды сверены по коду:
`supabase/functions/meeting-claim/index.ts`, `supabase/functions/meeting-ingest/index.ts`, `supabase/functions/swarm-api/index.ts`, `supabase/functions/_shared/agent-auth.ts`. Схема таблицы — `supabase/migrations/20260612000000_meetings.sql`.

> Транскрибация — **в облаке** (OpenAI `/v1/audio/transcriptions`, модель `whisper-1`, формат `verbose_json`). Агент шлёт **аудио**, не текст. Тезисы — GPT-4o. Шаг транскрибации сменный (теоретически локальный Whisper при появлении GPU), но контракт от этого не меняется.

---

## Аутентификация

Два разных механизма — по тому, кто вызывает.

### Агент → `meeting-claim`, `meeting-ingest`

```
Authorization: Bearer <персональный smcp_-токен>
```

- Токен персональный (тот же `smcp_`-токен, что у MCP; TTL 90 дней, выдаётся в боте через `/mytoken`).
- Сервер хэширует токен (SHA-256 hex) и ищет в `allowed_users.claude_mcp_token_hash`; берёт `telegram_id` и `group_id` **из строки токена**, не из payload. Это закрывает спуфинг личности и воркспейса. Реализация — `_shared/agent-auth.ts::verifyAgentToken → { telegramId, groupId }`.
- Истёкший/неизвестный токен → `401`.
- Это **НЕ** статический общий секрет.

### Веб → `swarm-api` (`/agent-meetings*`)

Веб-сессия роя, как у остального `swarm-api`:

```
Authorization: tma <initData>      # Telegram Mini App
Authorization: Bearer <JWT>        # веб (Login Widget, httpOnly cookie, проксируется CF Pages Function)
```

Личность — `telegram_id` из проверенной сессии; воркспейс `group_id` резолвится по `allowed_users`. Админ — `telegram_id === ADMIN_USER_ID`.

---

## 1. POST `/meeting-claim`

Шаг **до** транскрибации. Записывают все участники; перед заливкой каждый делает claim по ключу встречи. Сервер отдаёт право транскрибации первому (`decision: transcribe`), остальным — `defer`. Здесь же регистрируется записавший и сохраняются его личные пометки.

```
POST https://<project-ref>.supabase.co/functions/v1/meeting-claim
Authorization: Bearer <smcp_-токен>
Content-Type: application/json
```

### Тело запроса

```jsonc
{
  "identity_kind": "calendar",        // calendar | room | manual — обязательно
  "identity_key": "ABC123@2026-06-13",// ключ дедупа — обязательно (см. §Идентичность)
  "started_at": "2026-06-13T14:00:00+03:00",  // ISO 8601, опционально
  "ended_at":   "2026-06-13T14:47:12+03:00",  // опционально
  "title": "Синк по Болгарии",        // опционально
  "attendees": [                       // из календаря, опционально
    { "name": "Маша", "email": "m@team.com" }
  ],
  "user_notes": [                      // личные пометки записавшего, опционально
    { "ts": 312.5, "text": "дедлайн!!" },        // ts = секунды от начала встречи
    { "ts": 840.0, "text": "@Маша уточнит бюджет" }
  ],
  "agent_version": "0.1.0"             // опционально
}
```

`telegram_id` и `group_id` в теле **не передаются** — берутся из токена.

### Ответ — `200 OK`

```jsonc
{
  "meeting_id": "9f1c2a3e-...",
  "decision": "transcribe",   // transcribe | defer
  "lease_ttl_sec": 1800
}
```

- `decision: "transcribe"` — этот агент держит право; должен залить аудио в `meeting-ingest` до истечения lease (`lease_ttl_sec`, сейчас 1800 с).
- `decision: "defer"` — встречу уже взял другой; этот агент аудио **не грузит**.

### Логика дедупа на сервере

- `identity_kind = "manual"` (Telegram/кнопка резкого старта, редкие офлайн-записи) — без авто-дедупа, всегда новая встреча, всегда `decision: "transcribe"`.
- `identity_kind = "calendar" | "room"` — дедуп по `identity_key` через уникальный индекс `meetings_identity_key_uq` (`WHERE identity_kind <> 'manual'`). Кто создал строку первым — `transcribe`. Если встреча уже есть, право даётся только при свободном lease (`claim_owner IS NULL` или `lease_expires_at < now()`) и пустом `transcript`; иначе `defer`. Так перехватывается транскрибация, если первый claimer сорвался.

Записавший добавляется в `meetings.recorders` (`[{telegram_id, claimed_at, role}]`). `user_notes` сохраняются как **приватная** entry (`is_private=true`, `owner_id=записавший`, `metadata.meeting_id`, `metadata.kind="personal_notes"`), идемпотентно (повторный claim обновляет ту же entry). Сбой сохранения пометок не валит claim (best-effort).

---

## 2. POST `/meeting-ingest`

Заливка **аудио** от того, кто получил `decision: "transcribe"`. Сервер транскрибирует, сводит дорожки, генерит тезисы в черновик, уведомляет записавших. Запись в базе знаний (`entries`) здесь **не создаётся** — только на аппруве.

```
POST https://<project-ref>.supabase.co/functions/v1/meeting-ingest
Authorization: Bearer <smcp_-токен>
Content-Type: multipart/form-data
```

### Поля формы (`multipart/form-data`)

| Поле | Тип | Обязательность | Описание |
|---|---|---|---|
| `meeting_id` | text | да | id из ответа `meeting-claim` |
| `audio` | file (m4a/AAC) | да | системный звук — удалённые собеседники; `≤ 25 МБ` |
| `audio_mic` | file (m4a/AAC) | нет | микрофон владельца записи; `≤ 25 МБ`; учитывается только если `> 1 КБ` |

Лимит 25 МБ — потолок эндпоинта транскрибации OpenAI. Компактный AAC m4a даёт ~10 МБ/час; длинные встречи режутся/жмутся на стороне рекордера (это TODO). Файл больше лимита → `413`.

### Ответ — `202 Accepted`

```jsonc
{
  "ok": true,
  "meeting_id": "9f1c2a3e-...",
  "web_url": "https://swarm-brain.pages.dev/?meeting=9f1c2a3e-...",  // "" если WEB_BASE_URL не задан
  "summary_status": "processing"   // processing | skipped_human_edit
}
```

`202` отдаётся **сразу**; транскрибация и тезисы досчитываются в фоне (`EdgeRuntime.waitUntil`) — чтобы не упереться в wall-clock и не плодить дубли от retry агента.

### Что делает сервер (фон)

1. Транскрибирует `audio` (метка реплик `собеседник`) и, если есть, `audio_mic` (метка `я`) через `whisper-1` `verbose_json` → сегменты `{start, end, text, speaker}`.
2. Сводит сегменты обеих дорожек по таймстампам (`start`) → `meetings.transcript` (`{language, model, segments}`); при двух дорожках `model = "whisper-1+mic"`.
3. GPT-4o по командному шаблону тезисов → `meetings.draft_notes_md` (черновик, **в поиск не попадает**).
4. Telegram-уведомление всем записавшим (`recorders`): «Тезисы встречи готовы к вычитке» + кнопка **Открыть** (`web_url`), если задан `WEB_BASE_URL`.

### Защиты

- Заливать может **только** держатель права (`claim_owner === telegram_id из токена`); иначе `403`.
- `notes_edited_at != null` (черновик уже правил человек) → сервер **не** перетранскрибирует и не перегенерит; ответ `200` с `summary_status: "skipped_human_edit"`.
- Встреча не найдена → `404`. Пустое/отсутствующее `audio` → `400`.

---

## 3. `swarm-api`: вычитка и публикация (`/agent-meetings*`)

Веб-эндпоинты раздела «Встречи». Видимость: тот же воркспейс (`group_id`) **и** caller среди `recorders`, либо админ. Аутентификация — веб-сессия (см. выше).

### GET `/agent-meetings?status=`

Список черновиков. `status` ∈ `awaiting_review` (очередь вычитки, по умолчанию) | `in_base` (опубликованные). Отдаёт усечённый набор полей:

```jsonc
[
  {
    "id": "9f1c2a3e-...",
    "title": "Синк по Болгарии",
    "source": "desktop-agent",
    "identity_kind": "calendar",
    "started_at": "2026-06-13T14:00:00+03:00",
    "ended_at": "2026-06-13T14:47:12+03:00",
    "status": "awaiting_review",
    "draft_notes_md": "### Поставки\n- ...",
    "recorders": [{ "telegram_id": 123456789, "claimed_at": "...", "role": "transcribe" }],
    "entry_id": null,
    "created_at": "..."
  }
]
```

Не-админу добавляется фильтр `recorders @> [{telegram_id}]`. Сортировка по `started_at` убыв., лимит 50.

### GET `/agent-meetings/:id`

Полная строка встречи (транскрипт + тезисы + участники + метаданные). `404`, если не свой воркспейс или caller не среди `recorders`/не админ.

### PATCH `/agent-meetings/:id`

Правка черновика тезисов (только до публикации).

```jsonc
// тело
{ "draft_notes_md": "### Поставки\n- правленый тезис\n..." }
```

Ставит `notes_edited_at = now()` (это и блокирует перегенерацию в `meeting-ingest`). Если `status === "in_base"` → `409` («Уже опубликовано — правьте запись в базе»). Нет `draft_notes_md` в теле → `400`. Ответ — обновлённая строка.

### POST `/agent-meetings/:id/publish`

Аппрув: создаёт запись в базе знаний и привязывает её к встрече.

```jsonc
// тело
{ "base": "workspace" }   // workspace (командная) | personal (личная, по умолчанию workspace)
```

- `base: "personal"` → entry приватная (`is_private=true`, `owner_id = telegram_id`); `base: "workspace"` → командная.
- Создаёт `entries` (`entry_type: "transcript"`, `source: "desktop-agent"`, эмбеддинг тезисов через `text-embedding-3-small`, `metadata.meeting_id`), привязывает `meetings.entry_id`, ставит `status = "in_base"`.
- **Идемпотентно**: повторная публикация уже опубликованной встречи возвращает существующую запись; гонка двух параллельных публикаций разрешается гард-апдейтом (`.is("entry_id", null)`) — дубль удаляется, возвращается уже привязанная запись.
- После привязки — авто-извлечение задач из тезисов (`createMeetingTasks`: GPT-4o-mini → `createTask` с привязкой `meeting_id`, резолвом исполнителя по имени в команде, наследованием приватности). Сбой извлечения **не** валит публикацию (entry уже создан).
- Нет `draft_notes_md` → `400` («Тезисы ещё не готовы»). Успех — `201` с созданной записью (или `200` с существующей при идемпотентном повторе).

После публикации встреча уходит из очереди на вычитке у всех записавших разом, а запись становится видимой в поиске/базе знаний.

---

## Коды ошибок

| Код | Когда | Поведение агента |
|---|---|---|
| `400` | невалидный payload / нет обязательного поля (`identity_kind`, `identity_key`, `meeting_id`, `audio`, `draft_notes_md`) | лог, не ретраить (баг клиента) |
| `401` | нет/неизвестный/истёкший токен (агент) или сессия (веб) | показать ошибку; для агента — подсказать `/mytoken`, не ретраить |
| `403` | агент не держатель права транскрибации (`meeting-ingest`); у пользователя нет воркспейса | не ретраить |
| `404` | встреча не найдена / чужой воркспейс / не среди записавших | не ретраить |
| `409` | claim-конфликт без найденной встречи; PATCH уже опубликованной встречи | для claim — ретрай 1 раз; для PATCH — не ретраить |
| `413` | `audio`/`audio_mic` больше 25 МБ | нарезка/сжатие на стороне рекордера, потом ретрай |
| `429` / `5xx` | перегрузка/сбой | retry с бэкоффом: 1м, 5м, 15м, 1ч, 6ч; очередь сохраняется между перезапусками агента |

---

## Идентичность и дедуп (`identity_key`)

Приоритет ключа (что класть в `identity_key` при `meeting-claim`):

1. `calendar` — `calendar_event_id` + дата экземпляра встречи.
2. `room` — id комнаты браузерного звонка: код Google Meet или room Контур.Толк из URL вкладки.
3. `manual` — `manual:<uuid>` (Telegram/кнопка резкого старта, редкие офлайн-записи). Без авто-дедупа.

Авто-схлоп — только по точным ключам `calendar`/`room` (через `meetings_identity_key_uq`), без content-similarity. Кросс-источник (`granola`) и `manual` объединяются **вручную** в вебе (warn-at-add).

---

## Источники (переходный период)

`source = "desktop-agent"` — новый источник Swarm Meetings. Уживается со старыми (`read_ai`, `granola`) в вебе, MCP и боте. Видимость `desktop-agent` добавлена в выборки встреч: `swarm-api` GET `/meetings` и MCP `get_meetings` (`source IN (read_ai, granola, desktop-agent)`); в боте — список сохранённых (`handlers/meetings.ts`: `source IN (read_ai, voice, desktop-agent)`, причём `granola` ловится не по `source`, а веткой `entry_type IN (transcript, meeting)`). Прочие бот-выборки (`index.ts`: статистика хранилища, «последняя встреча») пока учитывают только `[read_ai, granola]` — `desktop-agent` туда ещё не добавлен (TODO покрытия). Read.ai выключаем в конце месяца; Granola работает до запуска своего софта.

---

## Версионирование

`agent_version` передаётся в `meeting-claim`. При breaking change контракта — новый путь функции (например `meeting-ingest-v2`), старый живёт до обновления всех агентов. Это соответствие закрепляет связку клиент↔сервер; код функций — истина выше этого документа при расхождении.
