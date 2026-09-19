<!-- block.md — the spec of one product block. A copy is placed in docs/furca/blocks/<name>.md during the plan phase; from then on the agent responsible for the block maintains it (Docs-as-DoD — updated together with the code, not afterwards). -->

# Block: <!-- block name, e.g. "api" or "web" -->

**visual**

## Purpose

<!-- What this block does in the product and why it is a separate unit rather than part of another block. Two or three sentences. -->

Единый визуальный язык доски: строка задачи, плашка исполнителя, метки, полоска прогресса, баннер, шкала
ритуала, таблица аналитики, переключатель вида. Отдельный блок и раньше экранов — иначе каждый экран
рисует свою кнопку, и сведение стоит дороже, чем договориться заранее.

## API contract

<!-- Exact function signatures / HTTP endpoints / message formats this block provides to other blocks. Example: "POST /api/links {url: string} -> {id: string, short_url: string}". Changed only in agreement with the blocks that depend on it. -->

Компоненты в `miniapp/src/components/tasks/sprints/`: `TaskRow`, `OwnerTag`, `StatusMark`,
`ProgressBar`, `Banner`, `RitualTimeline`, `AnalyticsTable`, `ViewSwitch`. Каждый — со всеми состояниями
(пусто, загрузка, ошибка, нет прав) и в обеих темах. Берут `ui/select` и прочие общие примитивы Swarm,
нативные выпадающие списки не используются.

## Dependencies

<!-- Which other product blocks this one depends on (names from the graph in plan.md) and which external services or libraries it needs (with versions, if known). "—" if there are none. -->

`—` (эталон экранов — `docs/furca/design/`, дизайн-система веба Swarm).

## Definition of Done for the block

<!-- A checkable list for THIS block: tests green WITH the number actually executed named (a run that silently skips is not green — on a live project the gate stayed green through 339 unexecuted checks), coverage no lower than at the previous acceptance, the project's static checks green, the block's flow smoke-tested for real, the block's documentation updated and the CHANGELOG appended, integration with dependent blocks not broken.

It provides or consumes a contract from the technical plan — a contract check from its own side is mandatory: the consumer verifies that it calls what was declared, the provider that it returns what was declared.

There are screens — visual items are mandatory: the screen matches the reference in docs/furca/design/ (compared by opening both, not from memory), the empty / loading / error / no-access states are drawn, components come from the visual system rather than being drawn again. Without them acceptance lets through a screen that does not look like what was designed: tests green, wrong product.

Every item carries the stage it belongs to (the "stage" column), if the block is not built in one pass. Why: the contract is written for the whole block while the work goes in waves, and the agent receives a list where half the items belong to the fourth wave — on a live run that was three languages and a reference-data admin panel for one block, deployment and CI for another. The only thing that saved it was the dispatcher spelling out the boundary in the assignment, which means the assignment depended on what the dispatcher remembered. The marker puts the boundary back into the contract itself: the agent sees its part, and acceptance checks against the same line. A block built in one pass does not need the column — put "—". -->

| stage | readiness item |
| --- | --- |

| 2 | компоненты собраны по эталону, сверка открытием обоих, а не по памяти |
| 2 | нарисованы состояния: пусто, загрузка, ошибка, нет прав |
| 2 | обе темы, ширина телефона: список, сверка и «Все инициативы» читаемы, кнопки нажимаемы (D003) |
| 2 | ни один экран не рисует свою версию строки задачи |

## Status

<!-- The block's current status: not_started / in_progress / done / blocked. One line with the date it was last updated. -->

`not_started` — 18.09.2026, ждёт «ок» владельца на гейте.
