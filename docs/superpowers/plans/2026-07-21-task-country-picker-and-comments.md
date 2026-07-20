# Пикер страны в форме задачи + комментарии к задачам — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Заменить свободный ввод «Страна» в десктоп-форме задачи на поповер-пикер рынков воркспейса. (B) Добавить комментарии к задачам (веб + MCP), без уведомлений и редактирования.

**Architecture:** A — чисто фронт: переиспользовать `PictogramPicker` (доп. проп `trigger`) + `fetchConfig().allowed_markets`, поле `task.country: string|null` не меняется. B — таблица `task_comments` (аддитивная миграция) + модуль swarm-api `task-comments.ts` (зеркало `task-labels.ts`) + 2 MCP-тулзы + секция в `TaskDetail.tsx`. Автор хранится как `added_by_telegram_id`, имя резолвится на чтении.

**Tech Stack:** Next.js 16 / React 19 (miniapp), Deno (Supabase Edge Functions), Supabase Postgres. Тесты edge-логики — `deno test`. Фронт — `npm run build` (Next build = typecheck+сборка) + ручной смоук в DEV_MODE.

## Global Constraints

- Ветка `sandbox_vas`; в `main` не коммитить. Коммит-сообщения conventional. Не пушить в рамках задач (пуш — на финале).
- Edge-функции: `deno check` затронутого должен быть зелёным (pre-commit хук). Деплой — `--no-verify-jwt`.
- `SERVICE_ROLE_KEY` везде, RLS не работает → **весь контроль доступа в коде**. Доступ к задаче: `group_id` совпадает + приватную (`is_private`) видит только владелец (`owner_id`) или админ.
- Комментарии: без уведомлений, без редактирования; удаление — автор свой / админ любой; контент trim непустой, ≤4000; видимость коммента = видимость задачи.
- Страна задачи — `task.country: string | null` (одиночный ISO-код), НЕ трогать типы/бэкенд.
- Миграции: только аддитивные без подтверждения (`ADD COLUMN`, FK на пустой таблице, index, `DROP NOT NULL` — безопасны). Перед прод — глянуть staging.
- Доки — часть DoD. Спека: `docs/superpowers/specs/2026-07-21-task-country-picker-and-comments-design.md`.
- Фронт-код: `.tsx`, `type Props`, деструктуризация пропсов, без `any`, без `console.log`.

---

## ЧАСТЬ A — Пикер страны

### Task 1: `PictogramPicker` — опциональный кастомный триггер

**Files:**
- Modify: `miniapp/src/components/tasks/PictogramPicker.tsx`

**Interfaces:**
- Consumes: —
- Produces: `PictogramPicker` принимает доп. необязательный проп `trigger?: ReactNode`; при наличии рендерит его как кликабельный триггер вместо иконки-кнопки; `triggerIcon` становится необязательным. Существующая сигнатура (`triggerIcon`, `ariaLabel`, `options`, `selected`, `multi`, `onToggle`, `footer`) сохранена.

- [ ] **Step 1: Обновить тип пропсов**

В `PictogramPicker.tsx` заменить блок `type Props = {...}` на:
```tsx
type Props = {
  triggerIcon?: RoyIconName;
  ariaLabel: string;
  options: PictoOption[];
  selected: string[];
  multi: boolean;
  onToggle: (id: string) => void;
  footer?: ReactNode;
  // Кастомный триггер-элемент (напр. поле формы флаг+название). Если задан — рендерится
  // вместо иконки-кнопки по triggerIcon. Обёртка сама вешает ref/onClick/aria.
  trigger?: ReactNode;
};
```
И в деструктуризации параметров добавить `trigger`:
```tsx
export function PictogramPicker({ triggerIcon, ariaLabel, options, selected, multi, onToggle, footer, trigger }: Props) {
```

- [ ] **Step 2: Рендерить кастомный триггер, если задан**

Заменить существующий `<button ref={btnRef} ...>` (иконка-триггер, строки ~69-81) на разветвление: кастомный триггер в обёртке ИЛИ прежняя иконка-кнопка. Вставить вместо того `<button>…</button>`:
```tsx
      {trigger ? (
        <button
          ref={btnRef}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-[12px]"
        >
          {trigger}
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          className="flex items-center justify-center rounded-[9px] border border-line-2 bg-surface transition-colors hover:bg-surface-2 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          style={{ width: 26, height: 26, color: selected.length ? "var(--accent-ink)" : "var(--ink-soft)" }}
        >
          <RoyIcon name={triggerIcon ?? "globe"} size={15} strokeWidth={1.9} />
        </button>
      )}
```

- [ ] **Step 3: Собрать miniapp (typecheck + build)**

Run: `cd miniapp && npm run build`
Expected: сборка без ошибок типов; существующие вызовы (`TaskQuickActions.tsx`, `PictogramPicker` в метках) не сломаны (они не передают `trigger` → прежнее поведение).

