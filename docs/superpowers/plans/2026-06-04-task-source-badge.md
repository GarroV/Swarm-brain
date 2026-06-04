# Task Source Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать строку провенанса `🎤 Transcript · Garva · 3 июн` на карточке задачи в Mini App и строку источника в детальном сообщении Telegram-бота.

**Architecture:** В swarm-api GET /tasks после `listTasks` добавляем батч-запрос к `user_profiles` для резолва имён создателей; обогащённые задачи с полем `created_by_name` отдаются фронту; TaskCard рендерит строку провенанса; бот добавляет строку источника в `buildTaskDetailMessage`.

**Tech Stack:** Deno/TypeScript (swarm-api Edge Function), Next.js + React (miniapp), Supabase JS client

---

## File Map

| Файл | Изменение |
|------|-----------|
| `supabase/functions/swarm-api/index.ts` | Батч-резолв `created_by_name` после `listTasks` |
| `miniapp/src/types.ts` | Добавить `created_by_name: string \| null` в `Task` |
| `miniapp/src/components/TaskCard.tsx` | Строка провенанса |
| `supabase/functions/swarm-bot/tasks/handlers.ts` | Строка источника в `buildTaskDetailMessage` |

---

### Task 1: Backend — батч-резолв `created_by_name` в swarm-api

**Files:**
- Modify: `supabase/functions/swarm-api/index.ts` (строки ~219-230, GET /tasks handler)

- [ ] **Шаг 1: Найти место вставки**

Открыть `supabase/functions/swarm-api/index.ts`. Найти блок `if (routePath === "/tasks") { if (req.method === "GET")`. Сейчас он заканчивается:

```typescript
      const tasks = await listTasks(
        { status, country, assigneeText, telegramId: mine ? telegram_id : undefined, limit, confirmed: confirmedFilter },
        groupId,
      );
      return json(tasks, 200, origin);
```

- [ ] **Шаг 2: Заменить `return json(tasks, ...)` на батч-резолв + обогащение**

```typescript
      const tasks = await listTasks(
        { status, country, assigneeText, telegramId: mine ? telegram_id : undefined, limit, confirmed: confirmedFilter },
        groupId,
      );

      // Batch-resolve creator names
      const creatorIds = [...new Set(
        tasks.map(t => (t as { created_by_telegram_id?: number | null }).created_by_telegram_id)
             .filter((id): id is number => id != null)
      )];
      const creatorMap = new Map<number, string>();
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("telegram_id, first_name")
          .in("telegram_id", creatorIds);
        (profiles ?? []).forEach((p: { telegram_id: number; first_name: string | null }) => {
          if (p.first_name) creatorMap.set(p.telegram_id, p.first_name);
        });
      }
      const tasksWithCreator = tasks.map(t => {
        const createdById = (t as { created_by_telegram_id?: number | null }).created_by_telegram_id ?? null;
        return { ...t, created_by_name: createdById != null ? (creatorMap.get(createdById) ?? null) : null };
      });

      return json(tasksWithCreator, 200, origin);
```

- [ ] **Шаг 3: Ручная проверка — убедиться что функция деплоится без ошибок**

```bash
supabase functions deploy swarm-api --no-verify-jwt
```

Ожидаемый вывод: `Deployed Functions swarm-api` без ошибок TypeScript.

- [ ] **Шаг 4: Проверить ответ API**

```bash
# Подставить реальный токен и URL из .env / Supabase dashboard
curl -s "https://<project>.supabase.co/functions/v1/swarm-api/tasks?status=open" \
  -H "x-telegram-id: 744230399" \
  -H "x-group-id: cee" | jq '.[0] | {source, created_by_name, created_at}'
```

Ожидаемый вывод: объект с заполненными `source`, `created_by_name` (строка или null), `created_at`.

- [ ] **Шаг 5: Коммит**

```bash
git add supabase/functions/swarm-api/index.ts
git commit -m "feat(api): add created_by_name to GET /tasks response"
git push origin sandbox_vas
```

---

### Task 2: Frontend types — добавить `created_by_name`

**Files:**
- Modify: `miniapp/src/types.ts`

- [ ] **Шаг 1: Добавить поле в тип Task**

В файле `miniapp/src/types.ts` найти тип `Task`. Добавить после `group_id?: string | null;`:

```typescript
export type Task = {
  id: string;
  title: string;
  description: string | null;
  assignees: string[];
  assignee_telegram_ids: number[];
  due_date: string | null;
  tags: string[];
  country: string | null;
  task_role: string | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  meeting_id: string | null;
  url: string | null;
  group_id?: string | null;
  created_by_name: string | null;  // <-- добавить
};
```

- [ ] **Шаг 2: Обновить mock-данные в `miniapp/src/lib/api.ts`**

Найти массив `mockTasks`. Добавить `created_by_name` в каждый объект:

```typescript
// Первый объект:
{ id: "1", ..., created_by_name: "Dev User" }
// Второй:
{ id: "2", ..., created_by_name: "Alice Smith" }
// Третий:
{ id: "3", ..., created_by_name: null }
```

- [ ] **Шаг 3: Убедиться что TypeScript не ругается**

```bash
cd miniapp && npx tsc --noEmit
```

Ожидаемый вывод: нет ошибок.

