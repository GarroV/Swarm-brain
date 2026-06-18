# Редизайн веба «Рой» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать desktop-концепт «единый экран» (главный/доска/ревью встреч) на реальных данных, добить мобильные экраны до спеки хендоффа и обкатать dark mode — в едином визуальном языке уже отгруженной системы.

**Architecture:** Next.js 16 static export (Telegram Mini App), React 19, Tailwind 4 + shadcn, клиентский data-layer через `lib/api.ts` (fetch + polling). Desktop-экраны рендерятся только на `lg+` (см. `RoyApp.tsx`), мобайл не меняет каркас. Дизайн-токены уже в проде (`globals.css`), переписывать не нужно. Берём раскладку/инфоархитектуру концепта (`Swarm-brain-4/{dashboard,board,admin}.jsx`), но собираем в примитивах `roy/ui.tsx`.

**Tech Stack:** TypeScript, React 19, Next.js 16, Tailwind CSS 4, shadcn, lucide-react, `@twa-dev/sdk`.

## Global Constraints

- Ветка: вся работа от `sandbox_vas`; каждый воркстрим — своя `git worktree` (`git worktree add ../swarm-<ws> -b feat/<ws>`), merge в `sandbox_vas`. Никогда не коммитить в `main`.
- Визуальный язык: **единый**. Только Golos Text, flat-поверхности, тонкие `--line`, примитивы `roy/ui`. Запрещено вносить из прототипа: шрифт Asap, точечную текстуру фона, толстые `2px ink` рамки, sketch-режим.
- Дизайн-токены `globals.css` НЕ переписывать (совпадают с хендоффом). Менять только роевой слой/примитивы, shadcn-переменные не трогать.
- Доступ к `entries`/`tasks` — только через `lib/api.ts` (он бьёт в swarm-api, где работает `entries-guard`). Прямых запросов в Supabase из miniapp нет и не добавлять.
- Никаких миграций БД в этом скоупе. Колонку «На ревью» на доске НЕ вводим (нет статуса задач).
- Никакого нового бэкенда для встреч (Calendar read-only). Попапы/realtime — вне скоупа.
- Verify каждой задачи: `cd miniapp && npx tsc --noEmit` зелёный + (где есть UI) визуальная проверка в `npm run dev`. Коммит+пуш на каждое логически завершённое изменение. Conventional commits, без атрибуции.
- При изменении флоу/структуры — обновить `docs/MINIAPP_ARCHITECTURE.md` (и `docs/ARCHITECTURE.md` если меняется бэкенд-флоу; здесь не меняется).

---

## File Structure

**Phase 1 — фундамент**
- Modify: `miniapp/src/components/roy/ui.tsx` — радиус Input, тени, чип-радиусы (WS1)
- Modify: `miniapp/src/app/globals.css` — только если тени/радиусы заданы там (WS1)
- Review (no code change unless bug): dark-токены в `globals.css` (WS-Dark)

**Phase 2 — мобильные экраны** (каждый — отдельная задача/worktree)
- Modify: `miniapp/src/components/roy/screens/SearchScreen.tsx` — блок «Продолжить»
- Modify: `miniapp/src/components/roy/screens/AnswerScreen.tsx` — уточняющие чипы + шиммер
- Modify: `miniapp/src/components/roy/screens/TaskDetail.tsx` — «Связано из базы»
- Modify: `miniapp/src/components/roy/screens/RecordDetail.tsx` — нижняя панель действий
- Modify: `miniapp/src/components/roy/screens/MeetingDetail.tsx` — «Задачи из встречи»

**Phase 3 — desktop**
- Create: `miniapp/src/components/roy/dash/` — модульные панели главного экрана
  - `myTasks.ts` (чистая логика: группировка моих задач) + `useDashboardData.ts`
  - `PersonalTasks.tsx`, `SearchHero.tsx`, `Materials.tsx`, `MeetingsApprove.tsx`, `TeamTasks.tsx`
