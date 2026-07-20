# Пикер страны в форме задачи + комментарии к задачам — дизайн

> Дата: 2026-07-21. Статус: утверждён владельцем, готов к плану реализации.
> Две независимые фичи в task-домене, один спек (шипятся вместе). Часть A — фронтовая правка. Часть B — комментарии (схема + swarm-api + MCP + веб).

## Цель

1. **Пикер страны.** В форме создания/редактирования задачи (десктоп-модалка) «Страна» — сейчас свободный текст. Заменить на выбор из **рынков воркспейса** (короткие ISO-коды, флаг+название), поповером.
2. **Комментарии к задачам.** Дать возможность писать апдейты к задаче — лента комментариев в вебе и через MCP (Claude Desktop). Без уведомлений, без редактирования.

## Решения (из брейншторминга)

| Вопрос | Решение |
|---|---|
| Пикер страны — вид | Поповер с флагами (`PictogramPicker`), `multi=false` |
| Уведомления о комментах | Нет |
| Поверхности комментов | Веб + MCP (бот — не в этой итерации) |
| Редактирование комментов | Нет (YAGNI). Только добавить/удалить |
| Удаление коммента | Автор — свой; админ — любой |
| Кто может комментировать | Кто видит задачу (`canViewTask`): приватную — только владелец/админ |

---

## Часть A — Пикер страны в TaskModal

### Что меняем

Файл `miniapp/src/components/TaskModal.tsx` — это форма из скриншота (Роль/Страна/Исполнитель). Сейчас (подтверждено):
- `const [country, setCountry] = useState("")` (строка);
- префилл `setCountry(task?.country ?? "")`;
- сохранение `country: country.trim() || null`;
- рендер — свободный `<input placeholder="напр. KZ, PL">`.

Заменяем `<input>` на `PictogramPicker` (тот же паттерн, что уже работает в `miniapp/src/components/tasks/TaskQuickActions.tsx`):
- добавить `const [markets, setMarkets] = useState<string[]>([])`; в существующем `useEffect` (рядом с `fetchUsers`/`fetchTaskLabels`) дёрнуть `fetchConfig().then(c => setMarkets(c.allowed_markets ?? [])).catch(() => {})`;
- опции: `{ id: "", label: "Global", icon: "globe" }` + `codes.map(code => ({ id: code, label: countryName(code), flag: countryFlag(code) }))`, где `codes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES)`; **легаси-фолбэк** — если `country && !codes.includes(country)` → `codes.push(country)` (не теряем страну задачи вне текущего `allowed_markets`);
- `selected={country ? [country] : [""]}`, `onToggle={(code) => setCountry(code)}` (пусто → Global);
- сохранение меняется на `country: country || null` (значение теперь код или "").
- Импорты: `fetchConfig` из `@/lib/api`; `COUNTRY_NAMES, countryName, countryFlag` из `@/lib/countries`; `PictogramPicker, type PictoOption` из `@/components/tasks/PictogramPicker`.

Данные/бэкенд/типы **не трогаем**: `task.country: string | null` уже поддерживается end-to-end (`_shared/tasks/types.ts`, `db.ts`, `api.ts`).

### Мелкое улучшение переиспользуемого компонента

`PictogramPicker` сейчас рендерит триггер как иконку-кнопку (`triggerIcon: RoyIconName`). В форме нужен **триггер вида поля** (флаг + название + шеврон, в один ряд с соседними `<select>` Роль/Исполнитель).

Добавить в `PictogramPicker` опциональный проп `trigger?: ReactNode`. Если передан — рендерить его как кликабельный триггер (обёртка вешает onClick/ref/aria); если нет — прежнее поведение (иконка-кнопка по `triggerIcon`). **Обратная совместимость:** существующие вызовы (`TaskQuickActions`, метки) `trigger` не передают → не меняются. `triggerIcon` становится необязательным, только когда есть `trigger`.

TaskModal передаёт field-style триггер: кнопка шириной поля (те же классы, что у `fieldCls`), внутри `countryFlag(country) countryName(country)` (или «🌐 Global» при пусто) + шеврон.

### Проверка A
`npm run build` в `miniapp/`; локальный рендер (`NEXT_PUBLIC_DEV_MODE=true`) — открыть модалку задачи, проверить выбор/сброс страны, префилл при редактировании, легаси-страна. Светлая/тёмная тема. Тип-чек проходит.

---

## Часть B — Комментарии к задачам

### Схема (миграция, аддитивно)

Таблица `task_comments` уже есть, но пустая и недоделанная:
```sql
create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,        -- НЕТ FK/индекса
  content text not null,
  added_by text not null,       -- нет id-автора
  created_at timestamptz default now()
);
```
Миграция `supabase/migrations/<ts>_task_comments_fk.sql` (всё безопасно — таблица пустая):
```sql
alter table public.task_comments
  add column if not exists added_by_telegram_id bigint,
  alter column added_by drop not null;

alter table public.task_comments
  add constraint task_comments_task_id_fkey
  foreign key (task_id) references public.tasks(id) on delete cascade;

create index if not exists idx_task_comments_task_id on public.task_comments (task_id);
```
- Автор хранится как `added_by_telegram_id bigint`; имя резолвится на чтении (`resolveNames`) — не протухает. `added_by text` остаётся (снимаем NOT NULL), пишем в него null.
- Каскад: удаление задачи чистит её комментарии (как `task_history`).

### swarm-api

Новый модуль `supabase/functions/swarm-api/task-comments.ts`, экспорт:
```ts
export async function handleTaskCommentRoutes(
  supabase, req: Request, routePath: string,
  telegramId: number, groupId: string, isAdmin: boolean, origin: string,
): Promise<Response | null>
```
Подключить в `index.ts` рядом с `handleTaskLabelRoutes` (возврат `null` = не мой роут). Роуты:

