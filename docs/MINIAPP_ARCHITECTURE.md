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

> **Канонический список эндпоинтов swarm-api — в `docs/ARCHITECTURE.md` (раздел swarm-api).** Здесь — только miniapp-специфика (режимы аутентификации, структура клиента, deep-linking). Не дублируем и не переписываем перечень эндпоинтов: единый источник истины — `ARCHITECTURE.md`.

**Типы из `miniapp/src/types.ts`** (зеркалят `_shared/tasks/types.ts`) — Task (+поля Роя), Sprint, TaskDependency, DependencyType. Клиент: `miniapp/src/lib/api.ts` (fetchTasks принимает `string | TaskFilters`; sprints/dependencies CRUD; DEV_MODE mock).

**Исполнитель:** фронтенд передаёт `assignee_telegram_id: number`. swarm-api резолвит его в `{ name, telegram_id }` через `user_profiles` и передаёт движку уже готовые `assignees[]` / `assignee_telegram_ids[]`.

---

## Аутентификация — два контекста

| Контекст | Способ | Поток |
|----------|--------|-------|
| Telegram Mini App | `Authorization: tma <initData>` | фронт → `/api/*` (прокси) → swarm-api проверяет initData |
| Браузер / PWA (вариант B+) | httpOnly cookie `roj_session` (JWT) | `/login` → Telegram Login Widget → CF Function `auth/telegram` проверяет подпись → JWT в httpOnly cookie → прокси `/api/[[path]]` перекладывает cookie в `Authorization: Bearer` → swarm-api проверяет JWT |

**Почему прокси (B+):** miniapp — статика на Cloudflare Pages (нет Next API routes/middleware). httpOnly-cookie недоступна JS (защита от XSS) и не уходит cross-origin на `*.supabase.co`, поэтому CF Pages Function `functions/api/[[path]].ts` форвардит запросы на swarm-api server-side, перекладывая cookie → `Bearer`. JWT: HS256, секрет `WEB_JWT_SECRET` (общий у CF и Supabase). Login Widget подписывает данные секретом `SHA256(bot_token)` (иначе, чем Mini App).

Авторизация в обоих случаях одинакова: `telegram_id` → `allowed_users` → `group_id`. Виджет лишь подтверждает личность; доступ по-прежнему гейтится белым списком.

**`recorder_token` Mini App НЕ использует.** Персональный токен рекордера (`recorder_token_hash`, `/recordertoken`) — только для desktop-agent (`meeting-claim`/`meeting-ingest`, auth через `_shared/agent-auth.ts`). Mini App всегда ходит либо через Telegram `initData` (`tma`), либо через браузерный JWT (`Bearer`) — никогда через токен рекордера.

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
| `src/app/layout.tsx` | Корневой layout. Тема **следует за системой**: пре-гидрационный inline-скрипт вешает/снимает класс `.dark` на `<html>` по `prefers-color-scheme` (без FOUC, `suppressHydrationWarning`) и переключается вживую; токены `.dark` в `globals.css`, `dark:`-утилиты в `ui/*`. В Telegram вебвью сам выставляет `prefers-color-scheme` под тему Telegram |
| `public/manifest.webmanifest`, `public/sw.js`, `public/icon.svg` | PWA: манифест, SW (кэширует только статику, не API), иконка |

### Модуль задач (Рой)
Дефолтный вид — **«Список»** в стиле macOS Reminders (смарт-списки Сегодня/Предстоящее/Важное/Все/Готово/По рынкам, линза Мои/Все, бинарный чекбокс). Десктоп и мобайл (`RoyTasksScreen`) делят логику через `useReminderTasks` + `TaskRow` + `SmartListNav`; на десктопе смарт-списки — левый рельс, на мобайле — чипы. Виды List / Timeline / Sprint / Graph работают поверх того же `swarm-api` контракта (счётчики и линза считаются на клиенте из общего `fetchTasks`). Канбан остался только в «Спринте». Приватные задачи видны в miniapp только владельцу (фильтрация на бэкенде). PWA устанавливается на macOS: Safari → Поделиться → «Добавить в Dock».

### Десктоп-главный экран (`RoyDashboard`) — 3 колонки

**Где:** `RoyApp.tsx` рендерит `RoyDashboard` только когда `isDashboard` = desktop (`lg+`) + активна вкладка `search` + push-стек пуст. На узких экранах (`< lg`) домашняя вкладка — `SearchScreen`. Контракт named-export `RoyDashboard` не менять (его импортит `RoyApp`).

