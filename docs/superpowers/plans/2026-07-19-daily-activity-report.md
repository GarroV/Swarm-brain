# Ежедневный отчёт активности — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Владелец (админ) каждое утро получает в Telegram сводку активности за вчерашние сутки: сколько встреч и сколько новых данных добавлено, с разбивкой по воркспейсам и источникам.

**Architecture:** Новый изолированный хендлер `swarm-bot/handlers/daily-report.ts` с чистым тестируемым ядром (окно времени → агрегация → формат) и тонким I/O (`sendDailyReport`). Два входа: cron-триггер `daily_report_cron` и админская команда `/report`. Считаем строки `entries` по `entry_type` (`meeting`/`note`) за вчерашние календарные сутки в TZ `Europe/Belgrade`.

**Tech Stack:** Deno (Supabase Edge Function `swarm-bot`), Supabase Postgres, Telegram Bot API. Тесты — `deno test` + `std/assert`.

## Global Constraints

- Ветка разработки — `sandbox_vas`; в `main` не коммитить.
- Каждый затронутый edge-функционал должен проходить `deno check` (pre-commit хук блокирует красное).
- Деплой edge-функций всегда с `--no-verify-jwt`.
- Commit-сообщения строго conventional (`feat/fix/docs/test/chore/...`), т.к. changelog генерится из git.
- Документация — часть Definition of Done: инвентари (Edge Functions, команды, env/cron) обновляются тем же изменением.
- Стиль: чистые функции отделены от I/O; без мутаций общих объектов; без `console.log`.
- `ADMIN_USER_ID = 744230399` и клиент `supabase` берутся из `swarm-bot/lib/supabase.ts` (не хардкодить заново).
- Спека: `docs/superpowers/specs/2026-07-19-daily-activity-report-design.md`.

---

### Task 1: Окно времени `yesterdayWindow` (чистая функция)

**Files:**
- Create: `supabase/functions/swarm-bot/handlers/daily-report.ts`
- Test: `supabase/functions/swarm-bot/handlers/daily-report.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `interface DayWindow { sinceISO: string; untilISO: string; dateLabel: string }`; `function yesterdayWindow(tz?: string, now?: Date): DayWindow`; константа `REPORT_TZ = "Europe/Belgrade"`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/swarm-bot/handlers/daily-report.test.ts
// Запуск: deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { yesterdayWindow } from "./daily-report.ts";

Deno.test("yesterdayWindow: лето (CEST, UTC+2) — вчерашние локальные сутки в UTC", () => {
  // now = 2026-07-18 07:30 по Белграду (05:30 UTC). Вчера = 2026-07-17.
  const w = yesterdayWindow("Europe/Belgrade", new Date("2026-07-18T05:30:00Z"));
  assertEquals(w.sinceISO, "2026-07-16T22:00:00.000Z"); // 2026-07-17 00:00 +02:00
  assertEquals(w.untilISO, "2026-07-17T22:00:00.000Z"); // 2026-07-18 00:00 +02:00
  assertEquals(w.dateLabel, "17.07");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts`
Expected: FAIL — модуль/функция `yesterdayWindow` не найдена.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/swarm-bot/handlers/daily-report.ts
export const REPORT_TZ = "Europe/Belgrade";

export interface DayWindow {
  sinceISO: string;
  untilISO: string;
  dateLabel: string;
}