- Rewrite: `miniapp/src/components/roy/RoyDashboard.tsx` — 3-колоночная сборка из панелей
- Modify: `miniapp/src/components/tasks/KanbanBoard.tsx` — scope Мои/Команда/Все
- Create/Modify: `miniapp/src/components/roy/screens/MeetAdminScreen.tsx` — master-detail ревью встреч
- Modify: `miniapp/src/components/roy/RoyApp.tsx` / `nav.ts` — роут `meetAdmin`
- Modify: `miniapp/src/lib/api.ts` — хелперы фильтрации (если нужен `date_from` для материалов)

---

## Phase 1 — Фундамент (WS1 + WS-Dark)

### Task 1: Доводка роевых примитивов под пиксель хендоффа (WS1)

**Files:**
- Modify: `miniapp/src/components/roy/ui.tsx` (Input/чипы/сегмент primitives)
- Modify: `miniapp/src/app/globals.css` (только если тени там)
- Test: визуальная (нет рантайма логики)

**Interfaces:**
- Produces: ничего нового в API — только визуальные правки существующих примитивов.

- [ ] **Step 1: Прочитать текущие примитивы**
  Прочитать `roy/ui.tsx` целиком, найти роевой Input/поле поиска, Chip, Segmented, тост. Зафиксировать текущие радиусы/тени.

- [ ] **Step 2: Привести к спеке хендоффа**
  Эталон — `Swarm-brain-4/design_handoff_roy/README.md` разделы «Радиусы»/«Тени»/«Типографика»:
  - роевой Input/поле → `border-radius: 18px` (если сейчас `rounded-lg`);
  - чип/пилюля → 999px; type-tag радиус 8px, market 7px;
  - тост → `0 10px 30px rgba(0,0,0,.3)`; активный сегмент → `0 1px 4px rgba(80,60,20,.1)`;
  - таб-бар подпись → 10.5px (актив 700).
  Менять только роевой слой, не shadcn-переменные.

- [ ] **Step 3: Type-check + визуал**
  Run: `cd miniapp && npx tsc --noEmit` → без ошибок.
  Run: `npm run dev`, открыть мобильный вид — Input/чипы/сегмент совпадают с прототипом `Рой - мобильный прототип.html`.

- [ ] **Step 4: Commit**
  ```bash
  git add miniapp/src/components/roy/ui.tsx miniapp/src/app/globals.css
  git commit -m "fix(miniapp): роевые примитивы — радиус Input 18px, тени тоста/сегмента по хендоффу"
  git push origin <ветка>
  ```

### Task 2: Обкатка dark mode (WS-Dark)

**Files:**
- Modify: `miniapp/src/app/globals.css` (только если найден баг контраста)
- Test: визуальная (light + dark на ключевых экранах)

**Interfaces:**
- Produces: ничего — проверка и точечные фиксы.

- [ ] **Step 1: Прогнать dark на всех роевых экранах**
  В `npm run dev` переключить `.dark` (через DevTools или системную тему). Пройти: Search, Answer, Tasks, TaskDetail, Base, RecordDetail, Meetings, MeetingDetail, NewTask, NewEntry, Settings, Admin.

- [ ] **Step 2: Зафиксировать дефекты контраста**
  Записать каждое нечитаемое сочетание (текст/фон/границы) с экраном и токеном.

- [ ] **Step 3: Точечно починить токены/классы**
  Править только конкретные нечитаемые места. Тёмные токены уже полные (`globals.css` `.dark`) — менять только если реальный баг. Не делать массовый рестайл.

- [ ] **Step 4: Verify + commit**
  Run: `cd miniapp && npx tsc --noEmit`. Визуально перепроверить починенные экраны в обеих темах.
  ```bash
  git add miniapp/src/app/globals.css
  git commit -m "fix(miniapp): dark mode — контраст на роевых экранах"
  git push origin <ветка>
  ```

