# «Доска» → Reminders-список (Direction C)

> Дата: 2026-06-18 · Ветка: `sandbox_vas` · Статус: согласовано, в работе

## Цель

Заменить kanban-вид «Доска» в задачах Рой на спокойный чек-лист в стиле macOS Reminders
(Direction C из `design_handoff_roy/tasks-directions.jsx`). Заодно убрать дублирование:
«Доска» и «Спринт» сейчас — два одинаковых канбана (`Открыто → В работе → Готово`).
После изменения kanban остаётся **только** в «Спринте».

Охват: десктоп **и** мобайл, на одном переиспользуемом компоненте.

## Решения (согласованы с пользователем)

1. **Макет** — Direction C: левый рельс смарт-списков + чек-лист с крупными чекбоксами.
   Не буквальная плитка Apple, а адаптация под палитру/данные Рой.
2. **Дубль** — «Доска» → Reminders-**список**; «Спринт» остаётся единственным канбаном.
   Виды задач становятся: **Список · Таймлайн · Спринт · Граф**.
3. **Линза** — по умолчанию **Мои** задачи (я в `assignee_telegram_ids`), переключатель Мои/Все.
4. **Смарт-списки** — чистый Reminders: `Сегодня · Предстоящее · Важное · Все · Готово` + группа
   «По рынкам». Статус `in_progress` в списке не выделяется (живёт в Спринте); чекбокс бинарный.
5. **Тесты** — раннера в `miniapp` нет; Vitest не добавляем (YAGNI). Логику держим чистой;
   проверка через `next build` (типы) + визуальная проверка в `next dev` (DEV_MODE mock-данные).

## Смарт-списки — семантика (`lib/smartLists.ts`, чистые функции)

Линза применяется ко всем спискам: **Мои** = `me.telegram_id ∈ task.assignee_telegram_ids`; **Все** = без фильтра.
Данные тянем разово (как `KanbanBoard`), все списки и счётчики считаем на клиенте.

«не done» = нормализованный статус не равен `done` (нормализация: `progress` → `in_progress`).
Сравнение дат — по календарному дню в локальном времени устройства (команда CEE).

| Список | Правило (всегда поверх линзы) | Сортировка |
|---|---|---|
| **Сегодня** *(дефолт)* | не done · есть `due_date` · `due_date ≤ конец сегодня` (просрочка включена, дата красным) | по `due_date` ↑ |
| **Предстоящее** | не done · `due_date > сегодня` | по `due_date` ↑ |
| **Важное** | не done · `priority === "high"` | `due_date` ↑ (null в конце), затем `created_at` ↓ |
| **Все** | не done (вкл. задачи без срока) | `due_date` ↑ (null в конце), затем `priority` ↓, `created_at` ↓ |
| **Готово** | `status === "done"` | `updated_at`/`created_at` ↓ |
| **По рынкам** | не done, группировка по `country` (нет страны → «Без рынка») | внутри группы как «Все» |

Счётчик рядом с каждым списком = число элементов в нём при текущей линзе.

API смартлистов (чистый, без React):
- `type SmartListId = "today" | "upcoming" | "flagged" | "all" | "done" | "byMarket"`
- `type Lens = "mine" | "all"`
- `filterTasks(tasks, listId, lens, me): Task[]`
- `countLists(tasks, lens, me): Record<SmartListId, number>`
- `groupByMarket(tasks, lens, me): { country: string | null; label: string; tasks: Task[] }[]`
- хелперы: `normStatus`, `isDone`, `isOverdue(task, now)`, `startOfToday()/endOfToday()`

## Раскладка

### Десктоп (3 колонки — как Apple внутри нашей оболочки)
`app-nav (есть)` │ **рельс смарт-списков (~200px)** │ **список**.
- Верхние пилюли переключателя видов (`Список · Таймлайн · Спринт · Граф`) — остаются над контентом, во всю ширину.
- Рельс показывается **только** для вида «Список». Содержит: поиск (заглушка/локальный фильтр по заголовку),
  список смарт-списков с иконкой+счётчиком, активный подсвечен `accent-soft`.
- Главная область: крупный заголовок активного списка (≈24px, `accent`), подпись-счётчик,
  переключатель Мои/Все, строки задач, инлайн-добавление снизу.

### Мобайл (`RoyTasksScreen`)
- Шапка `RoyHeader "Задачи"` + переключатель Мои/Все справа.
- Вместо `Segmented(Открыто/В работе/Готово)` — горизонтальный **ряд чипов** смарт-списков (скролл).
- Строки в `SwipeRow` (изменить/удалить), тап → `taskDetail`. `FAB` — новая задача (+ инлайн-добавление опц.).

