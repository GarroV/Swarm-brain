<!-- managed by furca: do not change the row format below — fabrica and cursus parse this file -->
# Tasks

<!-- id: Tnnn. status: todo | in_progress | done | failed | cancelled | blocked:Qnnn. "depends on" — ids separated by commas, or "—". block: a block name from plan.md, or chores. issue: #N or "—". stage: 1 = MVP (бот пишет встречу, которую создаём сами, с именами говорящих) · 2 = на команду (свой аккаунт + автозапуск) · 3 = Контур.Толк · 4 = Zoom · 5 = переезд на Dodo AI Platform. Правило: задача не может зависеть от задачи более позднего этапа. -->

| id | block | depends on | status | task | issue | stage |
|---|---|---|---|---|---|---|
| T001 | chores | — | todo | Вернуть доступ к прод-базе: выяснить, почему отказывают и MCP-коннектор, и CLI; добиться успешного запроса к проду | — | 1 |
| T002 | chores | — | todo | Поставить `scripts/check`, `scripts/gate-coverage.sh`, `.githooks/pre-push`, карантин версий в `bot/.npmrc`; прогнать на испорченной копии и убедиться, что краснеет | — | 1 |
| T010 | identity | — | todo | Миграция: таблица служебных агентов с токеном бота; накат только добавлением и обратим | — | 1 |
| T011 | identity | T010 | todo | `kind` в `AgentIdentity`; `classifyToken` распознаёт токен бота; тесты на все виды токенов | — | 1 |
| T012 | identity | T011 | todo | `resolveActingIdentity`: подмена личности один раз на входе, на выходе — человек | — | 1 |
| T013 | identity | T012 | todo | `meeting-claim`, `meeting-ingest`, `meeting-heartbeat` переведены на `resolveActingIdentity` | — | 1 |
| T014 | identity | T013 | todo | Блокирующие тесты: recorder не может `on_behalf_of`; бот не может указать чужой воркспейс; токен бота без `on_behalf_of` не даёт прав | — | 1 |
| T015 | identity | T014 | todo | Регресс: `bumblebee` прогнан после правок эндпоинтов и работает как раньше | — | 1 |
| T020 | conference-link | — | todo | `description` добавлен четвёртым источником ссылки, тест на него зелёный | — | 1 |
| T021 | conference-link | — | todo | `conferencePlatform` по хосту; тесты на три площадки, мусор и неизвестный хост | — | 1 |
| T022 | conference-link | T021 | todo | Ссылки нет → в ответе `reason: "no_conference_link"`, а не молчаливый `null` | — | 1 |
| T030 | ingest-speakers | T012 | todo | `meeting-ingest` принимает поле `speakers`; мусор отвергается внятной ошибкой на границе | — | 1 |
| T031 | ingest-speakers | — | todo | Чистая функция `nameAt`: тесты на перекрытия, дыры, пустой таймлайн, несовпадение времён | — | 1 |
| T032 | ingest-speakers | T030,T031 | todo | Имена подставляются в `Segment.speaker`; мягкая деградация без таймлайна проверена тестом | — | 1 |
| T033 | ingest-speakers | T032 | todo | Легенда говорящих в промпте тезисов согласована: не обещает «я», которого в стенограмме нет | — | 1 |
| T040 | container | — | todo | Dockerfile: playwright-образ + Xvfb + PulseAudio + ffmpeg; контейнер поднимается и гасится | — | 1 |
| T041 | container | T040 | todo | PulseAudio null-sink: `XDG_RUNTIME_DIR`, `set-default-sink`, monitor-source проверяется при старте | — | 1 |
| T042 | container | T041 | todo | Chromium стартует с `ignoreDefaultArgs: ['--mute-audio']`; звук реально попадает в sink | — | 1 |
| T043 | container | T042 | todo | Смоук записи звука падает на тишине и внятно говорит почему; прогнан на испорченной копии, порча подтверждена | — | 1 |
| T044 | container | T042 | todo | Нарезка ffmpeg по `segment_time` под лимит 25 МБ; каждая часть открывается самостоятельно | — | 1 |
| T045 | container | T040 | todo | Два контейнера одновременно не слышат друг друга (проверено запуском двух) | — | 1 |
| T050 | meet-adapter | T042 | todo | `join`: вход по ссылке с вводом имени `scriba`; локаль запиннена `?hl=en` + `--lang=en-US` | — | 1 |
| T051 | meet-adapter | T050 | todo | `waitAdmitted` различает admitted / denied / timeout / captcha; каждый исход проверен вживую | — | 1 |
| T052 | meet-adapter | T050 | todo | `activeSpeaker` возвращает имя говорящего; селекторы по `aria-label`/`role`, не по классам | — | 1 |
| T053 | meet-adapter | T050 | todo | `isAlone` и `leave`: бот выходит через 2 минуты один в звонке и освобождает ресурсы | — | 1 |
| T060 | swarm-client | T013 | todo | Клиент пяти эндпоинтов; контрактный тест со стороны потребителя | — | 1 |
| T061 | swarm-client | T060 | todo | Очередь выгрузки: ретраи с задержкой, локальный бэкап неотправленного, переживает обрыв сети | — | 1 |
| T062 | swarm-client | T060 | todo | `claim` вернул `defer` → аудио не отправляется вообще (проверено тестом) | — | 1 |
| T063 | swarm-client | T030,T052 | todo | Таймлайн говорящих собирается из опросов `activeSpeaker` и уходит полем `speakers` | — | 1 |
| T070 | orchestrator | T045,T060 | todo | `startForMeeting` / `stop` через dockerode; ручной запуск по ссылке работает | — | 1 |
| T071 | orchestrator | T070 | todo | Heartbeat идёт; смерть контейнера посреди встречи видна существующему watchdog | — | 1 |
| T072 | orchestrator | T070 | todo | Брошенных контейнеров не остаётся после падения оркестратора (проверено падением) | — | 1 |
| T080 | notices | T012 | todo | Уведомление «стою у двери» владельцу встречи; повтор ровно один, затем выход | — | 1 |
| T081 | notices | T080 | todo | Тексты уведомлений заведены на английском и русском | — | 1 |
| T082 | notices | T022 | todo | Ни один сценарий отказа не завершается молча — проверено по списку из спеки | — | 1 |
| T003 | chores | T015,T033,T044 | todo | `ARCHITECTURE.md` и `QUICK_REF.md` обновлены по факту изменений сервера и появления бота | — | 1 |
| T004 | chores | T043,T051,T063,T071,T082 | todo | Живой прогон на реальной встрече по всему списку готовности MVP из спеки | — | 1 |
| T100 | orchestrator | T071 | todo | Автозапуск по календарю: бот приходит на встречу сам | — | 2 |
| T101 | chores | — | blocked:Q006 | Завести `scriba` Google-аккаунт и порядок добавления его в календарные приглашения | — | 2 |
| T110 | chores | — | todo | Проверить Talk API `Recordings` Контур.Толк: покрывает ли он наши встречи без браузерного бота | — | 3 |
| T111 | meet-adapter | T110 | todo | Адаптер Контур.Толк по тому же интерфейсу площадки | — | 3 |
| T120 | meet-adapter | — | todo | Адаптер Zoom на нативном Meeting SDK for Linux | — | 4 |
| T121 | conference-link | T120 | todo | Ключ комнаты `zoom:<id>` заведён на сервере и в рекордере одновременно | — | 4 |
| T130 | chores | — | todo | Переезд на Dodo AI Platform — до того, как бот станет единственным источником записи | — | 5 |