**Навигация десктопа — dashboard-центрично (без сайдбара):** левого сайдбара нет. Дашборд — десктоп-дом; его собственная шапка даёт лого и аватар → «Ещё» (карта системы/настройки/команда/админ). Разделы открываются из шапок панелей дашборда (PersonalTasks/TeamTasks → таб «Задачи», Materials → «База», MeetingsApprove → `meetAdmin`). На секции (таб ≠ `search`) сверху — тонкая строка **«← Главная»** (`setTab("search")`); push-экраны имеют свой «Назад». Мобайл — нижний `RoyTabBar` (без изменений).

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
| `useDashboardData.ts` | Единый хук данных: параллельно грузит `fetchTasks/Meetings/Entries/AgentMeetings` + **отдельно** очередь на согласовании `fetchMeetings({confirmed:false, all: me.is_admin})` (дефолтный `/meetings` приватность-фильтрован и НЕ содержит чужие pending, поэтому для админа считаем по всему воркспейсу отдельным запросом). Берёт `me` из nav. Отдаёт `{loading, mine, team, today, week, noDate, materials, pendingList, recentMeetings, pendingMeetings, reviewCount}`: `pendingList` — встречи на согласовании (админ → весь воркспейс, иначе свои), `recentMeetings` — опубликованные (`confirmed=true`), `pendingMeetings = pendingList.length`. `meId = me?.telegram_id` (если нет — все задачи в `team`, личные секции пусты). `todayISO` — **локальная** дата (`Intl.DateTimeFormat("en-CA")`), т.к. `groupMine` сравнивает как UTC-полночь. Ошибка любого fetch → `[]` (graceful) |
| `shared.tsx` | Общий каркас панелей: `DashBlock` (шапка-кнопка → раскрытие, скролл-тело, `roy-shim` loading, empty), `Row`, `SubHead`, `StatusPill`, `CountBadge`/`AccentBadge`, `fmtDate`, `initials`, `relTime`, `norm` |
| `PersonalTasks.tsx` | Лево: `groupMine` → секции «Сегодня»/«На неделе» + кнопка «+ N без срока». Шапка → `setTab("task")`. Строка → `taskDetail` |
| `SearchHero.tsx` | Центр-верх: поле (рамка `2px ink`, `spark` primary, ⌘K-kbd) + чипы быстрых запросов. Submit/чип → `push({view:"answer"})` (+`saveRecent`). Не `DashBlock` — центрированный герой |
| `Materials.tsx` | Центр-низ: `recentEntries` (24ч). Строка — иконка типа (`entryTagKey`), заголовок (`deriveEntryTitle`), `TypeTag`, аватар автора (`added_by`, если человеческое имя), `relTime`. Бейдж «N новых». Шапка → `setTab("book")`. Строка → `record` |
| `MeetingsApprove.tsx` | Право-верх: две секции (`SubHead`) — **«Требуют решения»** (`pendingList`, для админа весь воркспейс) и **«Недавние»** (`recentMeetings`, опубликованные). Бейдж «N на согласовании» = `pendingMeetings + reviewCount` (для админа = вся очередь воркспейса, совпадает с ревью «Все»). Шапка → `push({view:"meetAdmin"})`. Строка → `meetingDetail`. Кнопка «Все встречи →» → `setTab("cal")` |
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
| `more` | — | Ещё (карта системы / настройки / команда / админ) | inline `MoreScreen` в RoyApp |
| `map` | — | Карта системы (iframe на `/system-map.html`) | inline `MapScreen` в RoyApp |
| `settings` | — | Настройки | `SettingsScreen.tsx` |
| `team` | — | Команда | `TeamScreen.tsx` |
| `admin` | — | Системная админка | `AdminScreen.tsx` |

#### Экран `meetAdmin` — master-detail ревью встреч

**Файл:** `miniapp/src/components/roy/screens/MeetAdminScreen.tsx`

Три колонки (desktop):
- **Слева (300px):** объединённый список = `fetchAgentMeetings("awaiting_review")` (черновики desktop-agent, первыми) + `fetchMeetings({confirmed:false})` (неподтверждённые встречи). Стат-плашки: «на согласовании» / «черновиков».
- **Центр (flex):** детали выбранного — заголовок, источник, дата, саммари/тезисы, контент. Для entry: **inline-правка СОДЕРЖАНИЯ** (`ContentEditor` → `patchMeeting(id,{content})`) + секция **«Задачи из встречи»** (`TasksFromMeeting` → `extractTasksPreview(content)` без создания → правка/удаление/добавить Себе|В общие через `createTask({is_private})`).
- **Справа (220px):** действия — Segmented **«Общее/Личное»** (дефолт Общее) → «Согласовать/Опубликовать»; «Отклонить»; для entry — **«Не встреча → в заметки»** (`patchMeeting(id,{entry_type:"note"})`). Обновление списка/`selected` — через `onEntryUpdated`. Ошибки операций → тост.

**API-операции:**
| Действие | Entry (неподтв. встреча) | AgentMeeting (черновик) |
|----------|--------------------------|-------------------------|
| Согласовать (Общее/Личное) | `patchMeeting(id, {confirmed:true, is_private})` | `publishAgentMeeting(id, "workspace"\|"personal")` |
| Править содержание | `patchMeeting(id, {content})` | — |
| Реклассифицировать | `patchMeeting(id, {entry_type:"note"})` → уходит из очереди | — |
| Вычленить задачи | `extractTasksPreview(content)` → `createTask({is_private})` | — |
| Отклонить | `deleteMeeting(id)` (с confirm) | `deleteAgentMeeting(id)` (с confirm) |

> Бэкенд: `PATCH /meetings/:id` принимает `content`/`is_private`(+`owner_id`)/`entry_type` (swarm-api); `POST /tasks/extract { save:false }` возвращает предложения без создания.