- [ ] **Step 4: Commit**

```bash
git add miniapp/src/components/tasks/PictogramPicker.tsx
git commit -m "feat(web): PictogramPicker — опциональный кастомный триггер (field-style)"
```

---

### Task 2: TaskModal — пикер страны вместо свободного поля

**Files:**
- Modify: `miniapp/src/components/TaskModal.tsx`

**Interfaces:**
- Consumes: `PictogramPicker` c пропом `trigger` (Task 1); `fetchConfig()` (`@/lib/api`) → `{ allowed_markets: string[] }`; `countryName`/`countryFlag`/`COUNTRY_NAMES` (`@/lib/countries`).
- Produces: —

- [ ] **Step 1: Добавить импорты**

В `TaskModal.tsx` в существующий импорт из `@/lib/api` добавить `fetchConfig`:
```tsx
import {
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskLabel,
  createTask,
  updateTask,
  deleteTask,
  fetchUsers,
  fetchTaskLabels,
  fetchConfig,
} from "@/lib/api";
```
И новые импорты (после строки импорта `icons`):
```tsx
import { PictogramPicker, type PictoOption } from "@/components/tasks/PictogramPicker";
import { COUNTRY_NAMES, countryName, countryFlag } from "@/lib/countries";
```

- [ ] **Step 2: Состояние рынков + загрузка**

Добавить состояние рядом с `const [users, setUsers] = useState<User[]>([]);`:
```tsx
  const [markets, setMarkets] = useState<string[]>([]);
```
В `useEffect` (который резетит форму, там где `fetchUsers().then(...)`) добавить:
```tsx
    fetchConfig().then((c) => setMarkets(c.allowed_markets ?? [])).catch(() => {});
```

- [ ] **Step 3: Заменить свободное поле «Страна» на пикер**

Заменить блок (строки ~232-235):
```tsx
              <div>
                <label htmlFor="modal-country" className={labelCls} style={{ fontSize: 12.5 }}>Страна</label>
                <input id="modal-country" className={fieldCls} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="напр. KZ, PL" />
              </div>
```
на:
```tsx
              <div>
                <span className={labelCls} style={{ fontSize: 12.5 }}>Страна</span>
                <PictogramPicker
                  ariaLabel="Страна"
                  multi={false}
                  options={countryOptions}
                  selected={country ? [country] : [""]}
                  onToggle={(code) => setCountry(code)}
                  trigger={
                    <span className={`${fieldCls} flex items-center justify-between`}>
                      <span className="flex items-center gap-2 truncate">
                        <span style={{ fontSize: 15 }}>{country ? countryFlag(country) : "🌐"}</span>
                        <span className="truncate">{country ? countryName(country) : "Global"}</span>
                      </span>
                      <RoyIcon name="cdown" size={16} strokeWidth={1.9} className="shrink-0 text-ink-soft" />
                    </span>
                  }
                />
              </div>
```
> Если иконки `cdown` нет в наборе `RoyIconName` — использовать имеющуюся стрелку вниз (например `chevron`/`caret`; проверить `miniapp/src/components/roy/icons.tsx` и взять существующее имя). Не выдумывать новую иконку.

- [ ] **Step 4: Собрать опции страны (перед `return`)**

Рядом с `assigneeOptions` добавить:
```tsx
  // Опции страны: рынки воркспейса + «Global» (пусто) + легаси-фолбэк (страна задачи вне
  // текущего allowed_markets — чтобы при редактировании не потерять её).
  const countryCodes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES);
  if (country && !countryCodes.includes(country)) countryCodes.push(country);
  const countryOptions: PictoOption[] = [
    { id: "", label: "Global", icon: "globe" },
    ...countryCodes.map((code) => ({ id: code, label: countryName(code), flag: countryFlag(code) })),
  ];
```

- [ ] **Step 5: Сохранение — страна теперь код или пусто**

В `handleSave`, в объекте `base`, заменить:
```tsx
        country: country.trim() || null,
```
на:
```tsx
        country: country || null,
```

- [ ] **Step 6: Собрать miniapp**

Run: `cd miniapp && npm run build`
Expected: без ошибок типов, сборка проходит.

- [ ] **Step 7: Ручной смоук (DEV_MODE)**

Run: `cd miniapp && NEXT_PUBLIC_DEV_MODE=true npm run dev` (порт по умолчанию), открыть, создать/редактировать задачу.
Expected: поле «Страна» — кликабельное поле с флагом+названием (дефолт «🌐 Global»); клик открывает поповер рынков; выбор проставляется; при редактировании задачи с `country` префилл верный; легаси-страна вне allowed_markets тоже показывается. Проверить светлую и тёмную тему.

