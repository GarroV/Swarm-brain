# Meeting Naming Glossary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Тезисы встреч перестают выдавать уверенно-неверные имена собственные (`Volt`→Wolt, `Billbride`→Београд, `Noveside`→Нови Сад) за счёт сид-словаря в коде + правила в промпте + Whisper-хинта.

**Architecture:** Новый DRY-модуль `_shared/glossary.ts` (сид + два билдера строк). Промпт `tezisy-prompt.ts` компонует `TEZISY_PROMPT = TEZISY_CORE + блок словаря`; три потребителя (`meeting-processor`, `granola`, `read-ai-webhook`) переключаются с `TEZISY_CORE` на `TEZISY_PROMPT`. Whisper-хинт добавляется в `transcribeAudio` (рекордерный путь). Никакой БД/админки/авто-детекта.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, `deno test` (std@0.224.0 assert), OpenAI (whisper-1, gpt-5.6-terra).

## Global Constraints

- Тезисы ВСЕГДА на русском; стенограмма не трогается (существующее правило `TEZISY_CORE`).
- Канон топонимов — кириллицей ровно как пишет владелец: `Београд`, `Нови Сад`. Глобальные бренды — латиницей: `Wolt`, `Dodo`.
- Все `aliases` в словаре — в нижнем регистре.
- `deno check` затронутых функций обязан быть зелёным перед коммитом (pre-commit хук `.githooks/pre-commit`; активировать один раз: `git config core.hooksPath .githooks`).
- Коммиты — conventional (`feat/fix/docs/...`), по-русски, по сути.
- Работаем в worktree-ветке `worktree-meeting-naming`; на команду не катим до проверки на реальной встрече `098380b7-0a9c-43bd-98ce-1a5abf020819`.

---

### Task 1: Модуль словаря `_shared/glossary.ts`

**Files:**
- Create: `supabase/functions/_shared/glossary.ts`
- Test: `supabase/functions/_shared/glossary.test.ts`

**Interfaces:**
- Consumes: ничего (базовый модуль).
- Produces:
  - `interface GlossaryEntry { canonical: string; aliases: string[]; note?: string }`
  - `const MEETING_GLOSSARY: GlossaryEntry[]`
  - `function glossaryPromptBlock(entries?: GlossaryEntry[]): string` — секция для промпта тезисов (список + правило).
  - `function glossaryWhisperHint(entries?: GlossaryEntry[]): string` — canonical-имена через запятую для Whisper `prompt`.

- [ ] **Step 1: Написать падающие тесты**

Create `supabase/functions/_shared/glossary.test.ts`:

```ts
// Тесты словаря имён собственных.
// Запуск: deno test supabase/functions/_shared/glossary.test.ts
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MEETING_GLOSSARY,
  glossaryPromptBlock,
  glossaryWhisperHint,
} from "./glossary.ts";

Deno.test("glossaryPromptBlock — содержит canonical и все aliases каждой записи", () => {
  const block = glossaryPromptBlock();
  for (const e of MEETING_GLOSSARY) {
    assertStringIncludes(block, e.canonical);
    for (const a of e.aliases) assertStringIncludes(block, a);
  }
});

Deno.test("glossaryPromptBlock — содержит правило и пример Wolt≠Volt", () => {
  const block = glossaryPromptBlock();
  assertStringIncludes(block, "НЕ придумывай");
  assertStringIncludes(block, "Wolt, НЕ Volt");
});

Deno.test("glossaryWhisperHint — перечисляет все canonical", () => {
  const hint = glossaryWhisperHint();
  for (const e of MEETING_GLOSSARY) assertStringIncludes(hint, e.canonical);
});

Deno.test("MEETING_GLOSSARY — записи валидны (canonical непустой, aliases в нижнем регистре)", () => {
  assert(MEETING_GLOSSARY.length > 0);
  for (const e of MEETING_GLOSSARY) {
    assert(e.canonical.trim().length > 0, `пустой canonical: ${JSON.stringify(e)}`);
    for (const a of e.aliases) assertEquals(a, a.toLowerCase(), `alias не lowercase: ${a}`);
  }
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `deno test supabase/functions/_shared/glossary.test.ts`
Expected: FAIL (module `./glossary.ts` не найден / экспорты отсутствуют).

- [ ] **Step 3: Реализовать `glossary.ts`**

Create `supabase/functions/_shared/glossary.ts`:

```ts
// Словарь имён собственных для тезисов встреч (лёгкое ядро, в коде — не в БД).
// Причина: Whisper мишерит бренды/топонимы фонетикой («вольт», «билбрайд»),
// а LLM тезисов транслитерирует их в кривую латиницу («Volt», «Billbride»).
// Словарь нормализует известные имена и запрещает выдумывать латиницу.
// Единый источник для промпта тезисов (_shared/tezisy-prompt.ts) и Whisper-хинта
// (_shared/meeting-processor.ts). Сид подтверждён владельцем 2026-07-30.
export interface GlossaryEntry {
  canonical: string;   // как писать в тезисах
  aliases: string[];   // как звучит искажённо в стенограмме (lowercase)
  note?: string;       // короткий контекст для модели
}