---

## Phase 2 — Мобильные экраны (WS-Mobile)

> Каждая задача независима → отдельная worktree, параллелятся. Эталон — соответствующий раздел `design_handoff_roy/README.md` + `mobile-proto-screens.jsx`. Все данные — через `lib/api.ts`. Деградация graceful, если связанных данных нет.

### Task 3: SearchScreen — блок «Продолжить»

**Files:**
- Modify: `miniapp/src/components/roy/screens/SearchScreen.tsx`
- Test: визуальная

**Interfaces:**
- Consumes: `fetchTasks`, `fetchMeetings` из `lib/api.ts`; nav `push`/`setTab` из `roy/nav`.

- [ ] **Step 1: Прочитать SearchScreen + раздел README «Search»**
  Понять текущую вёрстку (лого+аватар, hero-поле, «НЕДАВНЕЕ» чипы). Блока «Продолжить» нет.

- [ ] **Step 2: Добавить секцию «ПРОДОЛЖИТЬ» (2 карточки)**
  Под «НЕДАВНЕЕ». Карточка 1: «N задач в работе» (`fetchTasks` → status in_progress, count) → `setTab("task")`. Карточка 2: ближайшая встреча (`fetchMeetings` → ближайшая по дате) → `push({view:"meetingDetail", params:{id}})`. SectionLabel «ПРОДОЛЖИТЬ» (12/700/uppercase/ink-mute). Если данных нет — секцию не рендерить.

- [ ] **Step 3: Verify + commit**
  Run: `cd miniapp && npx tsc --noEmit`. Визуал: секция появляется при наличии данных, клики ведут куда надо.
  ```bash
  git commit -am "feat(miniapp): поиск — блок «Продолжить» (задачи в работе + ближайшая встреча)"
  git push origin <ветка>
  ```

### Task 4: AnswerScreen — уточняющие чипы + шиммер

**Files:**
- Modify: `miniapp/src/components/roy/screens/AnswerScreen.tsx`
- Test: визуальная

**Interfaces:**
- Consumes: существующий `ask`-результат (`AskResult`), nav `push`.

- [ ] **Step 1: Прочитать AnswerScreen**
  Зафиксировать: есть ли секция «Уточнить» (доп-чипы) и шиммер-плейсхолдеры в загрузке.

- [ ] **Step 2: Добить до спеки README «Answer»**
  - Загрузка: вместо/в дополнение к спиннеру — шиммер `roy-shim`: карточка ответа ~86px + 3 источника по 64px.
  - Секция «УТОЧНИТЬ»: чипы доп-вопросов из результата (если `AskResult` их содержит) или скрыть, если нет поля. Тап по чипу → новый `ask` (push answer с уточнённым запросом).

- [ ] **Step 3: Verify + commit**
  Run: `cd miniapp && npx tsc --noEmit`. Визуал: загрузка показывает шиммер; чипы уточнения работают.
  ```bash
  git commit -am "feat(miniapp): ответ — шиммер загрузки + чипы «Уточнить»"
  git push origin <ветка>
  ```

### Task 5: TaskDetail — «Связано из базы»

**Files:**
- Modify: `miniapp/src/components/roy/screens/TaskDetail.tsx`
- Test: визуальная

**Interfaces:**
- Consumes: `fetchTask(id)` (связи задачи с записями — проверить поле в `Task`/через отдельный fetch), `push({view:"record"})`.

- [ ] **Step 1: Прочитать TaskDetail + тип Task**
  Понять, есть ли у задачи связанные записи (поле `linked_entries`/аналог в `types.ts`). Если связи не хранятся — секцию показывать только когда данные есть.

- [ ] **Step 2: Добавить секцию «СВЯЗАНО ИЗ БАЗЫ»**
  Под описанием. Карточки связанных записей (TypeTag + market + заголовок). Тап → `push({view:"record", params:{id}})`. Нет связей → секции нет.

