<!-- constitution.md — the project's principles, which do not change during the build. Filled in by the owner together with the system during the spec and plan phase; approved at the gate before the build; the building agents consult it whenever priorities conflict. -->

# Project constitution

<!-- Project name, date of agreement, one line of status (for example: "approved by the owner 2026-07-29"). -->

**Доска инициатив в «Спринтах» Swarm Brain**, согласовано 18.09.2026. Статус: ждёт «ок» владельца на гейте.
Решения владельца — `docs/decisions/2026-09-18-doska-iniciativ.md`, поведение — `docs/superpowers/specs/2026-09-18-initiatives-board-design.md`.

## Quality principles

<!-- Three to five items: what matters most for THIS product when decisions conflict (for example: "reliability over shipping features faster", "simplicity over flexibility"). Not platitudes — concrete priorities. -->

1. **Продуктом пользуется команда каждый день — регресс дороже любой новой возможности.**
   При конфликте «доделать фичу» против «не сломать нынешний экран задач» выигрывает второе.
   Список того, что обязано работать как раньше, — в спеке §9, он же набор проверок перед раскаткой.
2. **Ни одна проверка стройки не идёт на прод-базе.** Живые пользователи: контур стройки — только
   локальный (`supabase start`), демо — изолированный воркспейс `demo`. Прод трогается лишь раскаткой,
   по явному «да» владельца, ночью.
3. **Схема меняется только аддитивно, с возможностью отката.** `ADD COLUMN`, индексы, триггер, функция;
   ни `DROP`, ни `RENAME`, ни смены типов. Старый веб обязан работать в промежутке между раскаткой
   функций и веба.
4. **Отчёт не должен врать даже ценой красивой цифры.** Снимок на приёмке неизменяем; отменённая задача
   не улучшает процент; молчание на сверке видно как молчание, а не как «по плану». Это прямые решения
   владельца (D010, D013), а не вкус.
5. **Повторяем артефакт, а не улучшаем его по дороге.** Отход от эталона допустим только там, где он
   записан решением владельца. Всё прочее «заодно» — вне стройки.

## Testing standard

<!-- Tests go where a mistake is expensive, and there they are written before the code. Name the core of THIS project by module paths — the places where an error is silent and costly (calculations, money, access rights, anything a partner or a customer reads as fact). That is where TDD applies (red → green → refactor). Everything else — screens, commands, endpoints, glue — is verified by running it: open it, click it, look. Owner's decision 17.09.2026: "we must not build tests for the sake of tests". Measured on two live builds: 30 defects in a week, zero of them caught by unit tests; of 61 defects that slipped past tests, access rights accounted for 23% and "a check that could not fail" for another 19%. -->

<!-- The coverage threshold is **relative** — no lower than at the previous acceptance — and it applies to the core named above, not to the product as a whole (an absolute figure such as 80% is a guide and does not by itself send a block back: by measurement it caught no defect at all, while it does push people to write assertion-free tests for the sake of the percentage). **The number of tests is not a measure of progress** and never opens a report: it says how much was run, not whether anything was checked. A test that has to be rewritten whenever behaviour changes is deleted, not repaired. -->

**Ядро проекта — поимённо** (`scripts/core-paths.txt`, там же его читает порча):

- `supabase/functions/_shared/tasks/sprint-carry.ts` — кто остаётся, кто уезжает вручную с причиной, кто
  автоматически, что остаётся упоминанием;
- `supabase/functions/_shared/tasks/sprint-stats.ts` — итоги спринта, включая новое правило по отменённым;
- `supabase/functions/_shared/tasks/links.ts` — разбор и проверка ссылок (адрес `javascript:` — отказ);
- `miniapp/src/lib/initiatives.ts`, `miniapp/src/lib/spaceAnalytics.ts` — прогресс инициатив, семь таблиц
  аналитики, выгрузка.

Здесь ошибка молчит: неверная цифра или потерянный хвост доедут до человека и сойдут за правду. Эти
модули пишутся тестами вперёд. Всё остальное — экраны, роуты, сид, кнопки — проверяется прогоном:
открыть, нажать, посмотреть.

Порог покрытия относительный, поставлен по факту — **78%** (`scripts/coverage-floor.txt`, замер
18.09.2026). Он запрещает падение, а не требует рывка. Число тестов отчётом о прогрессе не является и
первой строкой в отчёт владельцу не идёт.