export const MEETING_GLOSSARY: GlossaryEntry[] = [
  { canonical: "Wolt", aliases: ["вольт", "volt"], note: "агрегатор доставки (работает в Сербии)" },
  { canonical: "Wolt Drive", aliases: ["вольт-драйв", "вольт драйв", "volt drive"], note: "курьеры по запросу от Wolt" },
  { canonical: "Београд", aliases: ["билбрайд"], note: "город; пиццерии называются «Београд ‹номер›»" },
  { canonical: "Нови Сад", aliases: ["новейсайд", "нови сайд"], note: "город; пиццерии называются «Нови Сад ‹номер›»" },
  { canonical: "Dodo", aliases: ["додо"], note: "бренд" },
];

// Правило приоритета словаря над «знаниями» модели. Отдельная константа — чтобы
// тест мог проверить её наличие независимо от списка.
export const GLOSSARY_NAMING_RULE =
  "ПРАВИЛО ПО ИМЕНАМ СОБСТВЕННЫМ: НЕ придумывай английское/латинское написание названий. " +
  "Если название есть в СЛОВАРЕ выше — пиши строго по словарю, ДАЖЕ если кажется, что знаешь бренд " +
  "лучше (в речи «вольт» → пиши Wolt, НЕ Volt). Если названия нет в словаре — оставь его КАК В " +
  "СТЕНОГРАММЕ (кириллицей), не транслитерируй наугад. Номер при названии пиццерии сохраняй: " +
  "«билбрайд 2» → «Београд 2».";

// Секция словаря для системного промпта тезисов: список + правило.
export function glossaryPromptBlock(entries: GlossaryEntry[] = MEETING_GLOSSARY): string {
  const lines = entries.map((e) => {
    const heard = e.aliases.length
      ? ` (в речи: ${e.aliases.map((a) => `«${a}»`).join(", ")})`
      : "";
    const note = e.note ? ` — ${e.note}` : "";
    return `- ${e.canonical}${heard}${note}`;
  });
  return [
    "СЛОВАРЬ ИМЁН СОБСТВЕННЫХ — пиши ИМЕННО так (в стенограмме Whisper мог записать их искажённо, кириллицей):",
    ...lines,
    "",
    GLOSSARY_NAMING_RULE,
  ].join("\n");
}