- [ ] **Step 8: Commit**

```bash
git add miniapp/src/components/TaskModal.tsx
git commit -m "feat(web): пикер страны (рынки воркспейса) в форме задачи вместо свободного поля"
```

---

## ЧАСТЬ B — Комментарии к задачам

### Task 3: Миграция `task_comments` (FK + индекс + автор-id)

**Files:**
- Create: `supabase/migrations/20260721120000_task_comments_fk.sql`

**Interfaces:**
- Produces: таблица `task_comments` с колонкой `added_by_telegram_id bigint`, FK `task_id → tasks(id) ON DELETE CASCADE`, индексом `idx_task_comments_task_id`, `added_by` больше не NOT NULL.

- [ ] **Step 1: Создать файл миграции**

```sql
-- task_comments: доводим до рабочего состояния (таблица была объявлена, но не использовалась).
-- Всё аддитивно и безопасно: таблица пустая.
alter table public.task_comments
  add column if not exists added_by_telegram_id bigint;

alter table public.task_comments
  alter column added_by drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_comments_task_id_fkey'
  ) then
    alter table public.task_comments
      add constraint task_comments_task_id_fkey
      foreign key (task_id) references public.tasks(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_task_comments_task_id on public.task_comments (task_id);
```

- [ ] **Step 2: Синтаксическая самопроверка**

Прочитать файл, убедиться: только аддитивные операции, идемпотентно (`if not exists` / guarded FK). Применение на прод/staging — в Task 9 (деплой). Здесь БД не трогаем.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721120000_task_comments_fk.sql
git commit -m "feat(db): task_comments — FK+cascade, индекс, added_by_telegram_id"
```

---

### Task 4: Чистый валидатор контента комментария

**Files:**
- Create: `supabase/functions/_shared/tasks/comments.ts`
- Test: `supabase/functions/_shared/tasks/comments.test.ts`

**Interfaces:**
- Produces: `validateCommentContent(raw: unknown): { ok: true; value: string } | { ok: false; error: string }` и `const COMMENT_MAX = 4000`. Используется и swarm-api, и swarm-mcp (единый контракт).

- [ ] **Step 1: Написать падающий тест**

```ts
// supabase/functions/_shared/tasks/comments.test.ts
// Запуск: deno test supabase/functions/_shared/tasks/comments.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateCommentContent, COMMENT_MAX } from "./comments.ts";

Deno.test("validateCommentContent: тримит и принимает непустой", () => {
  assertEquals(validateCommentContent("  привет  "), { ok: true, value: "привет" });
});

Deno.test("validateCommentContent: пустой/пробелы/не строка → ошибка", () => {
  assertEquals(validateCommentContent("").ok, false);
  assertEquals(validateCommentContent("   ").ok, false);
  assertEquals(validateCommentContent(null).ok, false);
  assertEquals(validateCommentContent(123).ok, false);
});

