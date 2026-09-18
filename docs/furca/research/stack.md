# Ресерч: стек — доски инициатив в «Спринтах»

Направление: стек (документация, версии, известные несовместимости).
Дата: 2026-09-18.

Правила: ссылка на каждое утверждение; честная пометка источника (прочитано целиком / просмотрено по заголовкам / проверено на локальной базе). Прод не трогается — только локальный контур `127.0.0.1:54322`.

## 3. Атомарность `supabase.rpc()`: одна транзакция, `FOR UPDATE`, форма ошибки в supabase-js v2

**Каждый HTTP-запрос PostgREST (включая `/rpc/<fn>`) выполняется целиком в одной транзакции** — начинается `START TRANSACTION` (с уровнем изоляции по умолчанию `READ COMMITTED`), выполняется запрос/вызов функции, в конце `COMMIT` или `ROLLBACK`.
- Источник (просмотрено по разделу «Transactions», PostgREST stable docs): «Every request runs in a transaction... uses the PostgreSQL default isolation level: READ COMMITTED»; «Any database failure (like a failed constraint) will result in a rollback». https://postgrest.org/en/stable/references/transactions.html
- Волатильность функции определяет режим транзакции: `VOLATILE`-функции в POST-запросах выполняются в `READ WRITE` — то есть могут блокировать строки и писать. Источник (просмотрено по разделу): та же страница, раздел про volatility → access mode.
- Web-поиск подтверждает то же для вызова функций конкретно (документация PostgREST v12–14, «Functions as RPC»): вызов функции через `/rpc/` оборачивается в ту же транзакцию запроса — отдельного механизма нет. https://docs.postgrest.org/en/stable/references/api/functions.html (просмотрено по заголовкам/через поисковую выжимку, не читано целиком дословно).

**`SELECT ... FOR UPDATE` внутри функции**: блокировка строки держится до конца транзакции, то есть до конца всего HTTP-запроса (commit/rollback запроса PostgREST), а не до конца отдельного оператора внутри функции — значит вся плпгсгл-функция `accept_sprint_cycle` (лок строки цикла → снимок → создание черновика → перенос) атомарна и конкурентный второй вызов той же функции для того же цикла будет ждать на `FOR UPDATE`, а не увидит частично готовое состояние.
- Источник (прочитано целиком, «13.3.2. Row-Level Locks» / «Explicit Locking», PostgreSQL 17): «Once acquired, a lock is normally held until the end of the transaction» и «This prevents them from being locked, modified, or deleted by other transactions until the current transaction ends». https://www.postgresql.org/docs/17/explicit-locking.html

**Поведение при ошибке внутри функции**: `RAISE EXCEPTION` (или любой отказ ограничения, например наш `23505` из п.2) откатывает всю транзакцию запроса целиком — частичных изменений (наполовину созданного черновика) не остаётся.
- Источник (прочитано целиком, «Errors and HTTP Status Codes», PostgREST stable docs): ошибки PostgreSQL преобразуются в JSON `{code, message, details, hint}`; `23505` → HTTP 409, `P0001` (код по умолчанию для голого `RAISE EXCEPTION`) → HTTP 400, `42501` (`insufficient_privilege`) → 403 (аутентифицирован) или 401 (нет). Кастомный SQLSTATE (`RAISE sqlstate 'PT402'`) даёт кастомный HTTP-статус. https://postgrest.org/en/stable/references/errors.html

**Форма ошибки в supabase-js v2**: `supabase.rpc('accept_sprint_cycle', {...})` возвращает `{ data, error }`; при отказе `data === null`, `error` — экземпляр/объект `PostgrestError extends Error` с полями `message`, `details`, `hint`, `code` (строка, тот же SQLSTATE, что вернул Postgres/PostgREST, например `'23505'` или `'P0001'`).
- Источник (прочитано целиком, `postgrest-js`, файл `PostgrestError.ts`, ветка `master`, GitHub): `export default class PostgrestError extends Error` с полями `message: string`, `details: string`, `hint: string`, `code: string`, устанавливаемыми из объекта контекста в конструкторе. https://github.com/supabase/postgrest-js/blob/master/src/PostgrestError.ts

**Практический вывод**: код edge-функции должен различать ветки по `error.code`: `'23505'` (гонка двух `accept`/создание цикла — можно повторить/показать «уже принято параллельно»), `'P0001'` (бизнес-исключение из тела функции, например «нет открытого цикла для вкладки» — тут же текст ошибки из `RAISE EXCEPTION '...'` попадёт в `error.message`), `'42501'` (не хватает грантов — см. п.4, при верной настройке эта ветка вообще не должна происходить в проде).

---

## 4. Права на функцию: `EXECUTE` уходит в `PUBLIC` по умолчанию, `REVOKE ... FROM anon` — недостаточно