// Строка канонических имён для Whisper-параметра `prompt` (best-effort хинт написания).
// Заведомо коротко (≪ 224 токена — лимит Whisper).
export function glossaryWhisperHint(entries: GlossaryEntry[] = MEETING_GLOSSARY): string {
  return entries.map((e) => e.canonical).join(", ");
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `deno test supabase/functions/_shared/glossary.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: `deno check`**

Run: `deno check supabase/functions/_shared/glossary.ts`
Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add supabase/functions/_shared/glossary.ts supabase/functions/_shared/glossary.test.ts
git commit -m "feat(meetings): словарь имён собственных для тезисов (сид + билдеры)"
```

---

### Task 2: Инъекция словаря в промпт тезисов (3 потребителя)

**Files:**
- Modify: `supabase/functions/_shared/tezisy-prompt.ts`
- Test: `supabase/functions/_shared/tezisy-prompt.test.ts` (create)
- Modify: `supabase/functions/_shared/meeting-processor.ts:30,51`
- Modify: `supabase/functions/swarm-bot/handlers/granola.ts:6,15`
- Modify: `supabase/functions/read-ai-webhook/index.ts:6,261`

**Interfaces:**
- Consumes: `glossaryPromptBlock` из Task 1.
- Produces: `const TEZISY_PROMPT: string` (экспорт из `tezisy-prompt.ts`) = `TEZISY_CORE` + блок словаря. `TEZISY_CORE` остаётся экспортированным без изменений.

- [ ] **Step 1: Написать падающий тест**

Create `supabase/functions/_shared/tezisy-prompt.test.ts`:

```ts
// Тест композиции промпта тезисов со словарём.
// Запуск: deno test supabase/functions/_shared/tezisy-prompt.test.ts
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TEZISY_CORE, TEZISY_PROMPT } from "./tezisy-prompt.ts";

Deno.test("TEZISY_PROMPT — включает ядро", () => {
  assertStringIncludes(TEZISY_PROMPT, "Сделай тезисы встречи");
});

Deno.test("TEZISY_PROMPT — включает блок словаря и пример Wolt", () => {
  assertStringIncludes(TEZISY_PROMPT, "СЛОВАРЬ ИМЁН СОБСТВЕННЫХ");
  assertStringIncludes(TEZISY_PROMPT, "Wolt");
  assertStringIncludes(TEZISY_PROMPT, "Wolt, НЕ Volt");
});

Deno.test("TEZISY_CORE — ядро без блока словаря (композиция не мутировала ядро)", () => {
  // Ядро само по себе НЕ содержит секцию словаря.
  if (TEZISY_CORE.includes("СЛОВАРЬ ИМЁН СОБСТВЕННЫХ")) {
    throw new Error("TEZISY_CORE не должен содержать блок словаря — он только в TEZISY_PROMPT");
  }
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `deno test supabase/functions/_shared/tezisy-prompt.test.ts`
Expected: FAIL (`TEZISY_PROMPT` не экспортирован).

- [ ] **Step 3: Добавить композицию в `tezisy-prompt.ts`**

В конец `supabase/functions/_shared/tezisy-prompt.ts` (после `TEZISY_CORE`, `TEZISY_CORE` НЕ трогаем):

```ts
import { glossaryPromptBlock } from "./glossary.ts";

// Готовый системный промпт тезисов = ядро + словарь имён собственных.
// Все потребители (рекордер/granola/read-ai) используют ЭТО, а не голое ядро.
export const TEZISY_PROMPT = TEZISY_CORE + "\n\n" + glossaryPromptBlock();
```

Примечание: строку `import` поставить в начало файла (ES-модули требуют импорт на верхнем уровне), а `export const TEZISY_PROMPT` — в конце, после определения `TEZISY_CORE`.

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `deno test supabase/functions/_shared/tezisy-prompt.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Переключить потребителя 1 — `meeting-processor.ts`**

- Строка 30: `import { TEZISY_CORE } from "./tezisy-prompt.ts";` → `import { TEZISY_PROMPT } from "./tezisy-prompt.ts";`
- Строка 51: `  TEZISY_CORE + "\n" +` → `  TEZISY_PROMPT + "\n" +`

- [ ] **Step 6: Переключить потребителя 2 — `granola.ts`**

- Строка 6: `import { TEZISY_CORE } from "../../_shared/tezisy-prompt.ts";` → `import { TEZISY_PROMPT } from "../../_shared/tezisy-prompt.ts";`
- Строка 15: `const GRANOLA_TEZISY_PROMPT = TEZISY_CORE;` → `const GRANOLA_TEZISY_PROMPT = TEZISY_PROMPT;`

- [ ] **Step 7: Переключить потребителя 3 — `read-ai-webhook/index.ts`**

- Строка 6: `import { TEZISY_CORE } from "../_shared/tezisy-prompt.ts";` → `import { TEZISY_PROMPT } from "../_shared/tezisy-prompt.ts";`
- Строка 261: `      chatComplete(TEZISY_CORE, tezisSource),` → `      chatComplete(TEZISY_PROMPT, tezisSource),`

- [ ] **Step 8: `deno check` всех затронутых + прогон тестов словаря**

Run:
```bash
deno check supabase/functions/_shared/meeting-processor.ts supabase/functions/swarm-bot/handlers/granola.ts supabase/functions/read-ai-webhook/index.ts
deno test supabase/functions/_shared/glossary.test.ts supabase/functions/_shared/tezisy-prompt.test.ts
```
Expected: check без ошибок; тесты PASS.

- [ ] **Step 9: Коммит**

```bash
git add supabase/functions/_shared/tezisy-prompt.ts supabase/functions/_shared/tezisy-prompt.test.ts supabase/functions/_shared/meeting-processor.ts supabase/functions/swarm-bot/handlers/granola.ts supabase/functions/read-ai-webhook/index.ts
git commit -m "feat(meetings): подключить словарь имён к промпту тезисов (3 потребителя)"
```

---

### Task 3: Whisper-хинт в транскрибации (рекордерный путь)

**Files:**
- Modify: `supabase/functions/_shared/meeting-processor.ts:30, ~113`

**Interfaces:**
- Consumes: `glossaryWhisperHint` из Task 1.
- Produces: ничего нового (side-effect: Whisper получает `prompt`-хинт написания имён).

- [ ] **Step 1: Расширить импорт словаря**

Строка 30 `meeting-processor.ts` (уже импортирует `TEZISY_PROMPT`) — добавить импорт хинта отдельной строкой рядом:

```ts
import { glossaryWhisperHint } from "./glossary.ts";
```

- [ ] **Step 2: Добавить `prompt` в FormData `transcribeAudio`**

В `transcribeAudio`, сразу после строки `form.append("response_format", "verbose_json");` (строка 113) добавить:

```ts
  // Хинт написания имён собственных (Wolt/Београд/Нови Сад…) — снижает мишеринг Whisper.
  // best-effort: `prompt` в Whisper только смещает распознавание, не гарантирует.
  form.append("prompt", glossaryWhisperHint());
```

- [ ] **Step 3: `deno check`**

Run: `deno check supabase/functions/_shared/meeting-processor.ts`
Expected: без ошибок.

- [ ] **Step 4: Коммит**

```bash
git add supabase/functions/_shared/meeting-processor.ts
git commit -m "feat(meetings): Whisper-хинт написания имён собственных при транскрибации"
```

---

### Task 4: Доки, деплой и проверка на реальной встрече

**Files:**
- Modify: `docs/QUICK_REF.md` (строка про промпт тезисов)
- Modify: `docs/ARCHITECTURE.md` (§ Флоу встреч — где описан шаг тезисов)

**Interfaces:**
- Consumes: всё из Task 1–3.
- Produces: обновлённые доки; подтверждение на проде.

- [ ] **Step 1: Обновить QUICK_REF**

В `docs/QUICK_REF.md` найти строку (≈89) с «Промпт тезисов (канон, DRY)…» и добавить `_shared/glossary.ts` в список файлов. Заменить:

```
| Промпт тезисов (канон, DRY) + guard пустого ответа GPT-5 (reasoning-burn → фолбэк) | `_shared/tezisy-prompt.ts`, `_shared/openai-chat.ts` (+ `.test.ts`) | §Флоу встреч |
```
на:
```
| Промпт тезисов (канон, DRY) + словарь имён собственных (нормализация Wolt/Београд/…) + guard пустого ответа GPT-5 | `_shared/tezisy-prompt.ts`, `_shared/glossary.ts`, `_shared/openai-chat.ts` (+ `.test.ts`) | §Флоу встреч |
```

- [ ] **Step 2: Обновить ARCHITECTURE**

В `docs/ARCHITECTURE.md` найти раздел «Флоу встреч» (шаг генерации тезисов). Добавить абзац:

```
**Словарь имён собственных.** Whisper мишерит бренды/топонимы фонетикой («вольт», «билбрайд»), а LLM тезисов транслитерирует их в кривую латиницу («Volt», «Billbride»). Сид-словарь `_shared/glossary.ts` (`MEETING_GLOSSARY`) добавляется в системный промпт (`TEZISY_PROMPT`) во всех 3 точках генерации (рекордер/granola/read-ai) и как `prompt`-хинт Whisper: известные имена нормализуются (Wolt/Wolt Drive/Београд/Нови Сад/Dodo), незнакомые — остаются как в стенограмме, без выдумывания латиницы. Словарь в коде (без БД/админки — сознательно, YAGNI).
```

- [ ] **Step 3: Коммит доков**

```bash
git add docs/QUICK_REF.md docs/ARCHITECTURE.md
git commit -m "docs(meetings): словарь имён собственных в QUICK_REF и ARCHITECTURE"
```

- [ ] **Step 4: Слить ветку в main и задеплоить затронутые функции**

```bash
cd /Users/garva/Documents/projects/Swarm-brain   # основной чекаут, ветка main
git pull --rebase origin main
git merge --no-ff worktree-meeting-naming -m "feat(meetings): словарь имён собственных для тезисов"
git push origin main
supabase functions deploy meeting-process --no-verify-jwt
supabase functions deploy meeting-ingest --no-verify-jwt
supabase functions deploy swarm-bot --no-verify-jwt
supabase functions deploy read-ai-webhook --no-verify-jwt
```
(Затронуты: `_shared/meeting-processor.ts` → `meeting-process`/`meeting-ingest`; `_shared/tezisy-prompt.ts`+`glossary.ts` → все три; `granola.ts` → `swarm-bot`; `read-ai-webhook`.)

- [ ] **Step 5: Прод-смоук — переобработать встречу `098380b7`**

Найти механизм переобработки:
```bash
grep -rn "reprocess\|переобработ\|re-summ\|resummar\|process_state" supabase/functions/swarm-api
```
Использовать эндпоинт переобработки swarm-api (кнопка есть в `MeetAdminScreen.tsx`); при отсутствии удобного пути — сбросить стадию через SQL, чтобы cron `meetings-process` перегенерил тезисы новым промптом:
```sql
-- через Supabase MCP execute_sql (project vbqglndbxkpmreccpqmr)
UPDATE meetings
SET summary_status = NULL,
    process_state = jsonb_set(process_state, '{stage}', '"summarize"')
WHERE id = '098380b7-0a9c-43bd-98ce-1a5abf020819';
```
Подождать прогон cron (≤1–2 мин), затем проверить результат:
```sql
SELECT left(draft_notes_md, 600) FROM meetings WHERE id='098380b7-0a9c-43bd-98ce-1a5abf020819';
```
**Критерий успеха:** в тезисах `Wolt`/`Wolt Drive`, `Београд 1/2`, `Нови Сад 1` — НЕТ `Volt`/`Billbride`/`Noveside`.

- [ ] **Step 6: Обновить BACKLOG (если заводили долг) и убрать worktree**

```bash
git worktree remove /Users/garva/Documents/projects/Swarm-brain/.claude/worktrees/meeting-naming
```
(Только после подтверждения смоука. На команду ничего дополнительно катить не нужно — правка на общем промпте, эффект на всех будущих встречах.)

---

## Self-Review

- **Spec coverage:** §4.1 модуль → Task 1; §4.2 сид → Task 1 (MEETING_GLOSSARY); §4.3 промпт+3 точки → Task 2; §4.4 Whisper-хинт → Task 3; §5 тесты/проверка → Task 1/2 (юниты) + Task 4 (прод-смоук); §6 дрифт доков → Task 4; §7 DoD → покрыт Task 1–4. Отложенное (БД/админка/авто-детект/regex/бэкфилл) — вне плана осознанно.
- **Placeholder scan:** код приведён целиком во всех шагах; тестовый код реальный; правки указаны точными строками и заменами.
- **Type consistency:** `GlossaryEntry`/`MEETING_GLOSSARY`/`glossaryPromptBlock`/`glossaryWhisperHint`/`GLOSSARY_NAMING_RULE` (Task 1) → используются под теми же именами в Task 2/3. `TEZISY_PROMPT` определён в Task 2 и там же потребляется.
