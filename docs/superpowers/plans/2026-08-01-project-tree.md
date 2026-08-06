# Project Space v2 (дерево задач, react-flow) — план

> Sub-skill: subagent-driven-development / executing-plans. Спека: `docs/superpowers/specs/2026-08-01-project-tree-design.md`.

**Goal:** Заменить canvas-«облако» на дерево задач (skill-tree) на react-flow + d3-hierarchy, тёплый тех-HUD (направление A), с подзадачами (`parent_id`) и drag-to-attach.

**Tech:** @xyflow/react, d3-hierarchy, CSS-анимации (без framer-motion). Deno edge + Supabase. React 19.2 / Next 16.2 turbopack.

## Global Constraints
- Миграции только ADD COLUMN; `parent_id` применять через `supabase db query --linked` (db push заблокирован дрейфом истории).
- `deno check` затронутых функций зелёный (pre-commit); `npm run build` зелёный.
- Цветовая политика `globals.css`: янтарь `#D98A2B`/`#F0B45F`, тёплый графит `#1A1714`, камень `#8C8475`, done `#2E9E6B`. Не холодный индиго.
- Двуязычие EN+RU нового текста (`useDt`).
- Доступ к tasks — только через guard'ы (canViewTask/canMutateTask), изоляция group_id.
- Дерево грузить лениво (dynamic import react-flow), бандл app < 300kb.

---

## Task 0 — Спайк: react-flow заводится под Next 16 + React 19
- Установить `@xyflow/react d3-hierarchy @types/d3-hierarchy`.
- Минимальный `ProjectTree` с react-flow, 3 хардкод-узла + ребро, импортировать в вкладку вместо ProjectSpace.
- `npm run build` зелёный + локально рендерится (owner смотрит localhost). Гейт: если turbopack/RF конфликт — решить до полной сборки.

## Task 1 — Миграция `parent_id`
- `supabase/migrations/2026...parent_id.sql`: `ADD COLUMN parent_id uuid REFERENCES tasks(id) ON DELETE SET NULL` + индекс.
- Применить через `supabase db query --linked -f`; проверить схему.

## Task 2 — Бэкенд-типы + db
- `types.ts`: `Task.parent_id`, `TaskInput.parent_id?`.
- `db.ts`: `createTask` пишет parent_id; `listTasks` фильтр `parentId?`.

## Task 3 — swarm-api: parent_id + валидация
- `POST /tasks`: приём `parent_id` (проверка: родитель того же проекта и project_linked).
- `PATCH /tasks/:id`: приём `parent_id` — **валидация цикла** (нельзя в своего потомка), форс `project_linked=true` при parent!=null; при отвязке `project_linked=false` → `parent_id=null` + **дети каскадом в бэклог** (project_linked=false, parent_id=null).
- Деплой + SQL-смоук.

## Task 4 — Фронт-контракт
- `types.ts`: `Task.parent_id`; `api.ts`: инпуты/фильтр parent_id; mock-задачи +parent_id.

## Task 5 — d3-hierarchy раскладка
- Утилита `treeLayout(tasks, rootMeta)`: строит иерархию по parent_id (корень=проект), радиальная раскладка → узлы {id,x,y} + рёбра. Бэклог — отдельным списком.

## Task 6 — react-flow дерево + warm-HUD узлы
- `ProjectTree.tsx`: ReactFlow с кастомными nodeTypes (`RootNode`, `TaskNode`) и edgeTypes (анимированная янтарная жила); fitView; фон — тёплый графит + янтарная сетка (CSS/Background pattern); reduced-motion.
- Узлы: модуль-карточка (globals-токены), заголовок, статус-пип/галочка(done), hover-свечение, кнопки «+ подзадача»/открыть. Клик → TaskModal.
- Бэклог-панель (боковая): непривязанные идеи, draggable.

## Task 7 — Интеракции attach/detach/move
- drag-to-attach: бэклог-карточку/узел на узел-цель → PATCH parent_id (+ optimistic). На корень → parent_id=null,project_linked=true. В бэклог → detach.
- «+ подзадача» на узле → createTask с parent_id, project_linked=true.
- Оптимистичные апдейты + откат.

## Task 8 — Уборка v1 + доки + деплой + merge
- Удалить `useProjectCanvas.ts`; заменить `ProjectSpace`→`ProjectTree` в TasksScreen.
- ARCHITECTURE/QUICK_REF: `tasks.parent_id`, react-flow-стек.
- Смоук реального флоу (UI); merge в main после подтверждения владельца.