**По умолчанию Postgres выдаёт `EXECUTE` на новую функцию роли `PUBLIC`** (псевдо-роль = «буквально все роли, включая те, что появятся позже») — это единственная привилегия, применимая к функциям, и она выдаётся автоматически, без явного `GRANT`.
- Источник (прочитано целиком, «5.8. Privileges» / Table 5.2, PostgreSQL 17): «For other types of objects, the default privileges granted to PUBLIC are as follows: ... EXECUTE privilege for functions and procedures». https://www.postgresql.org/docs/17/ddl-priv.html
- Источник (прочитано целиком, `GRANT`, PostgreSQL 17): «PUBLIC can be thought of as an implicitly defined group that always includes all roles» и «Any particular role will have the sum of privileges granted directly to it, privileges granted to any role it is presently a member of, and privileges granted to PUBLIC». https://www.postgresql.org/docs/17/sql-grant.html

**Почему `REVOKE EXECUTE ON FUNCTION ... FROM anon` одной строкой не закрывает дыру**: привилегия у `anon` складывается из (а) прямого гранта роли и (б) гранта `PUBLIC`; `REVOKE ... FROM anon` снимает только (а). Если грант был выдан `PUBLIC` (а он выдаётся автоматически при создании функции), `anon` всё ещё исполняет функцию через (б), пока не сделан отдельный `REVOKE EXECUTE ... FROM PUBLIC`.

**Проверено эмпирически на локальной базе** (`research_tmp.hello()`):
```
has_function_privilege('anon', 'research_tmp.hello()', 'execute')  -- до REVOKE: t
-- REVOKE EXECUTE ... FROM anon;
has_function_privilege('anon', 'research_tmp.hello()', 'execute')  -- после REVOKE FROM anon: t  ← дыра не закрыта
-- REVOKE EXECUTE ... FROM PUBLIC;
has_function_privilege('anon', 'research_tmp.hello()', 'execute')  -- после REVOKE FROM PUBLIC: f  ← только теперь закрыто
```
Это тот же паттерн, что уже зафиксирован в проекте для `generate_mcp_token`/`revoke_mcp_token` (issue закрыт 2026-08-26, advisory GHSA-vxrp-599j-46hv, см. `no-issues-in-other-peoples-repos`-соседнюю память `security-definer-public-grant-trap`) — здесь то же самое подтверждено уже конкретно для новой функции `accept_sprint_cycle` по плану фичи. **Значит план в задании (`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` явным списком, включая `PUBLIC`) — правильный, минимальная версия без `PUBLIC` в списке была бы дырой.**

**`ALTER DEFAULT PRIVILEGES` — ловушка с `IN SCHEMA`**: если когда-нибудь потребуется сделать это правилом «для всех будущих функций автоматически», `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` **не сработает**, если PUBLIC-грант уже действует глобально (а он действует глобально всегда, это дефолт самого Postgres, не per-schema настройка).
- Источник (прочитано целиком, «Notes»/«Description», `ALTER DEFAULT PRIVILEGES`, PostgreSQL 17): «Default privileges that are specified per-schema are added to whatever the global default privileges are for the particular object type. This means you cannot revoke privileges per-schema if they are granted globally... Per-schema REVOKE is only useful to reverse the effects of a previous per-schema GRANT.» https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html — нужна версия БЕЗ `IN SCHEMA` (`ALTER DEFAULT PRIVILEGES FOR ROLE ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`), чтобы реально снять глобальный дефолт для функций, создаваемых конкретной ролью.
- Совпадает с рекомендацией Supabase (просмотрено по разделу, «Database Functions», supabase.com/docs/guides/database/functions): «revoke execute on all functions in schema public from public;» + `revoke execute on all functions in schema public from anon, authenticated;` для существующих функций и отдельно настройка default privileges для будущих — Supabase тоже явно бьёт и по `public`-роли, и по `anon`/`authenticated`, а не только по одной из них. https://supabase.com/docs/guides/database/functions
- Проверка факта: `has_function_privilege('anon', 'schema.func(args)', 'execute')` — сигнатура подтверждена в доках PostgreSQL 17 (`functions-info.html`), пример из доки: `SELECT has_function_privilege('joeuser', 'myfunc(int, text)', 'execute');`. https://www.postgresql.org/docs/17/functions-info.html