| Метод | Путь | Поведение |
|---|---|---|
| `GET` | `/tasks/:id/comments` | Список (oldest→newest). Гейт: задача существует, `group_id` совпадает, `canViewTask` (иначе 404). Резолв имён авторов через `resolveNames`. |
| `POST` | `/tasks/:id/comments` `{content}` | Валидация: trim непустой, ≤4000. Гейт: `canViewTask` (иначе 404). Insert `{task_id, content, added_by_telegram_id: telegramId}`. Ответ — созданный коммент с `author_name`. |
| `DELETE` | `/tasks/:id/comments/:cid` | Гейт: задача видима; коммент принадлежит `telegramId` **или** `isAdmin` (иначе 403). Удалить. |

Форма ответа коммента: `{ id, content, author_name, author_telegram_id, created_at }`. Переиспользовать существующие `getTask`/`canViewTask`/`canMutateTask` и `resolveNames` из `index.ts` (передать в модуль или вызвать до делегирования — как удобнее по факту кода; канон — не дублировать проверки доступа).

### MCP (swarm-mcp)

В `swarm-mcp/tasks/tools.ts` добавить два инструмента (паттерн существующих task-тулзов: `requesting_user_id → group_id`, воркспейс-изоляция `task.group_id === groupId`, приватность):

| Инструмент | Аргументы | Действие |
|---|---|---|
| `get_task_comments` | `task_id`, `requesting_user_id` | Список комментариев задачи (если видима запрашивающему). Имена резолвятся. |
| `add_task_comment` | `task_id`, `content`, `requesting_user_id` | Добавить коммент от лица запрашивающего (его `telegram_id`). Валидация как в API. |

Удаление через MCP — **не добавляем** (YAGNI; чистка — в вебе).

### Веб

- `miniapp/src/lib/api.ts`: тип `TaskComment = { id: string; content: string; author_name: string; author_telegram_id: number | null; created_at: string }`; функции `fetchTaskComments(taskId)`, `addTaskComment(taskId, content)`, `deleteTaskComment(taskId, commentId)` (паттерн `fetchDependencies`/`addDependency`). DEV_MODE — вернуть мок-массив.
- `miniapp/src/components/roy/screens/TaskDetail.tsx`: секция «Комментарии» после «Описание»/«Связано из базы»:
  - лента: строка = автор (`displayName`) · относительное время (`relTime`/`fmtDate`) · текст; на своих (и у админа) — кнопка ✕ (`deleteTaskComment`);
  - композер снизу: `<textarea>` (паттерн `NewTask.tsx`) + кнопка «Отправить» → `addTaskComment` → добавить в ленту (оптимистично или рефетч);
  - пустое состояние «Пока нет комментариев».
  - Текущий пользователь (для «свой коммент» и авторства) — из уже доступного `me` (как в остальном приложении). Если TaskDetail не получает `me` — прокинуть из `RoyApp`/nav (не заводить второй источник).

### Проверка B
- `deno check` затронутых edge-функций. Чистые юнит-тесты на выделяемое: валидатор контента (trim/непустой/≤4000) — общий хелпер, чтобы API и MCP не расходились.
- Смоук на проде (после деплоя, от своего лица): создать коммент к своей задаче → прочитать (`GET`) → удалить; проверить, что к чужой приватной задаче доступа нет (404). Через MCP: `add_task_comment` + `get_task_comments`.
- `npm run build` miniapp; глянуть секцию в карточке задачи (светлая/тёмная).

### Деплой B
- Миграция: аддитивна (add column / FK на пустой таблице / index / drop not null) — безопасна. По правилу — сперва глянуть на staging (self-hosted MUSPELHEIM), затем `apply_migration` на прод (`vbqglndbxkpmreccpqmr`).
- Деплой `swarm-api` + `swarm-mcp` (`--no-verify-jwt`). Веб авто-катится на push в `sandbox_vas`.

---

## Изоляция/единицы (тестируемость)

- **A:** `PictogramPicker` (доп. проп `trigger`, чистый компонент) · `TaskModal` (сборка опций — чистая функция `buildMarketOptions(markets, country)` вынести и покрыть тестом).
- **B:** `validateCommentContent(raw): {ok, value?|error}` (чистая, общая для API+MCP, тест) · `task-comments.ts` (I/O-роуты) · MCP-тулзы (I/O) · `api.ts` (клиент) · `TaskDetail` секция (UI).

## Обновление документации (DoD)

- `docs/ARCHITECTURE.md` — `task_comments` теперь **used** (обновить строку таблицы: FK/индекс/`added_by_telegram_id`); эндпоинты `/tasks/:id/comments` в каноне swarm-api; MCP-тулзы `get_task_comments`/`add_task_comment` в таблице MCP.
- `docs/QUICK_REF.md` — нав-индекс: строка про комментарии (файлы `task-comments.ts`, `TaskDetail` секция).
- `README.md` — список MCP-инструментов (+2), при необходимости строка про комментарии.
- `docs/BACKLOG.md` — закрыть/отметить; зафиксировать отложенное (комменты в боте: бейдж «💬 N» + deep-link; редактирование; уведомления).

## Не делаем (YAGNI)

- Уведомления о комментах (решение владельца).
- Редактирование комментариев.
- Комментарии в Telegram-боте (отложено — бейдж «💬 N» + deep-link в веб позже).
- Удаление комментов через MCP.
- @-упоминания, реакции, вложения в комментах.
