<!-- managed by furca: do not change the row format below — fabrica and cursus parse this file -->
# Tasks

<!-- id: Tnnn. status: todo | in_progress | done | failed | cancelled | blocked:Qnnn. "depends on" — ids separated by commas, or "—". block: a block name from plan.md, or chores. issue: #N or "—". stage: 1 = MVP (бот пишет встречу, которую создаём сами, с именами говорящих) · 2 = на команду (свой аккаунт + автозапуск) · 3 = Контур.Толк · 4 = Zoom · 5 = переезд на корпоративную платформу контейнеров. Правило: задача не может зависеть от задачи более позднего этапа. -->

| id | block | depends on | status | task | issue | stage |
|---|---|---|---|---|---|---|
| T001 | chores | — | done | Вернуть доступ к прод-базе: выяснить, почему отказывают и MCP-коннектор, и CLI; добиться успешного запроса к проду | #323 | 1 |
| T002 | chores | — | done | Поставить `scripts/check`, `scripts/gate-coverage.sh`, `.githooks/pre-push`, карантин версий в `bot/.npmrc`; прогнать на испорченной копии и убедиться, что краснеет | #324 | 1 |
| T010 | identity | — | done | Миграция: таблица служебных агентов с токеном бота; накат только добавлением и обратим | #325 | 1 |
| T011 | identity | T010 | done | `kind` в `AgentIdentity`; `classifyToken` распознаёт токен бота; тесты на все виды токенов | #326 | 1 |
| T012 | identity | T011 | done | `resolveActingIdentity`: подмена личности один раз на входе, на выходе — человек | #327 | 1 |
| T013 | identity | T012 | done | `meeting-claim`, `meeting-ingest`, `meeting-heartbeat` переведены на `resolveActingIdentity` | #328 | 1 |
| T014 | identity | T013 | done | Блокирующие тесты: recorder не может `on_behalf_of`; бот не может указать чужой воркспейс; токен бота без `on_behalf_of` не даёт прав | #329 | 1 |
| T015 | identity | T014 | todo | Регресс: `bumblebee` прогнан после правок эндпоинтов и работает как раньше | #330 | 1 |
| T020 | conference-link | — | done | `description` добавлен четвёртым источником ссылки, тест на него зелёный | #331 | 1 |
| T021 | conference-link | — | done | `conferencePlatform` по хосту; тесты на три площадки, мусор и неизвестный хост | #332 | 1 |
| T022 | conference-link | T021 | done | Ссылки нет → в ответе `reason: "no_conference_link"`, а не молчаливый `null` | #333 | 1 |
| T030 | ingest-speakers | T012 | in_progress | `meeting-ingest` принимает поле `speakers`; мусор отвергается внятной ошибкой на границе | #334 | 1 |
| T031 | ingest-speakers | — | in_progress | Чистая функция `nameAt`: тесты на перекрытия, дыры, пустой таймлайн, несовпадение времён | #335 | 1 |
| T032 | ingest-speakers | T030,T031 | in_progress | Имена подставляются в `Segment.speaker`; мягкая деградация без таймлайна проверена тестом | #336 | 1 |
| T033 | ingest-speakers | T032 | in_progress | Легенда говорящих в промпте тезисов согласована: не обещает «я», которого в стенограмме нет | #337 | 1 |
| T040 | container | — | done | Dockerfile: playwright-образ + Xvfb + PulseAudio + ffmpeg; контейнер поднимается и гасится | #338 | 1 |
| T041 | container | T040 | done | PulseAudio null-sink: `XDG_RUNTIME_DIR`, `set-default-sink`, monitor-source проверяется при старте | #339 | 1 |
| T042 | container | T041 | done | Chromium стартует с `ignoreDefaultArgs: ['--mute-audio']`; звук реально попадает в sink | #340 | 1 |
| T043 | container | T042 | done | Смоук записи звука падает на тишине и внятно говорит почему; прогнан на испорченной копии, порча подтверждена | #341 | 1 |
| T044 | container | T042 | done | Нарезка ffmpeg по `segment_time` под лимит 25 МБ; каждая часть открывается самостоятельно | #342 | 1 |
| T045 | container | T040 | done | Два контейнера одновременно не слышат друг друга (проверено запуском двух) | #343 | 1 |
| T050 | meet-adapter | T042 | in_progress | `join`: вход по ссылке с вводом имени `scriba`; локаль запиннена `?hl=en` + `--lang=en-US` | #344 | 1 |
| T051 | meet-adapter | T050 | in_progress | `waitAdmitted` различает admitted / denied / timeout / captcha; каждый исход проверен вживую | #345 | 1 |
| T052 | meet-adapter | T050 | in_progress | `activeSpeaker` возвращает имя говорящего; селекторы по `aria-label`/`role`, не по классам | #346 | 1 |
| T053 | meet-adapter | T050 | in_progress | `isAlone` и `leave`: бот выходит через 2 минуты один в звонке и освобождает ресурсы | #347 | 1 |
| T060 | swarm-client | T013 | in_progress | Клиент пяти эндпоинтов; контрактный тест со стороны потребителя | #348 | 1 |
| T061 | swarm-client | T060 | in_progress | Очередь выгрузки: ретраи с задержкой, локальный бэкап неотправленного, переживает обрыв сети | #349 | 1 |
| T062 | swarm-client | T060 | in_progress | `claim` вернул `defer` → аудио не отправляется вообще (проверено тестом) | #350 | 1 |
| T063 | swarm-client | T030,T052 | in_progress | Таймлайн говорящих собирается из опросов `activeSpeaker` и уходит полем `speakers` | #351 | 1 |
| T070 | orchestrator | T045,T060 | todo | `startForMeeting` / `stop` через dockerode; ручной запуск по ссылке работает | #352 | 1 |
| T071 | orchestrator | T070 | todo | Heartbeat идёт; смерть контейнера посреди встречи видна существующему watchdog | #353 | 1 |
| T072 | orchestrator | T070 | todo | Брошенных контейнеров не остаётся после падения оркестратора (проверено падением) | #354 | 1 |
| T080 | notices | T012 | in_progress | Уведомление «стою у двери» владельцу встречи; повтор ровно один, затем выход | #355 | 1 |
| T081 | notices | T080 | in_progress | Тексты уведомлений заведены на английском и русском | #356 | 1 |
| T082 | notices | T022 | in_progress | Ни один сценарий отказа не завершается молча — проверено по списку из спеки | #357 | 1 |
| T016 | identity | T013 | done | `meeting-current` и `meeting-status` переведены на `resolveActingIdentity`: бот ходит во все пять эндпоинтов, а не в три | #370 | 1 |
| T017 | identity | T016 | todo | Сузить полномочия токена агента до участников встречи, а не всего воркспейса — по решению владельца | #371 | 1 |
| T003 | chores | T015,T033,T044 | todo | `ARCHITECTURE.md` и `QUICK_REF.md` обновлены по факту изменений сервера и появления бота | #358 | 1 |
| T004 | chores | T043,T051,T063,T071,T082 | todo | Живой прогон на реальной встрече по всему списку готовности MVP из спеки | #359 | 1 |
| T100 | orchestrator | T071 | todo | Автозапуск по календарю: бот приходит на встречу сам | #360 | 2 |
| T101 | chores | — | cancelled | Завести `scriba` Google-аккаунт и порядок добавления его в календарные приглашения — снято D015: календарь подключает человек, своего аккаунта у бота не будет | #361 | 2 |
| T102 | orchestrator | T100 | todo | Автозапуск по календарю не сработал — человек видит это и зовёт бота руками: сигнал о пропущенной встрече + ручной путь остаётся рабочим (D015) | #456 | 2 |
| T110 | chores | — | todo | Проверить Talk API `Recordings` Контур.Толк: покрывает ли он наши встречи без браузерного бота | #362 | 3 |
| T111 | meet-adapter | T110 | todo | Адаптер Контур.Толк по тому же интерфейсу площадки | #363 | 3 |
| T120 | meet-adapter | — | todo | Адаптер Zoom на нативном Meeting SDK for Linux | #364 | 4 |
| T121 | conference-link | T120 | todo | Ключ комнаты `zoom:<id>` заведён на сервере и в рекордере одновременно | #365 | 4 |
| T130 | chores | — | todo | Переезд на корпоративную платформу контейнеров — до того, как бот станет единственным источником записи | #366 | 5 |
