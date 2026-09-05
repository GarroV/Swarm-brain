// Типы навигации Роя — ДАННЫЕ, отделённые от React.
// Вынесены из components/roy/nav.ts по той же причине, что и пути иконок в royIcons.ts:
// Deno тайпчекает тесты в lib/, а модуль, который тянет `react`, он собрать не может —
// прогон обрывался на весь репозиторий. Рендер и контекст остались в nav.ts, он же
// ре-экспортирует эти типы, поэтому импорты остальных файлов не тронуты.

// Мобильный таб-бар (см. ROY_TABS в ui.tsx): Задачи · Встречи · Ещё (+ Проекты, шаг 4).
// `search` и `book` остаются в союзе как ДЕСКТОПНЫЕ разделы: на десктопе `search` — дашборд-дом,
// `book` — база. На мобайле их в таб-баре нет: поиск живёт иконкой в шапке (push-роут `ask`),
// база — пунктом «Ещё» (push-роут `base`). Решение владельца 2026-08-22 (набор табов «задачи,
// проекты, встречи, еще»), см. docs/decisions/2026-08-22-mobile-nav.md.
export type RoyTab = "search" | "task" | "projects" | "book" | "cal" | "more";

export type RoyRoute =
  | { view: "answer"; params: { query: string } }
  | { view: "record"; params: { id: string } }
  | { view: "taskDetail"; params: { id: string } }
  | { view: "newTask"; params?: { id?: string } }
  | { view: "newEntry" }
  | { view: "ask" }
  | { view: "base" }
  | { view: "project"; params: { id: string } }
  | { view: "meetingDetail"; params: { id: string } }
  | { view: "meetingReview"; params: { id: string } }
  | { view: "settings" }
  | { view: "team" }
  | { view: "admin" }
  | { view: "more" }
  | { view: "map" }
  | { view: "meetAdmin"; params?: { mode?: "review" | "all" } };