- [ ] **Step 3: Verify + commit**
  Run: `cd miniapp && npx tsc --noEmit`. Визуал на задаче со связями.
  ```bash
  git commit -am "feat(miniapp): деталь задачи — секция «Связано из базы»"
  git push origin <ветка>
  ```

### Task 6: RecordDetail — нижняя панель действий

**Files:**
- Modify: `miniapp/src/components/roy/screens/RecordDetail.tsx`
- Test: визуальная

**Interfaces:**
- Consumes: `createTask`/`addTaskFrom`-аналог, nav `setTab`/`toast`, `push`.

- [ ] **Step 1: Прочитать RecordDetail + README «RecordDetail»**
  Зафиксировать наличие закреплённой нижней панели.

- [ ] **Step 2: Добавить закреплённую панель действий**
  Снизу (sticky): «Связать» (вторичная) + «В задачу» (primary). «В задачу» создаёт задачу из записи (title = заголовок записи, link на запись), переключает на таб «Задачи» + тост «Задача создана». Использовать существующую логику создания задачи из `lib/api.ts`.

- [ ] **Step 3: Verify + commit**
  Run: `cd miniapp && npx tsc --noEmit`. Визуал: панель закреплена, «В задачу» создаёт и переключает.
  ```bash
  git commit -am "feat(miniapp): деталь записи — панель «Связать» / «В задачу»"
  git push origin <ветка>
  ```

### Task 7: MeetingDetail — «Задачи из встречи»

**Files:**
- Modify: `miniapp/src/components/roy/screens/MeetingDetail.tsx`
- Test: визуальная

**Interfaces:**
- Consumes: `fetchMeeting(id)`/связанные задачи, `push({view:"taskDetail"})`.

- [ ] **Step 1: Прочитать MeetingDetail**
  Понять, как связаны задачи со встречей (поле/отдельный fetch).

- [ ] **Step 2: Добавить секцию «ЗАДАЧИ ИЗ ВСТРЕЧИ»**
  Карточки связанных задач (точка приоритета, заголовок, market) → `push({view:"taskDetail", params:{id}})`. Нет задач → секции нет.

- [ ] **Step 3: Verify + commit**
  Run: `cd miniapp && npx tsc --noEmit`. Визуал на встрече со связанными задачами.
  ```bash
  git commit -am "feat(miniapp): деталь встречи — секция «Задачи из встречи»"
  git push origin <ветка>
  ```

---

## Phase 3 — Desktop (WS-Home → WS-Board → WS-Admin)

> Самый объёмный блок, последовательно. Эталон раскладки/контента — `Swarm-brain-4/dashboard.jsx`, `board.jsx`, `admin.jsx` (визуал НЕ копировать — собирать в `roy/ui` примитивах). Только `lg+`.

### Task 8: Чистая логика данных дашборда (TDD-кандидат)

**Files:**
- Create: `miniapp/src/components/roy/dash/myTasks.ts`
- Test: `miniapp/src/components/roy/dash/myTasks.test.ts` (если добавим node:test — см. Step 1)

**Interfaces:**
- Produces:
  - `splitByOwner(tasks: Task[], meId: string): { mine: Task[]; team: Task[] }`
  - `groupMine(mine: Task[]): { today: Task[]; week: Task[]; noDate: Task[] }`
  - `recentEntries(entries: Entry[], now: number, withinMs?: number): Entry[]` (дефолт 24ч)
  - `sortMeetingsApprovalFirst(meetings: Entry[]): Entry[]` (неподтверждённые вперёд)

- [ ] **Step 1: Решить раннер тестов**
  Проверить, есть ли в `miniapp` способ гонять unit-тесты. Если нет — использовать `node --test` через `.test.ts` скомпилированный, ИЛИ (минимально) вынести функции и проверить типами + ручной проверкой на экране. Решение: если `node --test` доступен на TS через tsx — добавить dev-скрипт; иначе верифицировать через тип-чек + поведение на экране. (Не тащить тяжёлый Jest/Vitest без нужды — YAGNI.)