// UTC-инстант локальной полуночи даты `localDate` (YYYY-MM-DD) в таймзоне `tz`.
// Смещение tz читается из Intl на этот момент → устойчиво к переходу на летнее время.
function tzMidnightUTC(localDate: string, tz: string): Date {
  const guess = new Date(`${localDate}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = asUTC - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

export function yesterdayWindow(tz: string = REPORT_TZ, now: Date = new Date()): DayWindow {
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const todayLocal = dateFmt.format(now);
  const todayMidnightUTC = tzMidnightUTC(todayLocal, tz);
  // Шаг на 12ч назад гарантированно попадает во «вчера» даже в 23/25-часовые DST-сутки.
  const yProbe = new Date(todayMidnightUTC.getTime() - 12 * 3_600_000);
  const yLocal = dateFmt.format(yProbe);
  const sinceUTC = tzMidnightUTC(yLocal, tz);
  const [, mm, dd] = yLocal.split("-");
  return {
    sinceISO: sinceUTC.toISOString(),
    untilISO: todayMidnightUTC.toISOString(),
    dateLabel: `${dd}.${mm}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/daily-report.ts supabase/functions/swarm-bot/handlers/daily-report.test.ts
git commit -m "feat(report): окно вчерашних суток (yesterdayWindow, TZ Europe/Belgrade)"
```

---

### Task 2: Агрегация `aggregateActivity` (чистая функция)

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/daily-report.ts`
- Test: `supabase/functions/swarm-bot/handlers/daily-report.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `interface EntryRow { entry_type: string; source: string; group_id: string | null }`
  - `interface SectionCounts { total: number; byWorkspace: Record<string, number>; bySource: Record<string, number> }`
  - `interface ReportData { meetings: SectionCounts; notes: SectionCounts }`
  - `function aggregateActivity(rows: EntryRow[]): ReportData`

- [ ] **Step 1: Write the failing test**

```ts
// добавить в daily-report.test.ts
import { aggregateActivity, type EntryRow } from "./daily-report.ts";

Deno.test("aggregateActivity: счётчики по воркспейсам и источникам", () => {
  const rows: EntryRow[] = [
    { entry_type: "meeting", source: "desktop-agent", group_id: "cee" },
    { entry_type: "meeting", source: "granola", group_id: "cee" },
    { entry_type: "meeting", source: "granola", group_id: "other" },
    { entry_type: "note", source: "telegram", group_id: "cee" },
    { entry_type: "note", source: "link", group_id: "cee" },
    { entry_type: "note", source: "voice", group_id: "other" },
  ];
  const r = aggregateActivity(rows);
  assertEquals(r.meetings.total, 3);
  assertEquals(r.meetings.byWorkspace, { CEE: 2, OTHER: 1 });
  assertEquals(r.meetings.bySource, { "рекордер": 1, granola: 2 });
  assertEquals(r.notes.total, 3);
  assertEquals(r.notes.byWorkspace, { CEE: 2, OTHER: 1 });
  assertEquals(r.notes.bySource, { "💬 чат": 1, "🔗 ссылки": 1, "🎤 голосовые": 1 });
});

Deno.test("aggregateActivity: неизвестный source заметки → 📦 прочее; null group_id → Без воркспейса", () => {
  const r = aggregateActivity([
    { entry_type: "note", source: "weird", group_id: null },
  ]);
  assertEquals(r.notes.bySource, { "📦 прочее": 1 });
  assertEquals(r.notes.byWorkspace, { "Без воркспейса": 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts`
Expected: FAIL — `aggregateActivity` не экспортирован.

- [ ] **Step 3: Write minimal implementation**

```ts
// добавить в daily-report.ts
export interface EntryRow {
  entry_type: string;
  source: string;
  group_id: string | null;
}

export interface SectionCounts {
  total: number;
  byWorkspace: Record<string, number>;
  bySource: Record<string, number>;
}

export interface ReportData {
  meetings: SectionCounts;
  notes: SectionCounts;
}

const MEETING_SOURCE_LABEL: Record<string, string> = {
  "desktop-agent": "рекордер",
  granola: "granola",
  read_ai: "read.ai",
};

const NOTE_SOURCE_LABEL: Record<string, string> = {
  telegram: "💬 чат",
  note: "💬 чат",
  link: "🔗 ссылки",
  voice: "🎤 голосовые",
  document: "📄 файлы",
  file: "📄 файлы",
};

function wsLabel(groupId: string | null): string {
  return groupId ? groupId.toUpperCase() : "Без воркспейса";
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

function emptySection(): SectionCounts {
  return { total: 0, byWorkspace: {}, bySource: {} };
}

export function aggregateActivity(rows: EntryRow[]): ReportData {
  const meetings = emptySection();
  const notes = emptySection();
  for (const r of rows) {
    if (r.entry_type === "meeting") {
      meetings.total++;
      bump(meetings.byWorkspace, wsLabel(r.group_id));
      bump(meetings.bySource, MEETING_SOURCE_LABEL[r.source] ?? r.source);
    } else if (r.entry_type === "note") {
      notes.total++;
      bump(notes.byWorkspace, wsLabel(r.group_id));
      bump(notes.bySource, NOTE_SOURCE_LABEL[r.source] ?? "📦 прочее");
    }
  }
  return { meetings, notes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/daily-report.ts supabase/functions/swarm-bot/handlers/daily-report.test.ts
git commit -m "feat(report): агрегация активности по воркспейсам и источникам"
```

---

### Task 3: Форматирование `formatReport` (чистая функция)

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/daily-report.ts`
- Test: `supabase/functions/swarm-bot/handlers/daily-report.test.ts`

**Interfaces:**
- Consumes: `ReportData` (Task 2), `aggregateActivity` (Task 2).
- Produces: `function formatReport(data: ReportData, dateLabel: string): string` (HTML-строка для Telegram).

- [ ] **Step 1: Write the failing test**

```ts
// добавить в daily-report.test.ts
import { formatReport } from "./daily-report.ts";

Deno.test("formatReport: штатный день — обе секции с разбивкой", () => {
  const data = aggregateActivity([
    { entry_type: "meeting", source: "desktop-agent", group_id: "cee" },
    { entry_type: "note", source: "telegram", group_id: "cee" },
    { entry_type: "note", source: "link", group_id: "other" },
  ]);
  const s = formatReport(data, "18.07");
  assertEquals(s.includes("Встречи: 1"), true);
  assertEquals(s.includes("Новые данные: 2"), true);
  assertEquals(s.includes("CEE 1"), true);
  assertEquals(s.includes("🔗 ссылки 1"), true);
});

Deno.test("formatReport: секция с нулём — без подстрок", () => {
  const data = aggregateActivity([
    { entry_type: "note", source: "telegram", group_id: "cee" },
  ]);
  const s = formatReport(data, "18.07");
  assertEquals(s.includes("Встречи: 0"), true); // секция показана
  // после «Встречи: 0» сразу идёт секция «Новые данные» — подстрок у нуля нет
  assertEquals(/Встречи: 0<\/b>\n\n/.test(s), true);
});

Deno.test("formatReport: тихий день — плашка, без секций", () => {
  const s = formatReport(aggregateActivity([]), "18.07");
  assertEquals(s.includes("тихий день"), true);
  assertEquals(s.includes("Встречи:"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts`
Expected: FAIL — `formatReport` не экспортирован.

- [ ] **Step 3: Write minimal implementation**

```ts
// добавить в daily-report.ts
function subLine(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

function renderSection(emoji: string, title: string, c: SectionCounts): string {
  let out = `${emoji} <b>${title}: ${c.total}</b>`;
  if (c.total > 0) {
    out += `\n   ${subLine(c.byWorkspace)}`;
    out += `\n   ${subLine(c.bySource)}`;
  }
  return out;
}

export function formatReport(data: ReportData, dateLabel: string): string {
  const header = `📊 <b>Свод за ${dateLabel}</b> (вчера)`;
  if (data.meetings.total === 0 && data.notes.total === 0) {
    return `${header}\n\nЗа вчера ничего не добавили — тихий день.`;
  }
  return [
    header,
    renderSection("🎙", "Встречи", data.meetings),
    renderSection("📝", "Новые данные", data.notes),
  ].join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/daily-report.ts supabase/functions/swarm-bot/handlers/daily-report.test.ts
git commit -m "feat(report): форматирование сводки (штатный/тихий день)"
```

---

### Task 4: I/O `sendDailyReport` + оба входа (cron + `/report`)

**Files:**
- Modify: `supabase/functions/swarm-bot/handlers/daily-report.ts` (добавить `sendDailyReport`, импорты)
- Modify: `supabase/functions/swarm-bot/index.ts` (импорт; guard-список крона; диспатч крона; команда `/report`)

**Interfaces:**
- Consumes: `yesterdayWindow`, `aggregateActivity`, `formatReport`, `EntryRow` (Tasks 1–3); `supabase`, `ADMIN_USER_ID`, `isAdminUser` из `lib/supabase.ts`; `sendMessage` из `lib/telegram.ts`; `bgRun` из `index.ts`.
- Produces: `async function sendDailyReport(): Promise<void>`.

- [ ] **Step 1: Добавить `sendDailyReport` и импорты в daily-report.ts**

Вверху файла (перед `export const REPORT_TZ`):

```ts
import { ADMIN_USER_ID, supabase } from "../lib/supabase.ts";
import { sendMessage } from "../lib/telegram.ts";
```

В конец файла:

```ts
export async function sendDailyReport(): Promise<void> {
  const { sinceISO, untilISO, dateLabel } = yesterdayWindow();
  const { data, error } = await supabase
    .from("entries")
    .select("entry_type, source, group_id")
    .gte("created_at", sinceISO)
    .lt("created_at", untilISO)
    .neq("source", "digest")
    .in("entry_type", ["meeting", "note"]);
  if (error) {
    await sendMessage(ADMIN_USER_ID, `⚠️ Свод за ${dateLabel}: ошибка запроса — ${error.message}`);
    return;
  }
  const report = formatReport(aggregateActivity((data ?? []) as EntryRow[]), dateLabel);
  await sendMessage(ADMIN_USER_ID, report);
}
```

- [ ] **Step 2: Проверить типы**

Run: `deno check supabase/functions/swarm-bot/handlers/daily-report.ts`
Expected: без ошибок.

- [ ] **Step 3: Подключить cron-триггер в index.ts**

Импорт (рядом с `import { sendAllDigests, generatePersonalDigest } from "./handlers/digest.ts";`):

```ts
import { sendDailyReport } from "./handlers/daily-report.ts";
```

В guard-список крон-триггеров (строка ~217) добавить флаг `daily_report_cron`. Было:

```ts
  if (body.setup_commands === true || body.digest_cron === true || body.readai_token_refresh === true || body.granola_poll === true || body.meetings_watchdog === true) {
```

Стало:

```ts
  if (body.setup_commands === true || body.digest_cron === true || body.daily_report_cron === true || body.readai_token_refresh === true || body.granola_poll === true || body.meetings_watchdog === true) {
```

Диспатч крона — сразу после блока `if (body.digest_cron === true) { ... }`:

```ts
  if (body.daily_report_cron === true) {
    await sendDailyReport();
    return new Response("OK", { status: 200 });
  }
```

- [ ] **Step 4: Добавить админскую команду `/report` в index.ts**

Убедиться, что `isAdminUser` импортирован из `lib/supabase.ts`. Текущий импорт:

```ts
import { supabase, ADMIN_USER_ID } from "./lib/supabase.ts";
```

Заменить на:

```ts
import { supabase, ADMIN_USER_ID, isAdminUser } from "./lib/supabase.ts";
```

В цепочку `else if (command === ...)` рядом с `/digest` добавить:

```ts
    } else if (command === "/report") {
      if (!(await isAdminUser(userId))) {
        await sendMessage(chatId, "Команда доступна только администратору.");
      } else {
        bgRun(sendDailyReport(), chatId);
      }
```

> Примечание: `sendDailyReport()` шлёт владельцу (`ADMIN_USER_ID`). Владелец запускает `/report` из своего чата → сводка приходит ему же. Для MVP это ожидаемое поведение.

- [ ] **Step 5: Проверить типы обоих файлов**

Run: `deno check supabase/functions/swarm-bot/index.ts`
Expected: без ошибок. (Проверит и `daily-report.ts` по импорту.)

- [ ] **Step 6: Прогнать тесты хендлера (не сломались)**

Run: `deno test supabase/functions/swarm-bot/handlers/daily-report.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/swarm-bot/handlers/daily-report.ts supabase/functions/swarm-bot/index.ts
git commit -m "feat(report): sendDailyReport + cron daily_report_cron + команда /report"
```

---

### Task 5: Документация + pg_cron SQL

**Files:**
- Modify: `docs/ARCHITECTURE.md` (таблица Edge Functions — строка cron; список команд бота)
- Modify: `docs/QUICK_REF.md` (крон-заметка в блоке деплоя)
- Modify: `docs/SETUP.md` (Шаг 12 — cron `daily-report`)
- Modify: `README.md` (таблица команд — `/report`)
- Modify: `docs/BACKLOG.md` (отметить сделанное + будущее расширение)

**Interfaces:** нет кода — только доки.

- [ ] **Step 1: ARCHITECTURE — строка cron в таблице Edge Functions**

В таблицу Edge Functions (после строки `swarm-bot` (`granola_poll`)) добавить:

```markdown
| `swarm-bot` (`daily_report_cron`) | Cron (раз в сутки, ~06:00 UTC) | Ежедневный отчёт активности админу: счёт `entries` за вчерашние сутки (Europe/Belgrade) по `entry_type` (meeting/note), разбивка воркспейс/источник → `sendMessage(ADMIN_USER_ID)`. Хендлер `handlers/daily-report.ts` |
```

- [ ] **Step 2: ARCHITECTURE — упомянуть команду `/report`**

Если есть раздел со списком команд бота — добавить `/report` (админская, счётчик активности за вчера, вызывает тот же `sendDailyReport`). Если отдельного списка нет — пропустить (канон команд — в README, шаг 4).

- [ ] **Step 3: QUICK_REF — крон-заметка**

В блок «Деплой» (рядом с упоминаниями других крон-триггеров) добавить строку:

```markdown
# daily_report_cron — ежедневный отчёт активности админу (pg_cron '0 6 * * *' → swarm-bot {"daily_report_cron":true})
```

- [ ] **Step 4: SETUP — Шаг 12, cron daily-report**

В Шаг 12 (после блока `granola-poll` cron) добавить:

````markdown
```sql
-- Ежедневный отчёт активности админу — вчерашние сутки, ~06:00 UTC (≈07–08:00 Europe/Belgrade)
select cron.schedule(
  'daily-report',
  '0 6 * * *',
  $$
    select net.http_post(
      url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/swarm-bot',
      headers := '{"Content-Type":"application/json","X-Cron-Secret":"<CRON_SECRET>"}',
      body := '{"daily_report_cron":true}'
    );
  $$
);
```
````

- [ ] **Step 5: README — команда `/report`**

В таблицу «Команды бота», строку «Администратор», добавить `/report` — ежедневный отчёт активности за вчера (счётчики встреч/данных).

- [ ] **Step 6: BACKLOG — отметить сделанное + будущее расширение**

Добавить запись:

```markdown
## ✅ [СДЕЛАНО 2026-07-19] Ежедневный отчёт активности админу

Cron `daily_report_cron` + команда `/report` (`swarm-bot/handlers/daily-report.ts`): счёт `entries` за вчерашние сутки (Europe/Belgrade) по `entry_type` (meeting/note), разбивка cee/other + источники, пуш владельцу. Спека/план: `docs/superpowers/specs/2026-07-19-daily-activity-report-design.md`, `docs/superpowers/plans/2026-07-19-daily-activity-report.md`.

**Будущее расширение (не в MVP):** считать и захваченные рекордером встречи, ещё не опубликованные (таблица `meetings`, `status='awaiting_review'`) — сейчас в счёт входят только попавшие в `entries`.
```

- [ ] **Step 7: Commit**

```bash
git add docs/ARCHITECTURE.md docs/QUICK_REF.md docs/SETUP.md README.md docs/BACKLOG.md
git commit -m "docs(report): ежедневный отчёт активности — Edge Functions/команды/cron/SETUP"
```

---

### Task 6: Деплой прод + смоук-тест + регистрация cron

**Files:** нет правок кода — деплой и проверка.

**Interfaces:** —

- [ ] **Step 1: Деплой функции**

Run: `supabase functions deploy swarm-bot --no-verify-jwt`
Expected: деплой успешен.

- [ ] **Step 2: Смоук — команда `/report` в Telegram**

Владелец отправляет боту `/report`. Expected: приходит сообщение «📊 Свод за DD.MM (вчера) …» (или «тихий день», если вчера пусто).

- [ ] **Step 3: Сверить цифры с БД**

Выполнить на прод (`vbqglndbxkpmreccpqmr`) SQL с границами из смоука (`sinceISO`/`untilISO` за те же вчерашние сутки Europe/Belgrade):

```sql
select entry_type, count(*)
from entries
where created_at >= '<sinceISO>'
  and created_at <  '<untilISO>'
  and source <> 'digest'
  and entry_type in ('meeting','note')
group by entry_type;
```

Expected: суммы совпадают с цифрами в сообщении бота.

- [ ] **Step 4: Зарегистрировать pg_cron на проде**

Сначала взять точный заголовок с `X-Cron-Secret` из уже существующего задания (чтобы не хардкодить секрет вслепую):

```sql
select jobname, command from cron.job where jobname in ('weekly-digest','granola-poll');
```

Затем создать задание `daily-report` тем же секретом:

```sql
select cron.schedule(
  'daily-report',
  '0 6 * * *',
  $$ select net.http_post(
       url := 'https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-bot',
       headers := '{"Content-Type":"application/json","X-Cron-Secret":"<из существующего задания>"}',
       body := '{"daily_report_cron":true}'
     ); $$
);
```

- [ ] **Step 5: Проверить, что задание создано**

```sql
select jobname, schedule, active from cron.job where jobname = 'daily-report';
```

Expected: одна строка, `active = true`, `schedule = '0 6 * * *'`.

---

## Self-Review

**1. Spec coverage:**
- Получатель = ADMIN_USER_ID → Task 4 (`sendDailyReport` → `sendMessage(ADMIN_USER_ID)`). ✓
- Детализация 2 цифры + разбивка → Task 2 (агрегация) + Task 3 (формат). ✓
- Воркспейсы cee/other → Task 2 (`byWorkspace`), Task 3 (подстрока). ✓
- Период вчера в Europe/Belgrade → Task 1 (`yesterdayWindow`). ✓
- Что считаем (entries, entry_type meeting/note, исключить digest) → Task 4 (запрос). ✓
- Маппинг источников → Task 2 (`MEETING_SOURCE_LABEL`/`NOTE_SOURCE_LABEL`). ✓
- Тихий день → Task 3. ✓
- Cron + `/report` → Task 4. ✓
- pg_cron + доки → Task 5, деплой/смоук/cron-регистрация → Task 6. ✓
- Граница «не считаем черновики `meetings`» → зафиксирована в BACKLOG (Task 5, Step 6). ✓

**2. Placeholder scan:** `<YOUR_PROJECT_REF>`, `<CRON_SECRET>`, `<sinceISO>`, `<из существующего задания>` — намеренные подстановки в SQL-шаблонах/командах смоука (соответствуют конвенции SETUP и берутся из секретов рантайма), не «TODO». Кода-заглушек нет.

**3. Type consistency:** `EntryRow`/`SectionCounts`/`ReportData`/`DayWindow` определены в Task 1–2 и используются одинаково в Task 3–4. Функции: `yesterdayWindow`, `aggregateActivity`, `formatReport`, `sendDailyReport` — имена согласованы между задачами и интерфейс-блоками.
