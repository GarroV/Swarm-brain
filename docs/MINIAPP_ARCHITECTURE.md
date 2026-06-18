# Mini App — Архитектура

> Статус: **swarm-api готов** (2026-05-31). Следующий шаг — фронтенд Mini App.

---

## Реализованный стек

```
Telegram Mini App (фронтенд — следующий этап)
        │
        │  Authorization: tma <initData>
        ▼
swarm-api  (Supabase Edge Function)
        │  - верифицирует initData (Telegram HMAC)
        │  - резолвит telegram_id → group_id
        │  - REST CRUD для задач
        ▼
_shared/tasks/db.ts  (общий движок)
        │
        ▼
Supabase DB (service_role_key, фильтр по group_id)
```

Режим: **поллинг** (фронтенд запрашивает данные сам). Realtime, RLS и Supabase Auth bridge не нужны.

---

## API — контракт

**Базовый URL:** `https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-api`

**Заголовок аутентификации (обязателен на каждый запрос):**
```
Authorization: tma <Telegram initData>
```

**Эндпоинты v1:**

| Метод | Путь | Тело / Query | Ответ |
|-------|------|-------------|-------|
| `GET` | `/me` | — | `{ telegram_id, name, group_id, language }` |
| `GET` | `/users` | — | `User[]` |
| `GET` | `/tasks` | `?status=&country=&assignee=&mine=true&limit=&sprint_id=&tags=a,b&start_date_from/to=&due_date_from/to=` | `Task[]` (приватные видны только владельцу) |
| `GET` | `/tasks/:id` | — | `Task` (приватная чужая → 404) |
| `POST` | `/tasks` | `{ title, …, is_private?, start_date?, sprint_id?, tags?, timeline_position? }` | `Task` (201) |
| `PATCH` | `/tasks/:id` | любые поля Task + `assignee_telegram_id?` (мутация приватной не владельцем → 403) | `Task` |
| `DELETE` | `/tasks/:id` | — | 204 |
| `GET/POST` | `/tasks/:id/dependencies` | POST `{ depends_on_id, dependency_type }` (цикл→422, дубль→409) | `TaskDependency[]` / `TaskDependency` |
| `DELETE` | `/tasks/:id/dependencies/:depId` | — | 204 |
| `GET` | `/sprints` | — | `Sprint[]` |
| `POST/PATCH/DELETE` | `/sprints[/:id]` | `{ name, start_date, end_date, status? }` (только admin) | `Sprint` |
| `POST/DELETE` | `/sprints/:id/tasks` | `{ task_ids: string[] }` | `{ updated }` |

**Типы из `miniapp/src/types.ts`** (зеркалят `_shared/tasks/types.ts`) — Task (+поля Роя), Sprint, TaskDependency, DependencyType. Клиент: `miniapp/src/lib/api.ts` (fetchTasks принимает `string | TaskFilters`; sprints/dependencies CRUD; DEV_MODE mock).

**Исполнитель:** фронтенд передаёт `assignee_telegram_id: number`. swarm-api резолвит его в `{ name, telegram_id }` через `user_profiles` и передаёт движку уже готовые `assignees[]` / `assignee_telegram_ids[]`.

**HTTP-коды ошибок:**
- 401 — нет заголовка / невалидный / протухший initData / пользователь не в allowed_users
- 403 — пользователь без воркспейса (group_id = null)
- 400 — плохое тело запроса
- 404 — задача не найдена или не принадлежит воркспейсу
- 500 — внутренняя ошибка

---

## Аутентификация — два контекста

| Контекст | Способ | Поток |
|----------|--------|-------|
| Telegram Mini App | `Authorization: tma <initData>` | фронт → `/api/*` (прокси) → swarm-api проверяет initData |
| Браузер / PWA (вариант B+) | httpOnly cookie `roj_session` (JWT) | `/login` → Telegram Login Widget → CF Function `auth/telegram` проверяет подпись → JWT в httpOnly cookie → прокси `/api/[[path]]` перекладывает cookie в `Authorization: Bearer` → swarm-api проверяет JWT |

