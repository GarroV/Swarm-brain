# Дизайн: LLM-матчинг пользователей из транскриптов

**Дата:** 2026-05-19  
**Файл:** `supabase/functions/swarm-bot/handlers/tasks.ts`  
**Функция:** `analyzeAndCreateTasks`

## Проблема

Текущий post-processing матчинг (`string.includes`) ломается когда имя в транскрипте отличается от профиля — разное написание, сокращения, кириллица/латиница. LLM уже получает список команды, но итоговое сопоставление делается строками.

## Решение

Передавать в промпт список пользователей с `telegram_id`, просить модель вернуть `assignee_id: number`. После ответа — прямой lookup по ID, без fuzzy matching.

## Изменения

### 1. Запрос профилей

```ts
// было
supabase.from("user_profiles").select("first_name, last_name, markets")

// стало
supabase.from("user_profiles").select("telegram_id, first_name, last_name, username, role, markets")
```

### 2. Промпт

```
Члены команды (JSON):
[{"id":123456,"name":"Василий Петров","username":"vasya","role":"BD","markets":["Словения"]}]

Верни ТОЛЬКО JSON без markdown:
{"tasks":[{"title":"...","assignee_id":123456,"due_date":"YYYY-MM-DD или null","confidence":0.9}]}

assignee_id — telegram_id из списка выше, или null если исполнитель неизвестен.
```

### 3. Post-processing

```ts
// строим map до цикла
const profileMap = Object.fromEntries(
  (profiles ?? []).map(p => [
    p.telegram_id,
    [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || String(p.telegram_id)
  ])
);

// в цикле
const assignees: string[] = [];
if (task.assignee_id && profileMap[task.assignee_id]) {
  assignees.push(profileMap[task.assignee_id]);
}
```

## Крайние случаи

| Ситуация | Поведение |
|---|---|
| `assignee_id: null` | `assignees: []`, задача без исполнителя |
| LLM вернул несуществующий ID | lookup → `undefined`, `assignees: []` |
| Имя не заполнено в профиле | fallback на `@username`, затем на `String(telegram_id)` |

## Что не меняется

- Схема БД (`assignees text[]`)
- Статус задач (`pending`)
- Порог confidence (0.7)
- Остальные функции бота