- [ ] **Step 2: Написать чистые функции**
  ```ts
  // myTasks.ts — чистая логика панелей дашборда. Без React.
  import type { Task, Entry } from "@/types";

  const norm = (s: string) => (s === "progress" ? "in_progress" : s);

  export function splitByOwner(tasks: Task[], meId: string): { mine: Task[]; team: Task[] } {
    const mine: Task[] = []; const team: Task[] = [];
    for (const t of tasks) {
      const owned = (t.assignees ?? []).some((a) => a === meId);
      (owned ? mine : team).push(t);
    }
    return { mine, team };
  }

  export function groupMine(mine: Task[], todayISO: string): { today: Task[]; week: Task[]; noDate: Task[] } {
    const today: Task[] = []; const week: Task[] = []; const noDate: Task[] = [];
    const t0 = Date.parse(todayISO); const weekEnd = t0 + 7 * 86_400_000;
    for (const t of mine) {
      if (!t.due_date) { noDate.push(t); continue; }
      const due = Date.parse(t.due_date);
      if (due <= t0) today.push(t);
      else if (due <= weekEnd) week.push(t);
      else noDate.push(t);
    }
    return { today, week, noDate };
  }

  export function recentEntries(entries: Entry[], now: number, withinMs = 86_400_000): Entry[] {
    return entries
      .filter((e) => { const c = Date.parse(e.created_at ?? ""); return Number.isFinite(c) && now - c <= withinMs; })
      .sort((a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""));
  }

  export function sortMeetingsApprovalFirst(meetings: Entry[]): Entry[] {
    const confirmed = (e: Entry) => e.metadata?.confirmed === true;
    return [...meetings].sort((a, b) => Number(confirmed(a)) - Number(confirmed(b)));
  }
  ```
  > ВАЖНО: точные имена полей (`assignees`, `due_date`, `created_at`, `metadata.confirmed`, как определить `meId`) сверить с `miniapp/src/types.ts` и `RoyDashboard.tsx` (там уже есть `isConfirmed`, `norm`, `initials`). Привести в соответствие перед написанием.

- [ ] **Step 3: Тест/проверка**
  Если раннер есть: тесты на splitByOwner (мой/чужой), groupMine (граница сегодня/неделя/без срока), recentEntries (отсечка 24ч), sortMeetingsApprovalFirst (неподтв. вперёд). Иначе: `npx tsc --noEmit` + ручная сверка на экране в Task 9.

- [ ] **Step 4: Commit**
  ```bash
  git commit -am "feat(miniapp): чистая логика панелей дашборда (owner-split, группировка, 24ч, аппрув-сорт)"
  git push origin <ветка>
  ```

### Task 9: Панели главного экрана + сборка RoyDashboard (WS-Home)

**Files:**
- Create: `miniapp/src/components/roy/dash/useDashboardData.ts` (хук: fetchTasks/Meetings/Entries/AgentMeetings + me)
- Create: `dash/PersonalTasks.tsx`, `dash/SearchHero.tsx`, `dash/Materials.tsx`, `dash/MeetingsApprove.tsx`, `dash/TeamTasks.tsx`
- Rewrite: `miniapp/src/components/roy/RoyDashboard.tsx`
- Test: визуальная (`lg+`)

**Interfaces:**
- Consumes: Task 8 функции; `lib/api` fetch'и; `roy/ui` примитивы (RoyCard, TypeTag, Market, PriDot, Avatar, RoyIcon); nav `push`/`setTab`.
- Produces: `RoyDashboard` (default desktop home, `lg+`), панели как переиспользуемые компоненты.