**Почему прокси (B+):** miniapp — статика на Cloudflare Pages (нет Next API routes/middleware). httpOnly-cookie недоступна JS (защита от XSS) и не уходит cross-origin на `*.supabase.co`, поэтому CF Pages Function `functions/api/[[path]].ts` форвардит запросы на swarm-api server-side, перекладывая cookie → `Bearer`. JWT: HS256, секрет `WEB_JWT_SECRET` (общий у CF и Supabase). Login Widget подписывает данные секретом `SHA256(bot_token)` (иначе, чем Mini App).

Авторизация в обоих случаях одинакова: `telegram_id` → `allowed_users` → `group_id`. Виджет лишь подтверждает личность; доступ по-прежнему гейтится белым списком.

## Безопасность

- `group_id` берётся **только** из проверенной личности (initData/JWT → telegram_id → allowed_users). Из тела запроса не принимается.
- Каждая операция с задачами скоупится по `group_id` — пользователь не может видеть или менять задачи другого воркспейса.
- Приватные задачи (`is_private`) видны только владельцу/админу; в командный бот не попадают.
- `service_role_key` только внутри swarm-api, фронтенду не передаётся.
- Веб-сессия: JWT в httpOnly Secure SameSite=Lax cookie (недоступен JS). SW не кэширует API.

---

## Переменные окружения

| Переменная | Обязательная | Описание |
|-----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | да | уже есть (Supabase + CF Pages) |
| `MINIAPP_ORIGIN` | рекомендуется | CORS origin Mini App (напр. `https://t.me`) |
| `INITDATA_MAX_AGE` | нет | свежесть initData в секундах (дефолт 86400) |
| `WEB_JWT_SECRET` | для веб-входа | подпись веб-сессий (одинаковый в Supabase secrets и CF Pages env) |
| `SWARM_API_URL` | CF Pages | цель прокси `functions/api/[[path]]` → swarm-api |
| `NEXT_PUBLIC_BOT_USERNAME` | CF Pages build | username бота для Login Widget (`swarm_brain_bot`) |
| `NEXT_PUBLIC_API_URL` | CF Pages build | `/api` (прокси same-origin) |

---

## Деплой

```bash
supabase secrets set MINIAPP_ORIGIN=https://t.me   # или нужный origin
supabase functions deploy swarm-api --no-verify-jwt
```

---

## Фронтенд Mini App — реализован (2026-06-01)

**Расположение:** `miniapp/`
**Деплой:** Cloudflare Pages — build command `npm run build`, output dir `out`
**Локальная разработка:** `cd miniapp && npm run dev` (с `NEXT_PUBLIC_DEV_MODE=true` в `.env.local`)

### Стек
- Next.js 16, `output: 'export'`, TypeScript
- Tailwind CSS v4 + shadcn/ui
- `@twa-dev/sdk` → `Telegram.WebApp.initData`
- Plain fetch + useEffect (поллинг 10 сек + visibilitychange)

### Ключевые файлы
| Файл | Назначение |
|------|-----------|
| `src/lib/api.ts` | Все запросы к swarm-api + DEV_MODE mock (tasks, sprints, dependencies) |
| `src/lib/telegram.ts` | getInitData, initApp |
| `src/lib/timeline.ts` | Чистые утилиты Gantt (date↔px, шкала, геометрия баров). `statusColor` (oklch) больше не используется — палитра баров берётся из токенов «Рой» (`STATUS_META`) |
| `src/lib/smartLists.ts` | Чистая логика смарт-списков в стиле Reminders: `filterTasks`/`countLists`/`groupByMarket`, линза Мои/Все, списки Сегодня·Предстоящее·Важное·Все·Готово·По рынкам |
| `src/components/tasks/TasksScreen.tsx` | Обёртка с переключателем видов: Список / Таймлайн / Спринт / Граф |
| `src/components/tasks/RemindersTasks.tsx` | Вид «Список» (десктоп): рельс смарт-списков + спокойный чек-лист (Reminders), инлайн быстрое добавление, `TaskModal` |
| `src/components/tasks/useReminderTasks.ts` | Общий хук вида «Список» (десктоп+мобайл): загрузка/поллинг, линза, активный список, оптимистичные toggle/удаление/quick-add |
| `src/components/tasks/TaskRow.tsx` | Строка чек-листа: крупный чекбокс, чипы рынок/срок (красный при просрочке)/важное, аватар |
| `src/components/tasks/SmartListNav.tsx` | Навигация по смарт-спискам: рельс (десктоп) / чипы (мобайл) |
| `src/components/tasks/LensToggle.tsx` | Переключатель линзы Мои/Все |
| `src/components/tasks/TimelineView.tsx` | Вид «Таймлайн»: Gantt на дизайн-системе «Рой», drag/resize баров (pointer capture); клик без сдвига (порог 4px) и чипы «без срока» открывают `TaskModal` |
| `src/components/tasks/SprintBoard.tsx` | Вид «Спринт»: Kanban с нативным DnD, селектор спринтов, прогресс (единственный канбан после ухода «Доски») |
| `src/components/tasks/DependencyGraph.tsx` | Вид «Граф»: SVG слоистый граф зависимостей |
| `src/components/TaskCard.tsx` | Карточка задачи + кнопки статуса |
| `src/components/TaskModal.tsx` | Создание/редактирование задачи |
| `src/components/ServiceWorkerRegister.tsx` | Регистрация SW (PWA) |
| `public/manifest.webmanifest`, `public/sw.js`, `public/icon.svg` | PWA: манифест, SW (кэширует только статику, не API), иконка |