**`SECURITY INVOKER` под `service_role` — какие права реально нужны, отдельная находка (важно для миграции)**: PostgREST переключает роль подключения командой `SET LOCAL ROLE` на роль из JWT-claim (`service_role` для edge-функций Swarm) — то есть тело `SECURITY INVOKER`-функции исполняется буквально с привилегиями `service_role`, а не владельца функции.
- Источник (просмотрено по разделу, «Authentication», PostgREST stable docs): «When a request contains a valid JWT with a role claim PostgREST will switch to the database role with that name» через `SET LOCAL ROLE`. https://postgrest.org/en/stable/references/auth.html
- Значит `service_role` должна иметь не только `EXECUTE` на саму функцию (наш явный `GRANT ... TO service_role` из плана), но и обычные табличные права (`SELECT/INSERT/UPDATE/DELETE`) на `sprint_cycles`/`sprint_items`/`tasks` — `rolbypassrls` снимает только RLS-проверку, а не табличные GRANT-права.
  - Источник (просмотрено по разделу, «Row Level Security», Supabase docs): у `service_role` атрибут `bypassrls`, используется PostgREST именно для обхода RLS. https://supabase.com/docs/guides/database/postgres/row-level-security

**⚠️ Отдельная, неожиданная находка — важно проверить перед миграцией конкретно для `sprint_cycles` (новая таблица)**: Supabase меняет поведение автогрантов на новые таблицы схемы `public`. Раньше `select/insert/update/delete` выдавались автоматически ролям `anon`, `authenticated`, `service_role` на КАЖДУЮ новую таблицу `public`. Это меняется поэтапно:
- 2026-04-28 — опция «не выдавать автоматически» доступна при создании новых проектов;
- 2026-05-30 — новое поведение (без автогранта) становится дефолтом для НОВЫХ проектов;
- **2026-10-30 — применяется ко ВСЕМ существующим проектам** (Swarm Brain — существующий проект).
- Существующие уже созданные таблицы это не трогает («Existing tables are not affected in your project, they keep their current grants and stay reachable» — сказано дважды в тексте), но касается именно НОВЫХ таблиц, создаваемых ПОСЛЕ применения изменения к проекту.
- Источник (прочитано целиком, включая таблицу дат «Timeline» и «Communications», официальный changelog Supabase): «On October 30, 2026 the setting will be applied it to all existing projects» и «For new tables you want to expose via the Data API, make explicit grants part of your table-creation flow.» https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- **Практический вывод**: сегодня 2026-09-18, до общего применения (30.10.2026) — 6 недель. `sprint_cycles` — НОВАЯ таблица этой фичи. Независимо от того, успеет миграция выкатиться до или после 30.10 (и независимо от того, не включил ли владелец опцию раньше вручную) — миграция должна **явно** прописывать `GRANT ... ON TABLE sprint_cycles TO service_role;` (и на новые колонки/таблицы `sprint_items`, если там появляются новые связанные объекты), а не полагаться на автогрант. Для Swarm это ещё и совпадает с существующим принципом проекта (`CLAUDE.md`: «клиент НЕ может ходить в базу напрямую», весь доступ — через service_role в edge-функциях) — `anon`/`authenticated` этой таблице вообще не нужны, но `service_role` — нужен явно и надёжно, вне зависимости от таймлайна Supabase.

---

## 5. `tasks.links jsonb not null default '[]'` — не переписывает таблицу; CHECK-ограничение можно добавить без долгой блокировки

**`ADD COLUMN ... NOT NULL DEFAULT '[]'` на Postgres 17 НЕ требует переписи таблицы** — раз default является не-volatile константой (`'[]'::jsonb` таковой и является), Postgres сохраняет значение по умолчанию в метаданных колонки и логически «подставляет» его существующим строкам, не трогая физически ни одну строку на диске.
- Источник (прочитано целиком, «Notes», `ALTER TABLE`, PostgreSQL 17): «When a column is added with ADD COLUMN and a non-volatile DEFAULT is specified, the default is evaluated at the time of the statement and the result stored in the table's metadata. That value will be used for the column for all existing rows. If no DEFAULT is specified, NULL is used. In neither case is a rewrite of the table required.» И отдельно: «Adding a column with a volatile DEFAULT or changing the type of an existing column will require the entire table and its indexes to be rewritten.» https://www.postgresql.org/docs/17/sql-altertable.html
- Практический вывод: `NOT NULL DEFAULT '[]'` — безопасная быстрая метаданная-операция даже на большой `tasks`, поведение появилось с PostgreSQL 11 и в 17 не изменилось (сама доковая формулировка про «non-volatile DEFAULT» относится к любой актуальной версии, специфики именно 17 тут нет — это общий, давно стабильный механизм).

