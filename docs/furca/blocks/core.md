<!-- block.md — the spec of one product block. A copy is placed in docs/furca/blocks/<name>.md during the plan phase; from then on the agent responsible for the block maintains it (Docs-as-DoD — updated together with the code, not afterwards). -->

# Block: <!-- block name, e.g. "api" or "web" -->

**core**

## Purpose

<!-- What this block does in the product and why it is a separate unit rather than part of another block. Two or three sentences. -->

Чистая логика доски: кто уезжает в следующий спринт и почему, итоги спринта, разбор ссылок, прогресс
инициатив и семь таблиц аналитики. Отдельный блок, потому что это **ядро проекта** — ошибка здесь молчит
(неверная цифра в отчёте выглядит как правда), и оно пишется тестами вперёд, без базы и без экранов.
Одна и та же логика нужна и SQL-функции приёмки, и роутам, и экранам — описываем её один раз.

## API contract

<!-- Exact function signatures / HTTP endpoints / message formats this block provides to other blocks. Example: "POST /api/links {url: string} -> {id: string, short_url: string}". Changed only in agreement with the blocks that depend on it. -->

```ts
// supabase/functions/_shared/tasks/sprint-carry.ts
export type CarryKind = "stay" | "manual" | "auto" | "mention";
export function planCarry(items: readonly SprintItemView[]): { id: string; kind: CarryKind }[];

// supabase/functions/_shared/tasks/sprint-stats.ts  (расширение существующего)
export function computeSprintStats(items: readonly SprintItemView[]): SprintStats;

// supabase/functions/_shared/tasks/sprint-cycles.ts
export function nextCycleDates(prev: { start_date: string; end_date: string; name: string }):
  { start_date: string; end_date: string; check_date: string; name: string };

// supabase/functions/_shared/tasks/links.ts
export function parseLinks(input: unknown): { title: string | null; url: string }[];

// miniapp/src/lib/initiatives.ts, miniapp/src/lib/spaceAnalytics.ts
export function buildSpaceReport(...): string;  // markdown выгрузки
```

## Dependencies

<!-- Which other product blocks this one depends on (names from the graph in plan.md) and which external services or libraries it needs (with versions, if known). "—" if there are none. -->

`—` (ни от чего не зависит: чистые функции без базы, сети и DOM).

## Definition of Done for the block

<!-- A checkable list for THIS block: tests green WITH the number actually executed named (a run that silently skips is not green — on a live project the gate stayed green through 339 unexecuted checks), coverage no lower than at the previous acceptance, the project's static checks green, the block's flow smoke-tested for real, the block's documentation updated and the CHANGELOG appended, integration with dependent blocks not broken.

It provides or consumes a contract from the technical plan — a contract check from its own side is mandatory: the consumer verifies that it calls what was declared, the provider that it returns what was declared.

There are screens — visual items are mandatory: the screen matches the reference in docs/furca/design/ (compared by opening both, not from memory), the empty / loading / error / no-access states are drawn, components come from the visual system rather than being drawn again. Without them acceptance lets through a screen that does not look like what was designed: tests green, wrong product.

Every item carries the stage it belongs to (the "stage" column), if the block is not built in one pass. Why: the contract is written for the whole block while the work goes in waves, and the agent receives a list where half the items belong to the fourth wave — on a live run that was three languages and a reference-data admin panel for one block, deployment and CI for another. The only thing that saved it was the dispatcher spelling out the boundary in the assignment, which means the assignment depended on what the dispatcher remembered. The marker puts the boundary back into the contract itself: the agent sees its part, and acceptance checks against the same line. A block built in one pass does not need the column — put "—". -->

| stage | readiness item |
| --- | --- |

| 1 | `planCarry`: закрытая остаётся; помеченная — «вручную» с причиной; незакрытая — «автоматически»; пометка у закрытой игнорируется; упоминание удалённой не переносится и не считается |
| 1 | `nextCycleDates`: встык к прошлому, 14 дней, сверка на шестой день, номер N+1, имя «Спринт N · дд.мм — дд.мм» |
| 1 | `computeSprintStats`: новые ключи; **отменённая не входит ни в «сделано», ни в знаменатель** (D010); сверка с ручным пересчётом |
| 1 | `parseLinks`: только http/https, не больше 20, без повторов, `javascript:` — отказ с внятной ошибкой |
| 3 | `initiatives.ts`: прогресс инициативы, «не отмечено» с дня сверки, «×N» с двух переносов |
| 4 | `spaceAnalytics.ts` и `buildSpaceReport`: семь таблиц и markdown сходятся с ручным пересчётом |
| 1–4 | тесты написаны **до** кода, `make porcha` зелёный на каждом модуле ядра |
| 1–4 | `make check` зелёный: покрытие не ниже 78%, пропусков нет |

## Status

<!-- The block's current status: not_started / in_progress / done / blocked. One line with the date it was last updated. -->

`not_started` — 18.09.2026, ждёт «ок» владельца на гейте.