- [ ] **Step 1: Хук данных**
  `useDashboardData()` — грузит tasks/meetings/entries/agentMeetings + `me`, отдаёт `{loading, mine, team, today, week, noDate, materials, meetingsApprovalFirst, reviewQueue}` (используя Task 8). Один источник данных для всех панелей.

- [ ] **Step 2: Панели (каждая — RoyCard со скролл-телом, шапка-кнопка «раскрыть»)**
  - `PersonalTasks` → SubHead «Сегодня»/«На неделе» + «N без срока»; шапка → `setTab("task")`.
  - `SearchHero` → поле 2px ink + spark + ⌘K + чипы; submit → `push({view:"answer",params:{query}})`.
  - `Materials` → лента `recentEntries` (иконка типа, заголовок, тип, аватар автора, «N ч»); тап → `push({view:"record"})`.
  - `MeetingsApprove` → `meetingsApprovalFirst` + `reviewQueue` сверху; бейдж «N на согласовании»; шапка → `push({view:"meetAdmin"})` (Task 11); тап по строке → деталь.
  - `TeamTasks` → `team` задачи (аватар, заголовок, статус-пилюля); шапка → `setTab("task")` (доска).
  Все — в `roy/ui` примитивах, flat, тонкие границы. Loading → `roy-shim`; empty → текст.

- [ ] **Step 3: Сборка RoyDashboard в 3 колонки**
  Грид `lg`: `grid-template-columns: 288px minmax(0,1fr) 344px; gap:16px; padding:16px`. Лево=PersonalTasks; центр=колонка [SearchHero, Materials]; право=колонка [MeetingsApprove, TeamTasks]. Сохранить контракт с `RoyApp.tsx` (`isDashboard` рендерит `RoyDashboard` на `lg+`, иначе `SearchScreen`).

- [ ] **Step 4: Verify**
  Run: `cd miniapp && npx tsc --noEmit`. Run: `npm run dev`, ширина `lg+` → 3 колонки на реальных данных; «Мои»/«Команда» разделены; материалы только за 24ч; клики по шапкам ведут на вкладки/экран админки; loading/empty корректны. Узкая ширина → остаётся `SearchScreen`.

- [ ] **Step 5: Обновить доку + commit**
  Обновить `docs/MINIAPP_ARCHITECTURE.md` (новая структура desktop home).
  ```bash
  git commit -am "feat(miniapp): desktop главный экран — 3 колонки (личные/поиск+материалы/встречи+команда)"
  git push origin <ветка>
  ```

### Task 10: Доска задач — scope Мои/Команда/Все (WS-Board)

**Files:**
- Modify: `miniapp/src/components/tasks/KanbanBoard.tsx`
- Possibly Modify: `miniapp/src/components/tasks/TasksScreen.tsx` (проброс scope в вид «Доска»)
- Test: визуальная

**Interfaces:**
- Consumes: `fetchTasks`, `splitByOwner` (Task 8), `me`.
- Produces: доска с переключателем scope; статусы-колонки = существующие.

- [ ] **Step 1: Прочитать KanbanBoard + TasksScreen**
  Понять текущие колонки/статусы и как вид «Доска» получает задачи.

- [ ] **Step 2: Добавить scope-переключатель**
  Segmented «Мои / Команда / Все» над доской. Фильтр через `splitByOwner(tasks, meId)` (Все = без фильтра). Колонки = существующие статусы (Открыто / В работе / Готово) — «На ревью» НЕ добавляем (нет статуса). Карточка: приоритет, заголовок, теги, срок, аватар/«Личное».

- [ ] **Step 3: Verify + commit**
  Run: `cd miniapp && npx tsc --noEmit`. Визуал: переключатель фильтрует доску; без миграций.
  ```bash
  git commit -am "feat(miniapp): доска задач — переключатель Мои/Команда/Все"
  git push origin <ветка>
  ```

### Task 11: Админка/ревью встреч — master-detail (WS-Admin)