### Модуль задач (Рой)
Дефолтный вид — **«Список»** в стиле macOS Reminders (смарт-списки Сегодня/Предстоящее/Важное/Все/Готово/По рынкам, линза Мои/Все, бинарный чекбокс). Десктоп и мобайл (`RoyTasksScreen`) делят логику через `useReminderTasks` + `TaskRow` + `SmartListNav`; на десктопе смарт-списки — левый рельс, на мобайле — чипы. Виды List / Timeline / Sprint / Graph работают поверх того же `swarm-api` контракта (счётчики и линза считаются на клиенте из общего `fetchTasks`). Канбан остался только в «Спринте». Приватные задачи видны в miniapp только владельцу (фильтрация на бэкенде). PWA устанавливается на macOS: Safari → Поделиться → «Добавить в Dock».

### Десктоп-главный экран (`RoyDashboard`) — 3 колонки

**Где:** `RoyApp.tsx` рендерит `RoyDashboard` только когда `isDashboard` = desktop (`lg+`) + активна вкладка `search` + push-стек пуст. На узких экранах (`< lg`) домашняя вкладка — `SearchScreen`. Контракт named-export `RoyDashboard` не менять (его импортит `RoyApp`).

**Раскладка** (`grid`, `gap:16px`, `padding:16px`):
```
gridTemplateColumns: minmax(260px,288px)  minmax(0,1fr)  minmax(300px,344px)
   ├─ Лево            ├─ Центр (колонка)          └─ Право (колонка)
   PersonalTasks      [SearchHero, Materials]       [MeetingsApprove, TeamTasks]
```
`minmax(0,1fr)` у центра — чтобы длинные строки не распирали грид. На случай узкого рендера колонки имеют min-width и складываются (graceful, отдельного мобильного фолбэка внутри нет — на мобайле экран не рендерится).

**Модуль `src/components/roy/dash/`:**
| Файл | Назначение |
|------|-----------|
| `myTasks.ts` | Чистые хелперы (без React): `splitByOwner(tasks, meId)`, `groupMine(mine, todayISO)`, `recentEntries(entries, now)`, `sortMeetingsApprovalFirst(meetings)` |
| `useDashboardData.ts` | Единый хук данных: параллельно грузит `fetchTasks/Meetings/Entries/AgentMeetings`, берёт `me` из nav, прогоняет через хелперы. Отдаёт `{loading, mine, team, today, week, noDate, materials, meetingsApprovalFirst, pendingMeetings, reviewCount}`. `meId = me?.telegram_id` (если нет — все задачи в `team`, личные секции пусты). `todayISO` — **локальная** дата (`Intl.DateTimeFormat("en-CA")`), т.к. `groupMine` сравнивает как UTC-полночь. Ошибка любого fetch → `[]` (graceful) |
| `shared.tsx` | Общий каркас панелей: `DashBlock` (шапка-кнопка → раскрытие, скролл-тело, `roy-shim` loading, empty), `Row`, `SubHead`, `StatusPill`, `CountBadge`/`AccentBadge`, `fmtDate`, `initials`, `relTime`, `norm` |
| `PersonalTasks.tsx` | Лево: `groupMine` → секции «Сегодня»/«На неделе» + кнопка «+ N без срока». Шапка → `setTab("task")`. Строка → `taskDetail` |
| `SearchHero.tsx` | Центр-верх: поле (рамка `2px ink`, `spark` primary, ⌘K-kbd) + чипы быстрых запросов. Submit/чип → `push({view:"answer"})` (+`saveRecent`). Не `DashBlock` — центрированный герой |
| `Materials.tsx` | Центр-низ: `recentEntries` (24ч). Строка — иконка типа (`entryTagKey`), заголовок (`deriveEntryTitle`), `TypeTag`, аватар автора (`added_by`, если человеческое имя), `relTime`. Бейдж «N новых». Шапка → `setTab("book")`. Строка → `record` |
| `MeetingsApprove.tsx` | Право-верх: `meetingsApprovalFirst` (неподтв. первыми). Бейдж «N на согласовании» = `pendingMeetings + reviewCount`. Шапка → `push({view:"meetAdmin"})`. Строка → `meetingDetail` |
| `TeamTasks.tsx` | Право-низ: `team` (незавершённые) — аватар исполнителя (`assignees[0]`), заголовок, `StatusPill`. Шапка → `setTab("task")`. Строка → `taskDetail` |