Deno.test("validateCommentContent: длиннее лимита → ошибка", () => {
  const long = "a".repeat(COMMENT_MAX + 1);
  assertEquals(validateCommentContent(long).ok, false);
  assertEquals(validateCommentContent("a".repeat(COMMENT_MAX)).ok, true);
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `deno test supabase/functions/_shared/tasks/comments.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализация**

```ts
// supabase/functions/_shared/tasks/comments.ts
export const COMMENT_MAX = 4000;

export function validateCommentContent(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Комментарий должен быть текстом" };
  const value = raw.trim();
  if (!value) return { ok: false, error: "Пустой комментарий" };
  if (value.length > COMMENT_MAX) return { ok: false, error: `Слишком длинно (макс ${COMMENT_MAX})` };
  return { ok: true, value };
}
```

- [ ] **Step 4: Прогнать — проходит**

Run: `deno test supabase/functions/_shared/tasks/comments.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/tasks/comments.ts supabase/functions/_shared/tasks/comments.test.ts
git commit -m "feat(tasks): чистый валидатор контента комментария (общий API+MCP)"
```

---

### Task 5: swarm-api — роуты комментариев

**Files:**
- Create: `supabase/functions/swarm-api/task-comments.ts`
- Modify: `supabase/functions/swarm-api/index.ts` (экспорт `resolveNames`; подключение роутов комментариев)

**Interfaces:**
- Consumes: `validateCommentContent` (Task 4); `json` из `./http.ts`; инъекция `resolveNames(ids: number[]) => Promise<Map<number, string>>` из `index.ts`.
- Produces: `handleTaskCommentRoutes(supabase, req, routePath, telegramId, groupId, isAdmin, origin, resolveNames): Promise<Response | null>`. HTTP: `GET/POST /tasks/:id/comments`, `DELETE /tasks/:id/comments/:cid`. Форма коммента: `{ id, content, author_name, author_telegram_id, created_at }`.

- [ ] **Step 1: Создать модуль `task-comments.ts`**

```ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { validateCommentContent } from "../_shared/tasks/comments.ts";

// Роуты /tasks/:id/comments — комментарии-апдейты к задаче.
// Доступ: задача того же воркспейса (group_id) + приватную видит только владелец/админ.
// Возвращает null, если путь не про комментарии (index.ts идёт дальше).

type CommentRow = { id: string; content: string; added_by_telegram_id: number | null; created_at: string };
type TaskRow = { id: string; group_id: string | null; is_private: boolean; owner_id: number | null };

function canView(task: TaskRow, viewerId: number, isAdmin: boolean): boolean {
  return !task.is_private || isAdmin || task.owner_id === viewerId;
}

async function loadTask(supabase: SupabaseClient, taskId: string): Promise<TaskRow | null> {
  const { data } = await supabase
    .from("tasks").select("id, group_id, is_private, owner_id").eq("id", taskId).maybeSingle();
  return (data as TaskRow | null) ?? null;
}

export async function handleTaskCommentRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  isAdmin: boolean,
  origin: string,
  resolveNames: (ids: number[]) => Promise<Map<number, string>>,
): Promise<Response | null> {
  const listMatch = routePath.match(/^\/tasks\/([^/]+)\/comments$/);
  const oneMatch = routePath.match(/^\/tasks\/([^/]+)\/comments\/([^/]+)$/);
  if (!listMatch && !oneMatch) return null;

  const taskId = (listMatch ?? oneMatch)![1];
  const task = await loadTask(supabase, taskId);
  // 404 и на отсутствие, и на чужой воркспейс/приватность — не палим существование.
  if (!task || task.group_id !== groupId || !canView(task, telegramId, isAdmin)) {
    return json({ error: "Задача не найдена" }, 404, origin);
  }

  // GET /tasks/:id/comments — лента (старые→новые)
  if (listMatch && req.method === "GET") {
    const { data } = await supabase
      .from("task_comments")
      .select("id, content, added_by_telegram_id, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as CommentRow[];
    const names = await resolveNames(rows.map((r) => r.added_by_telegram_id).filter((x): x is number => !!x));
    return json(rows.map((r) => ({
      id: r.id,
      content: r.content,
      author_telegram_id: r.added_by_telegram_id,
      author_name: r.added_by_telegram_id ? (names.get(r.added_by_telegram_id) ?? String(r.added_by_telegram_id)) : "—",
      created_at: r.created_at,
    })), 200, origin);
  }

  // POST /tasks/:id/comments { content }
  if (listMatch && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { content?: unknown };
    const v = validateCommentContent(body.content);
    if (!v.ok) return json({ error: v.error }, 400, origin);
    const { data, error } = await supabase
      .from("task_comments")
      .insert({ task_id: taskId, content: v.value, added_by_telegram_id: telegramId })
      .select("id, content, added_by_telegram_id, created_at").single();
    if (error) return json({ error: error.message }, 500, origin);
    const row = data as CommentRow;
    const names = await resolveNames([telegramId]);
    return json({
      id: row.id,
      content: row.content,
      author_telegram_id: row.added_by_telegram_id,
      author_name: names.get(telegramId) ?? String(telegramId),
      created_at: row.created_at,
    }, 201, origin);
  }

  // DELETE /tasks/:id/comments/:cid — свой коммент или админ
  if (oneMatch && req.method === "DELETE") {
    const commentId = oneMatch[2];
    const { data: c } = await supabase
      .from("task_comments").select("id, added_by_telegram_id").eq("id", commentId).eq("task_id", taskId).maybeSingle();
    if (!c) return json({ error: "Комментарий не найден" }, 404, origin);
    const owns = (c as { added_by_telegram_id: number | null }).added_by_telegram_id === telegramId;
    if (!owns && !isAdmin) return json({ error: "Нельзя удалить чужой комментарий" }, 403, origin);
    await supabase.from("task_comments").delete().eq("id", commentId);
    return json({ ok: true }, 200, origin);
  }

  return null;
}
```

- [ ] **Step 2: Экспортировать `resolveNames` в index.ts**

В `supabase/functions/swarm-api/index.ts` найти объявление `async function resolveNames(` (около строки 77) и добавить `export`:
```ts
export async function resolveNames(
```
(Сигнатура не меняется — `(ids: number[]): Promise<Map<number, string>>`.)

- [ ] **Step 3: Подключить роуты комментариев в index.ts**

Добавить импорт рядом с импортом `handleTaskLabelRoutes` (вверху index.ts):
```ts
import { handleTaskCommentRoutes } from "./task-comments.ts";
```
Найти место, где вызывается `handleTaskLabelRoutes(...)` (делегирование label-роутов, около строки 410) и **сразу после** его `if (...) return ...;` блока добавить:
```ts
  const commentResp = await handleTaskCommentRoutes(supabase, req, routePath, telegram_id, groupId, isAdmin, origin, resolveNames);
  if (commentResp) return commentResp;
```
> Точный вид вызова `handleTaskLabelRoutes` прочитать в файле и разместить наш вызов симметрично (та же обёртка `if (resp) return resp;`). `telegram_id`, `groupId`, `isAdmin`, `origin` уже вычислены в области хендлера (строки ~294-298).

- [ ] **Step 4: Тип-чек**

Run: `deno check supabase/functions/swarm-api/index.ts`
Expected: чисто (проверит и `task-comments.ts` по импорту).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-api/task-comments.ts supabase/functions/swarm-api/index.ts
git commit -m "feat(api): комментарии к задачам — GET/POST/DELETE /tasks/:id/comments"
```

---

### Task 6: MCP — тулзы комментариев

**Files:**
- Modify: `supabase/functions/swarm-mcp/tasks/tools.ts` (2 функции + определения)
- Modify: `supabase/functions/swarm-mcp/index.ts` (диспатч tools/call)

**Interfaces:**
- Consumes: `validateCommentContent` (Task 4); существующие `supabase`, `resolveGroupId`, `getTask` в `tools.ts`.
- Produces: `toolGetTaskComments(args)`, `toolAddTaskComment(args)`; `COMMENT_TOOL_DEFINITIONS` c тулзами `get_task_comments` и `add_task_comment`.

- [ ] **Step 1: Импорт валидатора в tools.ts**

Вверху `swarm-mcp/tasks/tools.ts` добавить:
```ts
import { validateCommentContent } from "../../_shared/tasks/comments.ts";
```

- [ ] **Step 2: Функции тулзов (в конец tools.ts, перед определениями)**

```ts
// ── Комментарии к задачам (апдейты) ────────────────────────────────────────────

async function commentTaskGuard(taskId: string, requestingUserId: number): Promise<{ ok: true } | { ok: false; msg: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, msg: `Задача ${taskId} не найдена.` };
  const groupId = await resolveGroupId(requestingUserId);
  if (!groupId || task.group_id !== groupId) return { ok: false, msg: "Нет доступа: задача не в твоём воркспейсе." };
  // Приватную задачу видит только владелец (в MCP админ-байпас не применяем — чистка в вебе).
  if (task.is_private && task.owner_id !== requestingUserId) return { ok: false, msg: "Нет доступа: задача приватная." };
  return { ok: true };
}

export async function toolGetTaskComments(args: { task_id: string; requesting_user_id: number }): Promise<string> {
  const guard = await commentTaskGuard(args.task_id, args.requesting_user_id);
  if (!guard.ok) return guard.msg;
  const { data } = await supabase
    .from("task_comments").select("content, added_by_telegram_id, created_at")
    .eq("task_id", args.task_id).order("created_at", { ascending: true });
  const rows = (data ?? []) as Array<{ content: string; added_by_telegram_id: number | null; created_at: string }>;
  if (!rows.length) return "Комментариев пока нет.";
  const ids = [...new Set(rows.map((r) => r.added_by_telegram_id).filter((x): x is number => !!x))];
  const { data: profs } = await supabase.from("user_profiles").select("telegram_id, first_name, last_name").in("telegram_id", ids.length ? ids : [0]);
  const nameById = new Map<number, string>();
  for (const p of (profs ?? []) as Array<{ telegram_id: number; first_name?: string; last_name?: string }>) {
    nameById.set(p.telegram_id, [p.first_name, p.last_name].filter(Boolean).join(" ") || String(p.telegram_id));
  }
  return rows.map((r) => {
    const who = r.added_by_telegram_id ? (nameById.get(r.added_by_telegram_id) ?? String(r.added_by_telegram_id)) : "—";
    const when = r.created_at.slice(0, 10);
    return `• [${when}] ${who}: ${r.content}`;
  }).join("\n\n");
}

export async function toolAddTaskComment(args: { task_id: string; content: string; requesting_user_id: number }): Promise<string> {
  const guard = await commentTaskGuard(args.task_id, args.requesting_user_id);
  if (!guard.ok) return guard.msg;
  const v = validateCommentContent(args.content);
  if (!v.ok) return `Ошибка: ${v.error}`;
  const { error } = await supabase
    .from("task_comments").insert({ task_id: args.task_id, content: v.value, added_by_telegram_id: args.requesting_user_id });
  if (error) return `Ошибка: ${error.message}`;
  return "✅ Комментарий добавлен.";
}
```

- [ ] **Step 3: Определения тулзов (в конец tools.ts)**

```ts
export const COMMENT_TOOL_DEFINITIONS = [
  {
    name: "get_task_comments",
    description: "Показать комментарии-апдейты к задаче по её ID (если задача доступна тебе).",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID задачи" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен для проверки доступа" },
      },
      required: ["task_id", "requesting_user_id"],
    },
  },
  {
    name: "add_task_comment",
    description: "Добавить комментарий-апдейт к задаче по её ID от твоего лица.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID задачи" },
        content: { type: "string", description: "Текст комментария" },
        requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен" },
      },
      required: ["task_id", "content", "requesting_user_id"],
    },
  },
];
```

- [ ] **Step 4: Зарегистрировать в swarm-mcp/index.ts**

Прочитать `supabase/functions/swarm-mcp/index.ts`: найти, где (а) в ответ `tools/list` подмешиваются `TASK_TOOL_DEFINITIONS`/`LABEL_TOOL_DEFINITIONS`, и (б) в `tools/call` диспатчатся имена тулзов (`add_task`/`get_tasks`/…). Симметрично:
- добавить в импорт из `./tasks/tools.ts`: `toolGetTaskComments, toolAddTaskComment, COMMENT_TOOL_DEFINITIONS`;
- в список тулзов `tools/list` подмешать `...COMMENT_TOOL_DEFINITIONS`;
- в диспатч `tools/call` добавить ветки:
```ts
      case "get_task_comments": return await toolGetTaskComments(args);
      case "add_task_comment": return await toolAddTaskComment(args);
```
(Форму `case`/возврата взять точно как у соседних `get_tasks`/`add_task` — обёртка результата в MCP-ответ там уже есть.)

- [ ] **Step 5: Тип-чек**

Run: `deno check supabase/functions/swarm-mcp/index.ts`
Expected: чисто.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-mcp/tasks/tools.ts supabase/functions/swarm-mcp/index.ts
git commit -m "feat(mcp): get_task_comments + add_task_comment"
```

---

### Task 7: Веб — клиент + секция комментариев в TaskDetail

**Files:**
- Modify: `miniapp/src/lib/api.ts` (тип `TaskComment` + 3 функции)
- Modify: `miniapp/src/components/roy/screens/TaskDetail.tsx` (секция «Комментарии»)

**Interfaces:**
- Consumes: `apiFetch`, `DEV_MODE`; `useRoyNav()` → `{ me, toast }`.
- Produces: `TaskComment`, `fetchTaskComments/addTaskComment/deleteTaskComment` в `api.ts`.

- [ ] **Step 1: api.ts — тип и функции**

В `miniapp/src/lib/api.ts` после блока Task dependencies (после `deleteDependency`, ~строка 476) добавить:
```ts
// ── Task comments (апдейты) ─────────────────────────────────────────────────────
export type TaskComment = {
  id: string;
  content: string;
  author_name: string;
  author_telegram_id: number | null;
  created_at: string;
};

export async function fetchTaskComments(taskId: string): Promise<TaskComment[]> {
  if (DEV_MODE) return [
    { id: "c1", content: "Начал, жду данные от партнёра.", author_name: "Dev User", author_telegram_id: 123456, created_at: new Date().toISOString() },
  ];
  return apiFetch<TaskComment[]>(`/tasks/${taskId}/comments`);
}

export async function addTaskComment(taskId: string, content: string): Promise<TaskComment> {
  if (DEV_MODE) return { id: Date.now().toString(), content, author_name: "Dev User", author_telegram_id: 123456, created_at: new Date().toISOString() };
  return apiFetch<TaskComment>(`/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ content }) });
}

export async function deleteTaskComment(taskId: string, commentId: string): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>(`/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" });
}
```

- [ ] **Step 2: TaskDetail — импорты, состояние, загрузка**

В `TaskDetail.tsx`:
- в импорт из `@/lib/api` добавить `fetchTaskComments, addTaskComment, deleteTaskComment, type TaskComment`;
- в `useRoyNav()`-деструктуризацию добавить `me`: `const { pop, push, toast, me } = useRoyNav();`
- добавить состояние рядом с существующим:
```tsx
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
```
- в существующем `useEffect` (после `fetchTask(id)...`) добавить загрузку комментариев:
```tsx
    fetchTaskComments(id).then((c) => alive && setComments(c)).catch(() => {});
```
(внутри того же эффекта, до `return () => { alive = false; }`).

- [ ] **Step 3: TaskDetail — обработчики**

Добавить рядом с `setStatus`/`del`:
```tsx
  const submitComment = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const created = await addTaskComment(id, text);
      setComments((prev) => [...prev, created]);
      setDraft("");
    } catch {
      toast("Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (commentId: string) => {
    const prev = comments;
    setComments((cs) => cs.filter((c) => c.id !== commentId));
    try {
      await deleteTaskComment(id, commentId);
    } catch {
      setComments(prev);
      toast("Не удалось удалить");
    }
  };
```

- [ ] **Step 4: TaskDetail — секция «Комментарии»**

Вставить перед закрывающим `</>` блока `{t && (<> ... </>)}` (после блока `{meeting && (...)}`, до `)}`):
```tsx
            <div className="mt-5">
              <SectionLabel>Комментарии</SectionLabel>
              {comments.length === 0 ? (
                <p className="text-ink-soft" style={{ fontSize: 13 }}>Пока нет комментариев.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {comments.map((c) => {
                    const mine = c.author_telegram_id != null && c.author_telegram_id === me?.telegram_id;
                    const canDelete = mine || !!me?.is_admin;
                    return (
                      <RoyCard key={c.id} className="px-4 py-3">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="font-semibold text-ink" style={{ fontSize: 13 }}>{displayName(c.author_name)}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-ink-mute" style={{ fontSize: 12 }}>{fmtDate(c.created_at)}</span>
                            {canDelete && (
                              <button type="button" aria-label="Удалить комментарий" onClick={() => removeComment(c.id)} className="text-ink-soft transition-colors hover:text-[var(--pri-high)]">
                                <RoyIcon name="x" size={14} strokeWidth={2} />
                              </button>
                            )}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap text-ink" style={{ fontSize: 14, lineHeight: 1.5 }}>{c.content}</p>
                      </RoyCard>
                    );
                  })}
                </div>
              )}
              <div className="mt-2.5 flex flex-col gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Написать апдейт…"
                  rows={2}
                  className="w-full resize-y rounded-[12px] border border-line bg-surface px-3 py-2.5 text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute"
                  style={{ fontSize: 14, lineHeight: 1.5 }}
                />
                <button
                  type="button"
                  onClick={submitComment}
                  disabled={!draft.trim() || sending}
                  className="self-end rounded-[12px] bg-primary px-4 py-2 font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-60"
                  style={{ fontSize: 14 }}
                >
                  {sending ? "Отправка…" : "Отправить"}
                </button>
              </div>
            </div>
```

- [ ] **Step 5: Собрать miniapp**

Run: `cd miniapp && npm run build`
Expected: без ошибок типов, сборка проходит.

- [ ] **Step 6: Ручной смоук (DEV_MODE)**

Run: `cd miniapp && NEXT_PUBLIC_DEV_MODE=true npm run dev`, открыть задачу.
Expected: секция «Комментарии» — есть мок-коммент; ввод текста + «Отправить» добавляет строку; ✕ удаляет свой; пустой ввод — кнопка неактивна. Светлая/тёмная тема.

- [ ] **Step 7: Commit**

```bash
git add miniapp/src/lib/api.ts miniapp/src/components/roy/screens/TaskDetail.tsx
git commit -m "feat(web): секция комментариев в карточке задачи"
```

---

### Task 8: Документация

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/QUICK_REF.md`, `README.md`, `docs/BACKLOG.md`

**Interfaces:** нет кода.

- [ ] **Step 1: ARCHITECTURE — таблица БД**

В строке таблицы `task_comments` (раздел «Таблицы БД») заменить пометку «Таблица существует, код не использует — не задействована» на актуальное: используется; ключевые поля `task_id` (FK → `tasks`, ON DELETE CASCADE, индекс `idx_task_comments_task_id`), `content`, `added_by_telegram_id` (bigint; имя резолвится на чтении), `added_by` (legacy, nullable), `created_at`. Комментарии-апдейты к задаче (веб + MCP).

- [ ] **Step 2: ARCHITECTURE — эндпоинты swarm-api**

В каноне эндпоинтов swarm-api добавить: `GET /tasks/:id/comments`, `POST /tasks/:id/comments` `{content}`, `DELETE /tasks/:id/comments/:cid` — комментарии к задаче; гейт = видимость задачи (`group_id` + приватность); удаление — автор/админ. Модуль `task-comments.ts`.

- [ ] **Step 3: ARCHITECTURE — MCP-тулзы**

В таблицу MCP-инструментов добавить `get_task_comments` и `add_task_comment` (комментарии-апдейты к задаче; воркспейс+приватность по `requesting_user_id`).

- [ ] **Step 4: QUICK_REF — нав-индекс**

В раздел про задачи добавить строку: комментарии задач → `swarm-api/task-comments.ts`, `swarm-mcp/tasks/tools.ts` (`get_task_comments`/`add_task_comment`), веб `miniapp/.../screens/TaskDetail.tsx` + `lib/api.ts`; валидатор `_shared/tasks/comments.ts`.

- [ ] **Step 5: README — список MCP**

В таблицу MCP-инструментов README добавить `get_task_comments` и `add_task_comment`.

- [ ] **Step 6: BACKLOG — отметить сделанное + отложенное**

```markdown
## ✅ [СДЕЛАНО 2026-07-21] Пикер страны в форме задачи + комментарии к задачам

- Пикер страны (рынки воркспейса, флаги) в `TaskModal` вместо свободного поля — `PictogramPicker` c кастомным триггером; бэкенд не менялся.
- Комментарии к задачам (веб + MCP): таблица `task_comments` доведена (FK/индекс/`added_by_telegram_id`), swarm-api `task-comments.ts` (`/tasks/:id/comments`), MCP `get_task_comments`/`add_task_comment`, секция в `TaskDetail`. Автор резолвится на чтении. Спека/план: `docs/superpowers/specs/2026-07-21-...`, `docs/superpowers/plans/2026-07-21-...`.

**Отложено (не в этой итерации):** комментарии в Telegram-боте (бейдж «💬 N» + deep-link в веб); уведомления о новых комментах; редактирование комментов; удаление комментов через MCP.
```

- [ ] **Step 7: Commit**

```bash
git add docs/ARCHITECTURE.md docs/QUICK_REF.md README.md docs/BACKLOG.md
git commit -m "docs: пикер страны + комментарии к задачам (таблица used, эндпоинты, MCP)"
```

---

### Task 9: Деплой прод + смоук

**Files:** нет правок кода.

- [ ] **Step 1: Применить миграцию на staging (по правилу — сперва staging)**

На self-hosted Supabase (MUSPELHEIM) применить SQL из `20260721120000_task_comments_fk.sql` (через `make staging-migrate` или psql). Если staging недоступен — зафиксировать это и продолжить (миграция аддитивна).

- [ ] **Step 2: Применить миграцию на прод**

Через `mcp__claude_ai_Supabase__apply_migration` (project `vbqglndbxkpmreccpqmr`, name `task_comments_fk`) с телом миграции. Проверить: `select column_name from information_schema.columns where table_name='task_comments';` — есть `added_by_telegram_id`; `select indexname from pg_indexes where tablename='task_comments';` — есть `idx_task_comments_task_id`.

- [ ] **Step 3: Деплой функций**

Run:
```bash
supabase functions deploy swarm-api --no-verify-jwt
supabase functions deploy swarm-mcp --no-verify-jwt
```
Expected: обе задеплоены.

- [ ] **Step 4: Смоук API (от своего лица)**

Взять свою задачу (`select id from tasks where group_id in ('cee','other') limit 1;`). Через веб (или напрямую) проверить цикл: `POST /tasks/:id/comments {content:"тест апдейта"}` → 201; `GET` → коммент виден с `author_name`; `DELETE /tasks/:id/comments/:cid` → 200; повторный `GET` → пусто. Проверить чужую приватную задачу → 404 (если есть подходящая; иначе отметить как непроверенное).

- [ ] **Step 5: Смоук веб + MCP**

Веб: открыть задачу на `swarm-brain.pages.dev` (после авто-деплоя CF на push — будет на финальном пуше), добавить/удалить коммент. MCP: `add_task_comment` + `get_task_comments` из Claude Desktop (или отметить как проверяемое владельцем).

- [ ] **Step 6: Проверить логи**

`mcp__claude_ai_Supabase__get_logs` (edge-function) — нет 5xx от swarm-api/swarm-mcp по комментам.

---

## Self-Review

**1. Spec coverage:**
- A: пикер страны в TaskModal → Task 1 (`trigger` проп) + Task 2 (пикер). ✓ Легаси-фолбэк → Task 2 Step 4. ✓ Бэкенд не трогаем → подтверждено (только `country || null`). ✓
- B: миграция (FK/индекс/added_by_telegram_id/drop not null) → Task 3. ✓ Валидатор общий → Task 4. ✓ swarm-api роуты + гейт видимости + resolveNames → Task 5. ✓ MCP get/add → Task 6. ✓ Веб api + TaskDetail секция → Task 7. ✓ Удаление автор/админ → Task 5 (DELETE) + Task 7 (кнопка). ✓ Без уведомлений/редактирования → не реализуется (подтверждено). ✓ Доки → Task 8. ✓ Деплой+смоук+staging → Task 9. ✓

**2. Placeholder scan:** таймстамп-имя миграции `20260721120000` конкретно; заметки «прочитать точный вызов/имя иконки в файле» — это инструкции сверки с кодом, не заглушки (даны точные ориентиры). Кода-заглушек нет.

**3. Type consistency:** `TaskComment` (веб) ↔ форма ответа `{id, content, author_name, author_telegram_id, created_at}` (Task 5) совпадают. `validateCommentContent` возвращает `{ok:true,value}|{ok:false,error}` — одинаково в Task 4/5/6. `handleTaskCommentRoutes(...resolveNames)` сигнатура согласована между Task 5 (модуль) и вызовом в index.ts. `PictogramPicker` `trigger?` — согласован Task 1↔2.