<!-- The rule worth more than any threshold: **a check that does not fail on broken input is not a check**. Run every new check against a deliberately broken copy and confirm that it fails AND prints an intelligible reason. Confirm the breakage itself too: if the substitution did not apply, the "negative run" is falsely green — that has happened. Make this a command of the project (`make porcha` or its equivalent), not something someone has to remember to do: on a live run it was skipped for exactly that reason. -->

Порча — команда проекта: **`make porcha`** (`scripts/porcha`). Она переворачивает первое сравнение в
каждом модуле ядра, убеждается, что подстановка применилась, и требует, чтобы тесты упали. Отдельно
краснеет случай «нечего испортить» — модуль без сравнений проверкой не считается.

Прогнано 18.09.2026: на испорченном `sprint-stats.ts` тесты падают; гейт покрытия краснеет при пороге
выше факта и на пустом отчёте; проверка границ и мёртвого кода краснеет на нарочно испорченном импорте.

## Docs-as-DoD

<!-- Documentation is part of the Definition of Done, not a separate later step. Which documents must be updated together with the code in this project (the block spec, CHANGELOG, the inventory of endpoints and variables, and so on) and what is checked before a task counts as closed. -->

Тем же коммитом, что код этапа:
- `docs/ARCHITECTURE.md` и `docs/QUICK_REF.md` — флоу, callback, сессии, таблицы, эндпоинты, структура файлов
  (сверять с кодом, не по памяти; pre-commit напоминает, но не блокирует);
- `docs/superpowers/specs/2026-09-18-initiatives-board-design.md` — если поведение разошлось с тем, что
  построено, правится спека, а не память;
- описание блока в `docs/furca/blocks/<имя>.md` — контракт и статус;
- `docs/GUIDE.md` — пользовательский гайд, строка 47 уже неверна («сами спринты заводит админ»);
- `docs/decisions/` — любое решение владельца, сказанное в разговоре, записывается в тот же ход.

Changelog руками не ведём: он собирается из commit-сообщений (`scripts/changelog.sh`), поэтому сообщение
коммита — conventional и по сути.

## Security rules

<!-- Secrets never reach git: values live in .env (gitignored), documentation carries only variable names. A committed .env.example with names and safe values is mandatory: without it the project cannot be brought up again — not in another session, not by another person. Validate user input at the system's boundaries. Whatever else is specific to this product (authentication, payments, users' personal data) — list it explicitly. -->

- Секреты в git не попадают: `.env`, `.env.local`, `.env.*` в `.gitignore` (проверено 18.09.2026).
- **Репозиторий публичный намеренно.** Внутренние данные, имена коллег, выгрузки — только в
  `~/Documents/workbench/private/`, и ни строкой в git. Это уже нарушалось в этой стройке: файл
  артефакта попал в ветку и был убран пересборкой истории.
- `SERVICE_ROLE_KEY` используется везде, RLS без политик — **вся проверка доступа только в коде**.
  Новые роуты обязаны ходить в задачи через `entries-guard`-подобные проверки воркспейса и приватности;
  приватная задача не попадает ни в спринт, ни в отчёт, ни в журнал.
- Новая SQL-функция: `SECURITY INVOKER`, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`,
  `GRANT` только `service_role`; после наката — `get_advisors` и
  `has_function_privilege('anon', ...) = false`. Грант на `PUBLIC` наследуется в `anon` — на этом уже
  горели (GHSA-vxrp-599j-46hv).
- Ссылки у задачи — вход от пользователя: только `http`/`https`, не больше 20, без повторов; `javascript:`
  отбивается на сервере, и на это есть тест.

## Demo mode

<!-- A product with an interface must have a live demo that needs no registration: an isolated demo account or workspace, an idempotent seed of representative data, and a light entry point. The demo's language is always English, regardless of the product's language. The demo is isolated from real data and returns to a clean state by itself. -->

Демо уже есть: изолированный воркспейс `demo` (барьер `isDemo`, `DEMO_USER_ID`), вход по секретной
ссылке без регистрации, сид — `supabase/demo-seed.sql`, идемпотентный.

Для доски инициатив сид дополняется пространством с направлениями, инициативами, живым спринтом,
отметками сверки и одним принятым спринтом — чтобы аналитика и журнал были не пустыми. Содержание
повторяет артефакт по структуре, **имена и названия выдуманные, язык английский**. Демо-данные с
настоящими никогда не смешиваются.