**Иконки:** в `icons.tsx` добавлен `team` (люди) для шапки «Задачи команды».

**Автор записи для аватара:** берётся из `Entry.added_by` (строка-имя). Если там сырой `telegram_id` (только цифры) или пусто — аватар не показываем (graceful, отдельного поля автора в `Entry` нет).

### Финальная проверка авторизации
DEV_MODE проверяет только UI/логику. Реальный `initData` и авторизацию
проверяй только открыв приложение из Telegram.

---

### Навигация «Рой» — push-роуты (`RoyRoute`)

Корневые табы: `search` · `task` · `book` · `cal` (определены в `ui.tsx:ROY_TABS`).
Push-стек управляется `RoyApp.tsx`: `push(route)` → `PushScreen` рендерит нужный экран.

| `view` | Параметры | Экран | Файл |
|--------|-----------|-------|------|
| `answer` | `{ query: string }` | RAG-ответ | `screens/AnswerScreen.tsx` |
| `record` | `{ id: string }` | Детали записи агента | `screens/RecordDetail.tsx` |
| `taskDetail` | `{ id: string }` | Детали задачи | `screens/TaskDetail.tsx` |
| `newTask` | `{ id?: string }` | Создание/редактирование задачи | `screens/NewTask.tsx` |
| `newEntry` | — | Новая запись в базу | `screens/NewEntry.tsx` |
| `meetingDetail` | `{ id: string }` | Детали встречи (Entry) | `screens/MeetingDetail.tsx` |
| `meetingReview` | `{ id: string }` | Вычитка черновика AgentMeeting | `MeetingReview.tsx` |
| `meetAdmin` | — | **Desktop-ревью встреч (master-detail)** | `screens/MeetAdminScreen.tsx` |
| `more` | — | Ещё (настройки / команда / админ) | inline `MoreScreen` в RoyApp |
| `settings` | — | Настройки | `SettingsScreen.tsx` |
| `team` | — | Команда | `TeamScreen.tsx` |
| `admin` | — | Системная админка | `AdminScreen.tsx` |

#### Экран `meetAdmin` — master-detail ревью встреч

**Файл:** `miniapp/src/components/roy/screens/MeetAdminScreen.tsx`

Три колонки (desktop):
- **Слева (300px):** объединённый список = `fetchAgentMeetings("awaiting_review")` (черновики desktop-agent, первыми) + `fetchMeetings({confirmed:false})` (неподтверждённые встречи). Стат-плашки: «на согласовании» / «черновиков».
- **Центр (flex):** детали выбранного — заголовок, источник, дата, саммари/тезисы, контент.
- **Справа (220px):** действия — «Согласовать/Опубликовать» и «Отклонить».

**API-операции:**
| Действие | Entry (неподтв. встреча) | AgentMeeting (черновик) |
|----------|--------------------------|-------------------------|
| Согласовать | `patchMeeting(id, {confirmed:true})` | `publishAgentMeeting(id, "workspace")` |
| Отклонить | `deleteMeeting(id)` | `deleteAgentMeeting(id)` |