**CHECK-ограничение (`jsonb_typeof(links) = 'array'`, лимит длины через `jsonb_array_length`) — стоит добавлять в базу, и это можно сделать без долгой блокировки живой таблицы**, паттерном `NOT VALID` + отдельный `VALIDATE CONSTRAINT`:
- Источник (прочитано целиком, «Notes», `ALTER TABLE`, PostgreSQL 17): «if the NOT VALID option is used, this potentially-lengthy scan is skipped. The constraint will still be enforced against subsequent inserts or updates... until it is validated by using the VALIDATE CONSTRAINT option.» Блокировки: сам `ADD CONSTRAINT ... NOT VALID` — как и большинство форм `ADD table_constraint`, требует `ACCESS EXCLUSIVE` (единственное исключение в доке — `ADD FOREIGN KEY`, для него `SHARE ROW EXCLUSIVE`), но т.к. `NOT VALID` пропускает полное сканирование, сама эта блокировка держится доли секунды; затем `VALIDATE CONSTRAINT distfk` сканирует таблицу под гораздо более лёгкой `SHARE UPDATE EXCLUSIVE` (не блокирует обычные чтения/записи, блокирует только конкурентный DDL). https://www.postgresql.org/docs/17/sql-altertable.html
- Готовые функции для условия: `jsonb_typeof(jsonb) → text` (`'array'`/`'object'`/`'string'`/`'number'`/`'boolean'`/`'null'`) и `jsonb_array_length(jsonb) → integer` («Returns the number of elements in the top-level JSON array»). Источник (прочитано целиком, «9.16. JSON Functions and Operators», Table 9.49, PostgreSQL 17): https://www.postgresql.org/docs/17/functions-json.html
- Пример безопасной последовательности для миграции:
  ```sql
  ALTER TABLE tasks ADD COLUMN links jsonb NOT NULL DEFAULT '[]';  -- метаданные, без rewrite
  ALTER TABLE tasks ADD CONSTRAINT tasks_links_is_array
    CHECK (jsonb_typeof(links) = 'array') NOT VALID;               -- ACCESS EXCLUSIVE, но мгновенно
  ALTER TABLE tasks VALIDATE CONSTRAINT tasks_links_is_array;       -- SHARE UPDATE EXCLUSIVE, сканирует, не блокирует чтения/записи
  ```
  (Валидация в отдельной транзакции/миграции, не обязательно в той же — так соответствует правилу проекта «аддитивные миграции, прод не мучаем долгими локами».)

**«В базе или только в коде»**: доку/CLAUDE.md проекта не нашёл прямого ответа — это архитектурное решение, не факт из документации, поэтому не утверждаю за проект. Технический факт: ограничение в базе (в отличие от проверки только в коде edge-функции) защищает и от прямых миграций/скриптов, и от будущих новых мест записи в `tasks.links`, ценой одной дополнительной операции в миграции (которая, как показано выше, дешёвая и не блокирующая).

---

## 6. Base UI 1.5 (`@base-ui/react`) — актуальный API компонентов и открытые баги на React 19 / Next 16

**Имя пакета подтверждено**: именно `@base-ui/react` (не устаревший `@base-ui-components/react`, у которого на npm последний тег — старый `1.0.0-rc.0`). У `@base-ui/react` на npm `dist-tags.latest = 1.8.0` на момент ресёрча (18.09.2026); релиз `v1.5.0` — реальный, датирован 19.05.2026.
- Источник: npm registry API, `https://registry.npmjs.org/@base-ui/react` (прочитано целиком, JSON-ответ) и https://registry.npmjs.org/@base-ui-components/react`.
- Источник (просмотрено по заголовкам/анатомии): официальный список релизов https://base-ui.com/react/overview/releases и страница релиза https://base-ui.com/react/overview/releases/v1-5-0.

**⚠️ Важная ловушка версий**: в проекте зафиксировано `^1.5.0` — это диапазон `>=1.5.0 <2.0.0` по семверу npm, то есть свежая установка сегодня подтянет **1.8.0**, а не буквально 1.5.0. Открытые баги ниже репортились на 1.6.0/1.7.0 — то есть версии, которые реально попадут в `node_modules` при `^1.5.0`, а не «более новую, чем у нас» версию.

**Анатомия (актуальный API, подтверждено официальными примерами «Anatomy» с сайта, просмотрено по разделам, не читано целиком постранично):**
- Toggle Group — БЕЗ паттерна `Root`/`Item` (не как у Radix): плоско `<ToggleGroup>` + дочерние `<Toggle>`. Импорт: `import { ToggleGroup } from '@base-ui/react/toggle-group'`, `import { Toggle } from '@base-ui/react/toggle'` (Toggle — отдельный самостоятельный компонент, не саб-компонент ToggleGroup). Пропсы: `value`/`defaultValue`/`onValueChange` (значение — массив строк), `multiple` (по умолчанию `false`), `orientation`, `loopFocus`, `disabled`. https://base-ui.com/react/components/toggle-group
- Tabs — паттерн Root/List/Tab/Indicator/Panel: `Tabs.Root > Tabs.List > (Tabs.Tab, Tabs.Indicator)`, `Tabs.Root > Tabs.Panel`. https://base-ui.com/react/components/tabs
- Select — глубокая композиция: `Select.Root > (Select.Label, Select.Trigger > (Select.Value, Select.Icon), Select.Portal > Select.Backdrop, Select.Positioner > Select.Popup > (Select.ScrollUpArrow, Select.Arrow, Select.List > (Select.Item > (Select.ItemText, Select.ItemIndicator), Select.Separator, Select.Group > Select.GroupLabel), Select.ScrollDownArrow))`. https://base-ui.com/react/components/select
- Dialog: `Dialog.Root > (Dialog.Trigger, Dialog.Portal > Dialog.Backdrop, Dialog.Viewport > Dialog.Popup > (Dialog.Title, Dialog.Description, Dialog.Close))`. https://base-ui.com/react/components/dialog
- Popover: `Popover.Root > (Popover.Trigger, Popover.Portal > Popover.Backdrop, Popover.Positioner > Popover.Popup > (Popover.Arrow, Popover.Viewport > (Popover.Title, Popover.Description, Popover.Close)))`. https://base-ui.com/react/components/popover