- [ ] **Шаг 4: Коммит**

```bash
git add miniapp/src/types.ts miniapp/src/lib/api.ts
git commit -m "feat(miniapp): add created_by_name to Task type"
git push origin sandbox_vas
```

---

### Task 3: Frontend UI — строка провенанса в TaskCard

**Files:**
- Modify: `miniapp/src/components/TaskCard.tsx`

- [ ] **Шаг 1: Добавить маппинг источников и функцию форматирования**

В начале файла после `const ROLE_LABELS`:

```typescript
const SOURCE_META: Record<string, { emoji: string; label: string }> = {
  transcript: { emoji: "🎤", label: "Transcript" },
  claude:     { emoji: "🤖", label: "Claude" },
  manual:     { emoji: "✍️", label: "Manual" },
  mini_app:   { emoji: "📱", label: "Mini App" },
};

function provenanceLine(task: Task): string | null {
  const src = SOURCE_META[task.source];
  const srcLabel = src ? `${src.emoji} ${src.label}` : task.source || null;
  const date = new Date(task.created_at).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
  const parts = [srcLabel, task.created_by_name, date].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
```

- [ ] **Шаг 2: Добавить строку провенанса в JSX**

В `TaskCard`, найти блок с `task.assignees` / `task.due_date` / `task.country`. Добавить строку провенанса **перед** этим блоком (после блока заголовка + `task_role`):

```tsx
        {(() => {
          const line = provenanceLine(task);
          return line ? (
            <p className="text-xs text-muted-foreground">{line}</p>
          ) : null;
        })()}
```

- [ ] **Шаг 3: Проверить TypeScript**

```bash
cd miniapp && npx tsc --noEmit
```

Ожидаемый вывод: нет ошибок.

- [ ] **Шаг 4: Визуальная проверка — запустить dev-сервер**

```bash
cd miniapp && npm run dev
```

Открыть `http://localhost:3000`. На карточках задач должна появиться строка вида `📱 Mini App · Dev User · 4 июн`. Убедиться что:
- Строка есть у задач с `created_by_name` и без (без имени — просто `📱 Mini App · 4 июн`)
- Остальные поля карточки не сломались
- Кнопки статуса и Edit/Delete работают

- [ ] **Шаг 5: Коммит**

```bash
git add miniapp/src/components/TaskCard.tsx
git commit -m "feat(miniapp): show provenance line on TaskCard"
git push origin sandbox_vas
```

---

### Task 4: Telegram бот — строка источника в детальной карточке

**Files:**
- Modify: `supabase/functions/swarm-bot/tasks/handlers.ts`

- [ ] **Шаг 1: Добавить маппинг источников в начало файла**

Найти в файле константу `STATUS_LABEL_FULL` (около строки 270-280). Добавить **рядом**:

```typescript
const SOURCE_LABEL_BOT: Record<string, string> = {
  transcript: "🎤 Transcript",
  claude:     "🤖 Claude",
  manual:     "✍️ Вручную",
  mini_app:   "📱 Mini App",
};
```

- [ ] **Шаг 2: Добавить строку источника в `buildTaskDetailMessage`**

Найти функцию `buildTaskDetailMessage` (около строки 282). Текущий шаблон текста:

```typescript
  const text =
    `📌 <b>${task.title}</b>\n\n` +
    `👤 ${who}\n` +
    `📅 Дедлайн: ${due}\n` +
    `🏷 Статус: ${statusLabel}`;
```

Заменить на:

```typescript
  const srcLabel = SOURCE_LABEL_BOT[task.source] ?? task.source ?? "—";
  const text =
    `📌 <b>${task.title}</b>\n\n` +
    `👤 ${who}\n` +
    `📅 Дедлайн: ${due}\n` +
    `🏷 Статус: ${statusLabel}\n` +
    `📍 Источник: ${srcLabel}`;
```

- [ ] **Шаг 3: Задеплоить бота**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

Ожидаемый вывод: `Deployed Functions swarm-bot` без ошибок.

- [ ] **Шаг 4: Проверить в Telegram**

Открыть бота, зайти в список задач (`/tasks`), нажать на любую задачу. В карточке внизу должна появиться строка `📍 Источник: 🎤 Transcript` (или другое значение source).

- [ ] **Шаг 5: Коммит**

```bash
git add supabase/functions/swarm-bot/tasks/handlers.ts
git commit -m "feat(bot): show source in task detail message"
git push origin sandbox_vas
```

---

### Task 5: CHANGELOG + ARCHITECTURE

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md` (если нужно — раздел про задачи)

- [ ] **Шаг 1: Добавить запись в CHANGELOG**

В `docs/CHANGELOG.md` добавить запись (в начало файла, или в секцию текущего дня):

```markdown
## 2026-06-04

### feat: пометка источника задачи

- `swarm-api` GET /tasks теперь возвращает `created_by_name` (батч-резолв из `user_profiles`)
- `miniapp` TaskCard показывает строку провенанса: источник · автор · дата создания
- `swarm-bot` детальная карточка задачи показывает строку `📍 Источник`
```

- [ ] **Шаг 2: Коммит**

```bash
git add docs/CHANGELOG.md
git commit -m "docs: CHANGELOG для task source badge"
git push origin sandbox_vas
```