**Files:**
- Create: `miniapp/src/components/roy/screens/MeetAdminScreen.tsx`
- Modify: `miniapp/src/components/roy/nav.ts` (добавить `meetAdmin` в `RoyRoute`)
- Modify: `miniapp/src/components/roy/RoyApp.tsx` (`PushScreen` → ветка `meetAdmin`)
- Test: визуальная

**Interfaces:**
- Consumes: `fetchMeetings({confirmed:false})`, `fetchAgentMeetings("awaiting_review")`, confirm/delete-эндпоинты (как в `AgentReviewQueue`/`MeetingReview`), `patchMeeting`.
- Produces: роут `{view:"meetAdmin"}`; экран master-detail.

- [ ] **Step 1: Прочитать AgentReviewQueue + MeetingReview + RoyMeetingsScreen**
  Зафиксировать существующую логику confirm/delete и формы данных встреч/черновиков.

- [ ] **Step 2: Добавить роут `meetAdmin`**
  В `nav.ts` расширить тип `RoyRoute` view-вариантом `meetAdmin`; в `RoyApp.tsx` `PushScreen` → `if (route.view === "meetAdmin") return <MeetAdminScreen />`. Шапка блока «Встречи» на дашборде (Task 9) пушит этот роут.

- [ ] **Step 3: Собрать master-detail**
  Слева: список = неподтверждённые встречи + черновики «на вычитке», аппрув-нужные сверху; статы (на согласовании/за неделю). Центр: детали выбранной (заголовок, источник, мета, AI-саммари, участники/тезисы). Справа: действия — «Согласовать» (confirm/`patchMeeting`) · «Отклонить» (delete черновика) — переиспользовать логику `AgentReviewQueue`/`MeetingReview`. Календарных конфликтов/переноса НЕТ. Всё в `roy/ui` примитивах.

- [ ] **Step 4: Verify**
  Run: `cd miniapp && npx tsc --noEmit`. Run: `npm run dev` `lg+` → список читает обе очереди; выбор показывает детали; Согласовать/Отклонить дёргают существующие эндпоинты и обновляют список.

- [ ] **Step 5: Обновить доку + commit**
  Обновить `docs/MINIAPP_ARCHITECTURE.md` (новый экран/роут `meetAdmin`).
  ```bash
  git commit -am "feat(miniapp): desktop админка встреч — master-detail ревью (неподтв. + на вычитке)"
  git push origin <ветка>
  ```

---

## Self-Review (выполнено при написании плана)

**Spec coverage:** §5 WS1→Task1; §10 WS-Dark→Task2; §9 WS-Mobile→Tasks3-7 (5 экранов); §6 WS-Home→Tasks8-9; §7 WS-Board→Task10; §8 WS-Admin→Task11. Non-goals (попапы, календарная фича, NewTask-push, Base-фильтры, junk) — задач нет осознанно (вне скоупа). ✅ покрытие полное.

**Placeholder scan:** код приведён для чистой логики (Task 8); для визуальных задач — точные файлы + контент-контракт + эталонные файлы концепта + acceptance. «Сверить имена полей с types.ts» — это инструкция верификации, не плейсхолдер (типы задаются исполнителем по реальному `types.ts`, который меняться не должен под план).

**Type consistency:** имена функций Task 8 (`splitByOwner`/`groupMine`/`recentEntries`/`sortMeetingsApprovalFirst`) используются в Tasks 9-10 консистентно. Роут `meetAdmin` объявляется в Task 11 (nav.ts) и потребляется в Task 9 (шапка блока встреч) — Task 9 должен использовать ту же строку `meetAdmin`.

**Известный риск:** точные имена полей `Task`/`Entry` (`assignees`, `due_date`, `created_at`, `metadata.confirmed`) и способ получить `meId` — первый шаг Task 8/9 сверяет с `types.ts`/`RoyDashboard.tsx`. Если расходятся — привести функции в соответствие до реализации.
