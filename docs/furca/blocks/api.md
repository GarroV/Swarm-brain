<!-- block.md — the spec of one product block. A copy is placed in docs/furca/blocks/<name>.md during the plan phase; from then on the agent responsible for the block maintains it (Docs-as-DoD — updated together with the code, not afterwards). -->

# Block: <!-- block name, e.g. "api" or "web" -->

**api**

## Purpose

<!-- What this block does in the product and why it is a separate unit rather than part of another block. Two or three sentences. -->

Роуты `swarm-api`: спринты пространства, состав, сверка и перенос, приёмка, журнал пространства, поля
ссылок и ответственного инициативы. Отдельный блок, потому что здесь живёт вся проверка доступа: RLS без
политик, замок только в коде.

## API contract

<!-- Exact function signatures / HTTP endpoints / message formats this block provides to other blocks. Example: "POST /api/links {url: string} -> {id: string, short_url: string}". Changed only in agreement with the blocks that depend on it. -->

`GET /sprint-cycles?tab_id=` · `POST /sprint-cycles` · `POST /sprint-cycles/:id/start` ·
`POST /sprint-cycles/:id/accept` · `DELETE /sprint-cycles/:id` (админ) ·
`GET|POST|DELETE /sprint-cycles/:id/items` · `PATCH /sprint-cycles/:id/items/:taskId`
(`{check_status?, check_note?, to_carry?, carry_reason?}`) · `GET /spaces/:tabId/journal?days=` ·
`links` у задач, `owner_telegram_id`/`start_date`/`end_date` у проектов.

## Dependencies

<!-- Which other product blocks this one depends on (names from the graph in plan.md) and which external services or libraries it needs (with versions, if known). "—" if there are none. -->

`db`, `core`.

## Definition of Done for the block

<!-- A checkable list for THIS block: tests green WITH the number actually executed named (a run that silently skips is not green — on a live project the gate stayed green through 339 unexecuted checks), coverage no lower than at the previous acceptance, the project's static checks green, the block's flow smoke-tested for real, the block's documentation updated and the CHANGELOG appended, integration with dependent blocks not broken.

It provides or consumes a contract from the technical plan — a contract check from its own side is mandatory: the consumer verifies that it calls what was declared, the provider that it returns what was declared.

There are screens — visual items are mandatory: the screen matches the reference in docs/furca/design/ (compared by opening both, not from memory), the empty / loading / error / no-access states are drawn, components come from the visual system rather than being drawn again. Without them acceptance lets through a screen that does not look like what was designed: tests green, wrong product.

Every item carries the stage it belongs to (the "stage" column), if the block is not built in one pass. Why: the contract is written for the whole block while the work goes in waves, and the agent receives a list where half the items belong to the fourth wave — on a live run that was three languages and a reference-data admin panel for one block, deployment and CI for another. The only thing that saved it was the dispatcher spelling out the boundary in the assignment, which means the assignment depended on what the dispatcher remembered. The marker puts the boundary back into the contract itself: the agent sees its part, and acceptance checks against the same line. A block built in one pass does not need the column — put "—". -->

| stage | readiness item |
| --- | --- |

| 1 | новые роуты — отдельными модулями; `swarm-api/index.ts` не растёт (#265) |
| 1 | гварды: чужой воркспейс → 400, второй живой спринт → 409, сверка и перенос на принятом → 409, удаление не-админом → 403 |
| 1 | приватная задача не попадает ни в состав, ни в журнал, ни в отчёт — тест |
| 1 | приёмка зовёт SQL-функцию; `23505` и `P0001` различаются по `error.code`, не по тексту |
| 1 | `deno check` зелёный, живой прогон роутов на локальном контуре |

## Status

<!-- The block's current status: not_started / in_progress / done / blocked. One line with the date it was last updated. -->

`not_started` — 18.09.2026, ждёт «ок» владельца на гейте.