**Изменения в v1.5.0, релевантные для Tabs/Select/Dialog/Popover** (просмотрено по changelog релиза): Tabs — «Fire `onValueChange()` for automatic tab selection» (#4704); Dialog и Popover — «Consider the controlled `open` prop for open state detection» (#4712) — то есть если планируется управляемый (controlled) `open`, в 1.5.0 это поведение было целенаправленно исправлено (учитывать именно controlled-проп, а не только внутреннее состояние); Popover — дополнительно исправления RTL и сохранения активного триггера. Единственный breaking change в этом релизе — переименование в OTP Field (`sanitizeValue → normalizeValue`), компонентов из нашего списка не касается. https://base-ui.com/react/overview/releases/v1-5-0

**Известные ОТКРЫТЫЕ баги (репозиторий `mui/base-ui` на GitHub, проверено `gh issue view`, 18.09.2026), затрагивающие версии, которые реально подтянутся под `^1.5.0`:**
- **Select** — issue #5358 «Permanent main-thread freeze (infinite render loop) on open/close under CPU load», репортилось на **1.6.0**, статус **OPEN**. По расследованию мейнтейнеров (комментарии в issue) реальный воспроизводимый эффект — не бесконечный рендер-луп, а «залипание» модального Select в открытом состоянии при очень быстром цикле открыть→`Escape`→открыть под искусственной CPU-нагрузкой (throttling); «настоящий» hard freeze не воспроизведён устойчиво на prod-сборке. Практический риск для фичи низкий (нужен агрессивный синтетический сценарий), но баг числится открытым на версии, которая будет установлена. https://github.com/mui/base-ui/issues/5358
- **Popover** — issue #5715 «Tabbing out of a non-modal popup with no focusable content and no other tabbable page element throws `RangeError: Maximum call stack size exceeded`», репортилось на **1.7.0**, статус **OPEN**, воспроизводится детерминированно (циклическая рекурсия двух фокус-гардов). Триггер узкий: non-modal Popover (`modal={false}`), внутри popup вообще нет фокусируемых элементов, и на странице нет других табаемых элементов кроме самого триггера — то есть для дашборда со спринтами (где на странице всегда есть другие интерактивные элементы) риск невысокий, но если где-то в UI планируется пустой/чисто информационный non-modal Popover — стоит держать в уме. https://github.com/mui/base-ui/issues/5715
- Проверено, что более ранний краш **React 19 + Next 16** («`getChildRef` function... causing unexpected crashes», issue #3144, ловился на build с `cacheComponents` в Next.js 16) — **ЗАКРЫТ** 2025-11-17 (`stateReason: COMPLETED`), репортился на версии `beta-4` (задолго до релиза 1.0/1.5), фикс попал в ближайший npm-релиз Base UI — то есть для актуальной `^1.5.0` эта конкретная несовместимость уже неактуальна. https://github.com/mui/base-ui/issues/3144

---

## 7. Даты без времени в JS: ловушка `new Date('YYYY-MM-DD')` и способ посчитать «+13 дней»/«сегодня» в Europe/Belgrade

**Ловушка подтверждена дословно по MDN**: строка вида `"2026-09-18"` (только дата, без времени) при разборе конструктором/`Date.parse` трактуется как **UTC-полночь**, а строка с временем, но БЕЗ указания зоны (`"2026-09-18T00:00:00"`) — как **локальное время системы**. Это разное поведение для двух похожих форматов — и есть источник классического сдвига на день.
- Источник (прочитано целиком, раздел «Examples», `Date.parse()`, MDN): «The first will imply UTC time because it's date-only, and the others explicitly specify the UTC timezone» (пример `Date.parse("2019-01-01")` → UTC) и «does not specify a time zone will be set to ... in the local timezone of the system, because it has both date and time» (пример `Date.parse("2019-01-01T00:00:00")` → локальная зона). https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse
- **Практическое следствие для Belgrade (UTC+1/+2)**: `new Date('2026-09-18')` даёт `2026-09-18T00:00:00Z`, что при локальном рендере в Europe/Belgrade (UTC+2 летом) покажет **18 сентября, 02:00** — то есть само число дня не съезжает в данном конкретном примере, НО если код когда-либо вызовет `.getDate()`/`.getDay()`/локальное форматирование в часовом поясе С ОТРИЦАТЕЛЬНЫМ смещением от UTC (не Belgrade, но опасно для любого кода, который может исполниться в браузере пользователя из другого пояса, или если разработчик по ошибке использует `.getUTCDate()` вперемешку с `.getDate()`) — день может съехать на -1. Главный практический риск для Swarm — не сам Belgrade конкретно, а **смешение UTC-парсинга даты и локального форматирования** где угодно в цепочке (сервер/edge функция — Deno, по умолчанию системная зона UTC; браузер клиента — может быть ЛЮБОЙ зоной, не обязательно Belgrade).

**⚠️ Существенное обновление относительно возможно устаревших представлений о Temporal**: на 2026-09-18 **Temporal — уже часть спецификации** (TC39 Stage 4, финализирован в 2026 году) и штатно доступен нативно в современных средах:
- Chrome 144+ (с января 2026), Firefox 139+ (с мая 2025), Node.js 26 (Temporal включён по умолчанию, без флага), **Deno 2.7+ (стабилизирован без флага `--unstable-temporal`)**.
- Источник (просмотрено по заголовкам, блог Deno): «The Temporal API was stabilized in Deno 2.7 and is available as a global without any flags». https://deno.com/blog/v2.7
- **НО: Safari по-прежнему не поддерживает Temporal в стабильном релизе** (только Safari Technology Preview за флагом) — для браузерного веб-кода Swarm (реальные пользователи, не только Chrome) это значит: либо полифилл (`temporal-polyfill` или `@js-temporal/polyfill`), либо не полагаться на Temporal в клиентском коде без проверки поддержки.
- **Отдельно стоит проверить перед использованием на edge-функциях**: Supabase Edge Functions работают на собственном Deno-совместимом Edge Runtime, а не на ванильном Deno CLI — версия V8/Deno внутри Supabase Edge Runtime **не проверялась в рамках этого ресёрча** (не нашёл первоисточника с версией на момент проверки) и может отставать от Deno 2.7. Это отдельный вопрос, который стоит явно проверить (`deno --version`-эквивалент внутри контейнера рантайма/`EdgeRuntime.version()` в самой функции), прежде чем полагаться на нативный `Temporal` в проде edge-функций.

**Рекомендация для «+13 дней» и «сегодня» в Europe/Belgrade**:
1. **Если Temporal доступен (гарантированно — на сервере/Deno; в браузере — только с полифиллом или после проверки фичи)** — использовать `Temporal.PlainDate`, он создан именно для «календарная дата без времени и без зоны», что по смыслу 1-в-1 совпадает с колонкой `date` в Postgres:
   ```js
   const d = Temporal.PlainDate.from('2026-09-18'); // никакой зоны, никакого UTC-сдвига
   const plus13 = d.add({ days: 13 });              // 2026-10-01, арифметика без Date вообще
   const todayBelgrade = Temporal.Now.plainDateISO('Europe/Belgrade'); // "сегодня" именно по месту команды
   ```
   Источник (прочитано целиком, примеры кода, MDN): `Temporal.PlainDate` — «stores a date without time zone or time», `.from()`, `.add({days: N})`. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDate — `Temporal.Now.plainDateISO(timeZone)`: «Returns the current date in the specified time zone as a Temporal.PlainDate object». https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Now/plainDateISO (там же в самой доке MDN помечено «Limited availability, not Baseline» — то есть сам MDN ещё не признаёт это базовой web-фичей, несмотря на Stage 4 в TC39).
2. **Без Temporal (безопасный вариант без зависимостей, работает сегодня везде, включая Safari)** — не пускать `Date`-объекты в арифметику по дням вообще; работать со строкой `YYYY-MM-DD` как с тремя числами (`year, month, day`) и считать вручную (`Date.UTC(y, m-1, d+13)` → снова взять `getUTCFullYear/getUTCMonth/getUTCDate`), либо получать «сегодня в Europe/Belgrade» через `Intl.DateTimeFormat` с `timeZone: 'Europe/Belgrade'` и `formatToParts()` (не полагаться на строковый вывод конкретной локали типа `en-CA`, т.к. порядок частей в готовой строке — это соглашение конкретной локали, а не документированный контракт; `formatToParts()` документирован и даёт структурированные `{type: 'year'|'month'|'day', value}` вне зависимости от локали):
   ```js
   const parts = new Intl.DateTimeFormat('en-US', {
     timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit'
   }).formatToParts(new Date());
   const get = (t) => parts.find(p => p.type === t).value;
   const todayBelgrade = `${get('year')}-${get('month')}-${get('day')}`;
   ```
   Источник (просмотрено по разделу, конструктор `Intl.DateTimeFormat`, опции `timeZone`/`timeZoneName`, MDN): пример с `timeZone: "America/Los_Angeles"` подтверждает поддержку IANA-идентификаторов зон (тот же механизм для `'Europe/Belgrade'`). https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat — сам пример с `'en-CA'` и `formatToParts()` для получения `YYYY-MM-DD` — распространённый паттерн сообщества, а не готовый пример именно с этой языковой меткой из MDN; я не выдаю его за дословную цитату, `formatToParts()` — задокументированный API, конкретно эта комбинация опций — моя сборка из задокументированных частей.

---

## 1. Порядок срабатывания: BEFORE DELETE на `tasks` vs `ON DELETE SET NULL` на `sprint_items.task_id`

**Вывод: план безопасен.** Явный `BEFORE DELETE ROW` триггер на `tasks` гарантированно видит строки `sprint_items` ещё со старым (не обнулённым) `task_id`, потому что действие внешнего ключа (`SET NULL`) физически выполняется как отдельная `UPDATE`-команда над `sprint_items`, а она запускается уже ПОСЛЕ того, как BEFORE-триггеры родительской таблицы отработали.

- Источник (прочитано целиком, раздел 39.4 «Trigger Behavior», доки PostgreSQL 17): «Row-level BEFORE triggers fire immediately before a particular row is operated on, while row-level AFTER triggers fire at the end of the statement». https://www.postgresql.org/docs/17/trigger-definition.html
- Источник (прочитано целиком, `CREATE TRIGGER`, PostgreSQL 17, «Notes» / раздел про FK): «Row updates or deletions caused by foreign-key enforcement actions, such as ON UPDATE CASCADE or ON DELETE SET NULL, are treated as part of the SQL command that caused them» и «The PostgreSQL behavior is for BEFORE DELETE to always fire before the delete action, even a cascading one» (в отличие от стандарта SQL, где BEFORE DELETE на каскадном удалении срабатывает уже ПОСЛЕ каскада). https://www.postgresql.org/docs/17/sql-createtrigger.html
- **Проверено эмпирически на локальной базе** (`127.0.0.1:54322`, схема `research_tmp`, создана и удалена в рамках этой сессии — прод не трогался): создал `tasks` + `sprint_items.task_id references tasks(id) on delete set null` + `BEFORE DELETE ROW` триггер на `tasks`, который читает `sprint_items` по старому `task_id` и делает `UPDATE ... SET removed_title = OLD.title WHERE task_id = OLD.id`. После `DELETE FROM tasks` строка `sprint_items` получила корректный `removed_title`, а `task_id` стал `NULL` — то есть BEFORE-триггер отработал первым (записал снимок), и только потом сработало RI-действие `SET NULL`.
- Дополнительно проверено через `pg_trigger`: на `tasks` висят два **внутренних** (`tgisinternal=true`) триггера `RI_ConstraintTrigger_a_*` (реализация FK) плюс наш явный `trg_tasks_before_delete`. Это подтверждает документированный факт, что RI-действия реализованы именно как отдельные (внутренние) триггеры на таблице-источнике связи, а не как часть одного атомарного шага.

**Практический вывод для миграции**: писать `removed_title`/`removed_project_id`/`removed_at` можно прямо в `BEFORE DELETE` триггере на `tasks`, читая ещё не обнулённый `task_id` у `sprint_items` — дополнительный `AFTER`-триггер или отдельный проход не нужен. Условие «незамороженные» (видимо, `carried_from is null` или отдельный флаг) проверяется в теле триггера как обычный `WHERE`.

---

## 2. Частичный уникальный индекс `sprint_cycles(tab_id) WHERE status IN ('draft','active') AND tab_id IS NOT NULL`

**Семантика NULL**: строка с `tab_id IS NULL` вообще не попадает в индекс из-за условия `AND tab_id IS NOT NULL` в самом predicate — она физически не индексируется, поэтому сравнивать её не с чем и уникальность на NULL не давит. Отдельно от этого в PostgreSQL с версии 15 есть `NULLS NOT DISTINCT` для обычных уникальных индексов/констрейнтов (по умолчанию несколько NULL считаются РАЗНЫМИ и не конфликтуют) — но в нашем случае это неважно, т.к. `tab_id IS NOT NULL` уже исключает NULL из индекса раньше, чем сработала бы эта развилка.
- Источник (просмотрено по разделу): PostgreSQL 17, `CREATE INDEX` / «Partial Indexes» — индекс включает только строки, удовлетворяющие предикату `WHERE`. https://www.postgresql.org/docs/17/indexes-partial.html
- Источник (просмотрено по разделу, про `NULLS NOT DISTINCT`, добавлено в PG 15): https://www.postgresql.org/docs/17/sql-createtable.html (раздел `UNIQUE`/`NULLS [NOT] DISTINCT`).

**Проверено на локальной базе** (схема `research_tmp`):
- Две строки с `tab_id IS NULL, status='active'` — вставились без конфликта (ожидаемо, обе вне индекса).
- Первая строка `tab_id=X, status='draft'` — ОК. Вторая `tab_id=X, status='active'` (тот же tab_id, статус тоже «живой») — упала:
  ```
  ERROR:  23505: duplicate key value violates unique constraint "one_live_cycle_per_tab"
  DETAIL:  Key (tab_id)=(22222222-2222-2222-2222-222222222222) already exists.
  ```
  Код ошибки (`\set VERBOSITY verbose`) — ровно `23505` (`unique_violation`), имя нарушенного индекса/констрейнта присутствует в тексте (`one_live_cycle_per_tab`) и в `CONSTRAINT NAME:` при verbose-выводе.
- Третья строка `tab_id=X, status='completed'` — вставилась без конфликта, т.к. `'completed' NOT IN ('draft','active')` и строка вообще не подпадает под предикат индекса. Это подтверждает, что «протухший»/принятый цикл не блокирует переиспользование `tab_id` для нового.

**Гонка при двух одновременных INSERT с одинаковым `tab_id`**: PostgreSQL не использует блокировки предиката — при параллельной вставке в один и тот же слот уникального индекса вторая транзакция блокируется на insert в B-tree до коммита/отката первой, затем перепроверяет уникальность; если первая закоммитилась — вторая получает `23505` в момент своего `COMMIT`/`INSERT` (не раньше). Источник (просмотрено по разделу, «13.2.1. Read Committed Isolation Level», про поведение UPDATE/DELETE и неявные проверки уникальности при конкурентных операциях, тот же механизм действует для vставки в уникальный индекс): https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED — этот раздел не тестировался локально (нужны два параллельных соединения одновременно, не стал городить); механизм «insert blocks on conflicting index tuple, re-checks after blocker resolves» — задокументированное общее поведение уникальных индексов Postgres, а не специфика частичного индекса.

**Как отличить в supabase-js v2**: `PostgrestError` от `supabase.from(...).insert(...)` при упавшем частичном уникальном индексе будет иметь `error.code === '23505'`, `error.message` содержит `duplicate key value violates unique constraint "one_live_cycle_per_tab"`, `error.details` — `Key (tab_id)=(...) already exists.`. Ловить нужно именно по `error.code === '23505'`, а не по подстроке в `message` (текст локализуем/меняется). Форма ошибки подтверждена ниже в п.3 (тот же `PostgrestError`, что и для RPC).

---

## 8. Буфер обмена: `navigator.clipboard.writeText` — защищённое соединение и жест пользователя

*Находку добирал не агент направления, а диспетчер: агент оборвался на лимите сессии (сброс 18:00), успев
записать находки 1–7. Это отказ среды, а не негодный результат.*

- **Только защищённый контекст.** MDN, `Clipboard.writeText()` (прочитано целиком, разделы «Secure context»
  и «Security considerations»): «Writing to the clipboard can only be done in a secure context».
  https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
- **Жест пользователя обязателен в Safari и Firefox.** MDN, Clipboard API, «Security considerations»
  (прочитано целиком): спецификация ждёт разрешение `clipboard-write` и «the browser may also require
  transient user activation»; у Chromium — «either the `clipboard-write` permission or transient
  activation», а у Firefox и Safari — «Writing requires transient activation», причём сами разрешения
  `clipboard-read`/`clipboard-write` там «not supported (and not planned to be supported)».
  https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
- **Практический вывод для выгрузки итогов спринта.** Веб Swarm живёт на HTTPS (`swarm-brain.pages.dev`) —
  первое условие выполнено. Второе означает: markdown нужно класть в буфер **синхронно по нажатию кнопки**,
  внутри её обработчика. Если сначала сходить на сервер за данными и вызвать `writeText` уже после `await`,
  жест может быть потерян, и в Safari копирование молча не сработает. Значит текст отчёта собирается до
  вызова (данные уже на экране), а `writeText` вызывается первым делом в обработчике. Запасной путь при
  отказе — показать готовый markdown в поле, из которого его можно выделить руками; ошибку не глотать.

## Не закрыто в этом направлении

- **Пункт 9 задания (общие несовместимости версий)** — отдельно не обходился. Частично закрыт находкой 6
  (Base UI на React 19 / Next 16: старый краш `getChildRef` закрыт, два открытых бага узкого профиля).
- **Temporal в Supabase Edge Runtime** — не проверено (находка 7). Обходим вопрос стороной: на edge-функциях
  и в браузере считаем даты спринта строками `YYYY-MM-DD` и `Intl.DateTimeFormat` с `timeZone:
  'Europe/Belgrade'`, на Temporal не опираемся. Тогда версия рантайма и Safari перестают быть риском.