## Компоненты

Новые:
- `miniapp/src/lib/smartLists.ts` — чистая логика (выше).
- `miniapp/src/components/tasks/TaskRow.tsx` — общая строка: крупный круглый чекбокс (toggle done),
  точка приоритета, заголовок (зачёркнут+приглушён при done), чип рынка (`Market`),
  чип срока (`RoyIcon cal` + дата; красный если просрочено), чип «Важное» при high, аватар исполнителя.
  Пропсы: `task`, `onToggle`, `onEdit`, `onDelete`, `showAssignee`.
- `miniapp/src/components/tasks/SmartListNav.tsx` — `variant: "rail" | "chips"`; пропсы `active`, `counts`, `onSelect`.
- `miniapp/src/components/tasks/RemindersTasks.tsx` — контейнер: грузит `fetchTasks`+`fetchMe`,
  10-сек polling + refetch по `visibilitychange` (паттерн из `KanbanBoard`), владеет `activeList`/`lens`,
  оптимистичный toggle/delete, инлайн quick-add, собирает `SmartListNav` + строки. `variant: "desktop" | "mobile"`.

Переиспользуем: `PriDot`, `Market`, `Avatar`, `RoyCard`, `FAB`, `SwipeRow`, `RoyIcon`, `TaskModal`, `displayName`, `STATUS_META`.

Изменяем:
- `tasks/TasksScreen.tsx` — вид `board` → `list` (лейбл «Список», иконка списка вместо `LayoutGrid`),
  рендер `<RemindersTasks variant="desktop" />` вместо `<KanbanBoard />`.
- `roy/screens/RoyTasksScreen.tsx` — заменить внутренности на `<RemindersTasks variant="mobile" />`
  (тонкая обёртка либо прямое переиспользование общих частей).

Удаляем:
- `miniapp/src/components/KanbanBoard.tsx` — мёртвый код после `Доска → Список`
  (kanban теперь только в `SprintBoard.tsx`).

## Инлайн quick-add (фишка Reminders)

Строка «＋ Новое напоминание» → инпут; Enter вызывает `createTask` контекстно:
- всегда `assignee_telegram_id = me.telegram_id`;
- список **Сегодня** → `due_date = сегодня`;
- список **Важное** → `priority = "high"`;
- группа **По рынкам** (внутри страны) → `country = <страна>`;
- иначе — только `title`.
После создания — оптимистично добавить в стейт + refetch.

## Поток данных

`RemindersTasks` (`"use client"`) → `fetchTasks()` (все, лензу считаем на клиенте) + `fetchMe()` →
`smartLists` считает счётчики и текущий список → строки. Мутации (`updateTask` toggle,
`deleteTask`, `createTask`) — оптимистичны, при ошибке `load()` повторно тянет.

## Тестирование / verification

- Раннера тестов в `miniapp` нет; Vitest не добавляем.
- `lib/smartLists.ts` — чистый и типизированный (потенциально юнит-тестируемый позже).
- Verify: `npm run build` (тип-чек Next) + `npm run dev` с `DEV_MODE` mock-данными;
  визуально на 1440 / 768 / 375, светлая и тёмная темы; проверить toggle/удаление/quick-add,
  переключение списков и линзы, счётчики.

## Последовательность сборки

1. `lib/smartLists.ts` (чистая логика) — фундамент.
2. `tasks/TaskRow.tsx` — общая строка.
3. `tasks/SmartListNav.tsx` — рельс + чипы.
4. `tasks/RemindersTasks.tsx` — контейнер (состояние, polling, мутации, quick-add).
5. Подключить десктоп `TasksScreen` (Доска→Список) и мобайл `RoyTasksScreen`.
6. Удалить `KanbanBoard.tsx`.
7. `next build` + визуальная проверка в `next dev`.
8. Обновить `docs/ARCHITECTURE.md` (вид «Список» вместо «Доска», смарт-списки), коммит + push.

## Вне охвата

- «Таймлайн», «Граф», «Спринт» — без изменений.
- Серверные изменения swarm-api — не требуются (`mine`/date-фильтры и `createTask` уже есть).
- Полноценный поиск в рельсе — пока локальный фильтр по заголовку (не серверный).
- Настраиваемые/пользовательские смарт-списки, теги-как-списки из Apple — не делаем (YAGNI).
