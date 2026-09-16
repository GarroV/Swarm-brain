# Стек и версии — исследование FURCA (meeting-bot)

Направление: подтвердить стек контейнера записи встречи (Xvfb/PulseAudio/Chromium+Playwright/ffmpeg/supervisor на TS) фактами и найти грабли до стройки.

Дата исследования: 2026-09-17.

---

## 1. Playwright — версия, официальный Docker-образ, состав

**Прочитано в полном объёме** (WebFetch на сырой Dockerfile, не пересказ).

- Актуальная версия на момент исследования: **Playwright v1.63.0**, образ `mcr.microsoft.com/playwright:v1.63.0-noble`. Тег кодирует версию и базу (`noble` = Ubuntu 24.04 LTS, есть также `jammy` = 22.04, `resolute` = 26.04). Источник: https://playwright.dev/docs/docker
- **В образе НЕТ Xvfb и НЕТ PulseAudio.** Проверено чтением исходного `Dockerfile.noble` из репозитория microsoft/playwright (ветка release-1.63): базовый `FROM ubuntu:noble`, `apt-get install` ставит только `curl wget gpg ca-certificates git openssh-client nodejs`. ffmpeg попадает в образ отдельно — как часть браузерного набора Playwright (`playwright install` тянет свой ffmpeg для трассировки видео Playwright, это НЕ системный ffmpeg и не предназначен для записи звонка). Источник: https://raw.githubusercontent.com/microsoft/playwright/release-1.63/utils/docker/Dockerfile.noble
  - **Вывод: Xvfb и PulseAudio придётся ставить и настраивать самим** поверх официального образа (или писать полностью свой Dockerfile на базе того же `ubuntu:noble`/`jammy`, беря только версию Node/Chromium как ориентир). Официальный образ рассчитан на headless CI-прогон тестов, а не на «встроенный виртуальный экран + звук» сценарий.
  - Важно: раз штатный образ не содержит звуковой подсистемы, это подтверждает, что **сборка PulseAudio null-sink — обязательная часть работы**, а не опциональная подстраховка (см. §2).
- Env в образе: `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`. Ничего про DISPLAY/звук.
- Размер: сжатый образ (`noble`, Node-вариант) — **~880–912 МБ** (вырос с 880 МБ в 1.60.0). `jammy` — самый компактный из вариантов, Python-вариант — самый крупный (несёт ещё и Python-рантайм). Источники: обсуждение размера в issues microsoft/playwright — https://github.com/microsoft/playwright/issues/17408, https://github.com/microsoft/playwright/issues/10168, официальная страница образа https://hub.docker.com/r/microsoft/playwright
  - **При бюджете диска 134.7 ГБ на несколько проектов ~900 МБ базового образа — заметная, но не критичная статья.** Дальше вес добавляют apt-пакеты (pulseaudio, xvfb, ffmpeg системный) и слои приложения.

### Референс: живой опенсорсный бот с точно таким же стеком

Нашёл действующий (пушится по сей день) опенсорсный проект **`screenappai/meeting-bot`** — «Universal meeting bot to record Google Meet, Zoom, and Microsoft Teams», 174 звезды, последний пуш 2026-08-28. Это готовый референс-рецепт почти один-в-один под нашу задачу. Репозиторий: https://github.com/screenappai/meeting-bot — **прочитан частично, `start.sh` целиком через `gh api`, не пересказ по README.**

`start.sh` (полный текст прочитан):
- `export DISPLAY=:99`, затем весь процесс поднимается через `xvfb-run --server-num=99 --server-args='-screen 0 1280x800x24' npm run start` — то есть **Xvfb запускается оборачивающим скриптом `xvfb-run`, а не руками через `Xvfb :99 &`**. Экран 1280×800×24.
- `XDG_RUNTIME_DIR` выставляется вручную (`/run/user/<uid>`) и создаётся с `chmod 700` **до** старта PulseAudio — это именно та грабля из ТЗ («PulseAudio не стартует без прав/`XDG_RUNTIME_DIR`»), и разработчики её уже поймали и закрыли явным кодом.
- PulseAudio стартует в **user mode**, не system mode: `pulseaudio -D --exit-idle-time=-1 --log-level=info` (без `--system`). Комментарий в коде: «simpler and more reliable». `--exit-idle-time=-1` — критично: без этого демон сам выключится при отсутствии клиентов.
- Готовность демона ждут поллингом `pactl info` до 25 раз по 0.2с (`wait_for_pulseaudio`), а не считают, что процесс стартовал мгновенно.
- Null-sink создаётся именно так: `pactl load-module module-null-sink sink_name=virtual_output sink_properties=device.description="Virtual_Output"`, затем **обязательно** `pactl set-default-sink virtual_output` — иначе браузер продолжит пытаться писать в дефолтный (отсутствующий) sink.
- Скрипт **сам проверяет**, что появился монитор-сорс `virtual_output.monitor` (`pactl list sources short | grep virtual_output.monitor`) и явно логирует `WARNING`, если нет — то есть у них в проде было достаточно тишины-без-ошибки, чтобы обвязать эту проверку явной самопроверкой.
- Репозиторий держит **три Dockerfile** под разные сценарии: `Dockerfile.chrome-cdp`, `Dockerfile.development`, `Dockerfile.production` — плюс отдельный `xvfb-run-wrapper` файл (говорит о том, что штатный `xvfb-run` из пакета им чем-то не подошёл и его пришлось оборачивать/патчить).

`Dockerfile.production` (прочитан целиком): база `FROM node:20` (не `mcr.microsoft.com/playwright`!) — apt-пакеты ставятся руками: `ffmpeg libnss3 libxss1 libasound2 pulseaudio alsa-utils libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon-x11-0 libgbm-dev libgl1-mesa-dri libgl1-mesa-glx mesa-utils xvfb wget gnupg xorg xserver-xorg libx11-dev libxext-dev dos2unix`, плюс `google-chrome-stable` из репозитория Google (с фолбэком на `chromium`, если недоступен). ENTRYPOINT — тот самый `xvfb-run-wrapper` (см. выше), не `xvfb-run` из пакета. Источник: https://github.com/screenappai/meeting-bot/blob/main/Dockerfile.production
- **Playwright всегда запускается ЗДЕСЬ headed (`headless: false`), никогда `headless: true`/`--headless=new`.** Экран подставляет Xvfb, а не встроенный headless Chromium. Подтверждено в `src/lib/chromium.ts` — во всех трёх веток запуска (`connectOverCDP`, `launchPersistentContext`, обычный `chromium.launch`) стоит `headless: false`. Это прямое практическое подтверждение того, что headless-режим для звонка с реальным звуком/видео не используется этим продакшн-ботом вообще — Xvfb + headed Chromium выбраны вместо headless как основной путь. Источник: https://github.com/screenappai/meeting-bot/blob/main/src/lib/chromium.ts

### Критическая грабля: Playwright сам мьютит звук по умолчанию

**Подтверждено официальной документацией Playwright**, не только чужим кодом: `chromium.launch()` **по умолчанию добавляет `--mute-audio`** в список аргументов Chromium — это зашито в исходнике (`packages/playwright-core/src/server/chromium/chromium.ts`, строка с `'--mute-audio'` в дефолтных args, тот же флаг встречается и в `bidiChromium.ts`). Официальная документация `BrowserType.launch()` прямо учит убирать его: *«You can use `ignoreDefaultArgs` to filter out `--mute-audio` from default arguments»*, пример — `ignoreDefaultArgs: ['--mute-audio']`. Источники: https://playwright.dev/docs/api/class-browsertype (секция `ignoreDefaultArgs`), исходник флага — https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts (поиск `mute-audio`: `gh search code "mute-audio" --repo microsoft/playwright`).
- Референс-репозиторий `screenappai/meeting-bot` **уже наступил на эту грабли и явно её обходит**: для google-бота `ignoreDefaultArgs = ['--mute-audio', '--enable-automation']`, для остальных — как минимум `['--mute-audio']`. Источник: `src/lib/chromium.ts` (см. выше).
  - **Вывод для нашей сборки: без явного `ignoreDefaultArgs: ['--mute-audio']` PulseAudio null-sink будет честно писать цифровую тишину** — это тот самый «классический способ записать тишину» из ТЗ, только причина не в headless-режиме, а в собственном дефолтном аргументе Playwright. Это первое, что нужно проверить на живом смоук-тесте (реальный сигнал в `.monitor`, не «по коду должно работать»).
- `headless`-опция в официальной документации по умолчанию `true`; про новый headless-режим (`--headless=new`) официальная документация упоминает только вскользь в контексте опции `channel` («opt in to new headless mode»), никакой явной документации про звук в headless нет — это подтверждает, что вопрос звука в headless в официальных доках Playwright не разобран вовсе, и полагаться стоит на практику (Xvfb + headed), а не на headless.


## 3. ffmpeg — нарезка на части без перекодирования (m4a/AAC)

**Прочитано в полном объёме** (сырой HTML документации ffmpeg.org загружен и распарсен напрямую, а не пересказ от суммаризатора — важно, см. предупреждение ниже).

- Актуальная официальная документация muxer'а `segment` / `stream_segment` / `ssegment`: https://ffmpeg.org/ffmpeg-formats.html (раздел «segment, stream_segment, ssegment», нумерация на 2026-09-17 — §4.73).
- **⚠️ Важная самокоррекция по ходу исследования.** Первый проход через WebFetch (суммаризация страницы моделью) утверждал, что у muxer'а `segment` есть опция `segment_size` — «create segments that contain up to size bytes of payload data». **Это неверно** — проверено прямым чтением HTML документации (`curl` + разбор без модели-суммаризатора): у `segment`/`stream_segment`/`ssegment` **нет** байт-размерной опции вообще. `segment_size`/`hls_segment_size` существует **только у muxer'а HLS** (`-f hls -hls_segment_size <bytes>`, см. тест `tests/fate/hlsenc.mak` в исходниках — https://github.com/FFmpeg/FFmpeg/blob/master/tests/fate/hlsenc.mak) и относится к сегментам `.ts`/манифесту `.m3u8`, не к прямой нарезке m4a. **Урок: суммаризация документации инструментом — не первичный источник; для точных числовых/опционных деталей нужно читать сырой текст.**
- Опции `segment`-muxer'а, подтверждённые дословной цитатой из документации:
  - `segment_time` — «Set segment duration to time... Default value is "2"» (**секунды**, то есть если не задать явно — сегменты будут по 2 секунды!). «Note that splitting may not be accurate, unless you force the reference stream key-frames at the given time.»
  - `segment_format format` — «Override the inner container format, by default it is guessed by the filename extension» — то есть `out%03d.m4a` сам по себе определит контейнер как MP4/M4A, руками указывать необязательно.
  - `write_header_trailer` (bool, default **true**) — «Write a header to the first segment and a trailer to the last one... Disabling it (false) also forces individual_header_trailer to false».
  - `individual_header_trailer` (bool, default **true**) — «If enabled, write a complete header and trailer to every segment, making each segment an independently usable file. If disabled..., only the first segment is given a header and only the last one a trailer.»
    - **Вывод: дефолтное поведение muxer'а уже даёт самостоятельно открываемые части** — именно то, что нужно по ТЗ («корректные заголовки у каждой части»). Ничего специально включать не нужно, но **важно не выключить это по ошибке** (`write_header_trailer=false` в конфиге тянет за собой отключение `individual_header_trailer` автоматически, молча).
  - `reset_timestamps` (default **0**, то есть выключено по умолчанию) — «Reset timestamps at the beginning of each segment, so that each segment will start with near-zero timestamps... May not work with some combinations of muxers/codecs.» — **это нужно включать руками** (`-reset_timestamps 1`), иначе плеер может показывать некорректный таймкод/позицию у частей 2, 3, ... (хотя сам файл всё равно откроется благодаря `individual_header_trailer`).
- **Как резать по размеру (≤25 МБ), а не по времени.** Прямой байт-размерной опции у `segment`-muxer'а нет (см. коррекцию выше). Официально задокументированный путь — **пересчитать лимит байт в лимит времени** через `segment_time`, зная постоянный битрейт AAC-потока (при `-b:a` с постоянным битрейтом — а не VBR — размер сегмента предсказуем: `segment_time_sec ≈ limit_bytes*8 / bitrate_bps`, с запасом на контейнерные оверхеды). Это стандартный практический приём при работе с этим muxer'ом (не отдельная официальная рекомендация ffmpeg.org, а вывод из документированного поведения — отмечаю явно, что это не прямая цитата, а следствие фактов выше).
  - Альтернатива без muxer'а `segment` вообще: писать один непрерывный поток и резать вызовом ffmpeg с `-fs <bytes>` (лимит размера **одного** выходного файла — не создаёт следующие части сама, «Stop writing the output after its size exceeds specified value» — по факту используется для одного прогона, не для автоматической мультичастной нарезки) — для многочастевой записи это означало бы перезапуск ffmpeg на каждую часть, что рвёт непрерывность аудиопотока сильнее, чем сегментный muxer. **Сегментный muxer с `segment_time`, пересчитанным из битрейта, выглядит надёжнее** для нашего сценария (одна встреча, потенциально часы записи).
- **`-c copy` (стрим-копия, без перекодирования) корректно работает с `segment`-muxer'ом** — это штатный сценарий из примеров документации (`ffmpeg -i in.mkv -codec copy -map 0 -f segment ...`), при условии что **кодируем один раз** (`-c:a aac` при живой записи с PulseAudio) **и сегментируем уже закодированный элементарный поток `-c copy`**, а не перекодируем на каждый сегмент.
- **Грабля ADTS↔MP4**, подтверждена частым паттерном в реальном коде (найдено `gh search code "aac_adtstoasc"` — используется в dosbox-x, TelegramSwift, simplest_ffmpeg_mobile и др., см. https://github.com/joncampbell123/dosbox-x/blob/master/mts_to_720p.sh): если исходный AAC-поток уже в формате ADTS (например, если через промежуточный шаг что-то отдаёт `.aac`/ADTS-эфир, а не пишет сразу в MP4/M4A), при ремуксе в MP4/M4A контейнер с `-c copy` **обязателен битстрим-фильтр `-bsf:a aac_adtstoasc`** — иначе MP4 muxer либо откажется писать, либо результат будет невалиден. **Если же ffmpeg сразу кодирует в `.m4a`/MP4 (наш случай: один процесс, `-f pulse -i virtual_output.monitor -c:a aac -f segment ... out%03d.m4a`), энкодер сам отдаёт кадры в «MP4-native» формате без ADTS-заголовков — фильтр не нужен.** Важно только не городить лишний промежуточный ADTS-шаг.

## 2. PulseAudio в контейнере — рабочий рецепт и грабли; PipeWire как альтернатива

**Прочитано в полном объёме**: `start.sh`, `xvfb-run-wrapper` и `Dockerfile.production` из `screenappai/meeting-bot` (см. §1) — рабочий, действующий в проде рецепт PulseAudio. Плюс отдельно прочитан `entrypoint.sh` и `Dockerfile` репозитория `louisoutin/Docker-Virtual-XVFB-pipewire` (19 звёзд, https://github.com/louisoutin/Docker-Virtual-XVFB-pipewire) как альтернативный рецепт на PipeWire.

### Рабочий рецепт PulseAudio (подтверждено действующим кодом)

Порядок действий, вытащенный из `screenappai/meeting-bot` (см. §1 — оба файла, `start.sh` и `xvfb-run-wrapper`, приводят к одной и той же последовательности, что говорит об осознанном, воспроизводимом паттерне, а не случайности):
1. `export XDG_RUNTIME_DIR=/run/user/<uid>`, создать директорию и `chmod 700` **до** запуска демона — иначе PulseAudio либо не стартует, либо стартует в неожиданное место сокета.
2. `pulseaudio --kill` на всякий случай (идемпотентность повторных запусков контейнера/скрипта), подождать, что процесс реально умер (poll `pgrep`).
3. `pulseaudio -D --exit-idle-time=-1 --log-level=info` — **user-mode демон**, не `--system`. `--exit-idle-time=-1` обязателен: без него демон сам завершится, когда решит, что «простаивает» — а это ровно та тишина без явной ошибки, о которой предупреждает ТЗ.
4. Дождаться готовности через **поллинг `pactl info`** (до ~5 секунд, шаг 0.2с) — не считать, что демон готов сразу после фонового запуска.
5. `pactl load-module module-null-sink sink_name=virtual_output sink_properties=device.description="Virtual_Output"`.
6. **Обязательно** `pactl set-default-sink virtual_output` — без этого шага звук может продолжать литься в дефолтный (отсутствующий/иной) sink, а не в тот, что слушает ffmpeg.
7. Явная самопроверка: `pactl list sources short | grep virtual_output.monitor` — если промаха нет, есть явный `WARNING` в логах. Это и есть противоядие от «тишины без ошибки в логах» из ТЗ — сборка обязана логировать факт наличия монитор-сорса, а не полагаться на то, что раз `pactl` не упал, то всё ок.

### PipeWire как альтернатива — рецепт есть, но заметно тяжелее

- Рабочий (хоть и менее популярный — 19 звёзд, последний пуш 2025-03-05) self-contained рецепт на PipeWire существует: контейнер сам поднимает **три демона плюс D-Bus** — `dbus-daemon --system --fork`, `pipewire &`, `wireplumber &`, `pipewire-pulse &` — и только после этого `pactl load-module module-virtual-sink ...` (через слой совместимости `pipewire-pulse`, пакет `pulseaudio-utils`). Источник: https://github.com/louisoutin/Docker-Virtual-XVFB-pipewire/blob/main/entrypoint.sh, Dockerfile — https://github.com/louisoutin/Docker-Virtual-XVFB-pipewire/blob/main/Dockerfile
  - `wireplumber` — session manager, обязателен для PipeWire (без него виртуальные устройства не маршрутизируются). Нужен D-Bus, которого в минимальном контейнере по умолчанию нет — авторы поднимают `dbus-daemon --system` вручную.
  - **Для нашей задачи это не лучше, а хуже**: вместо одного демона (PulseAudio) — четыре процесса (dbus, pipewire, wireplumber, pipewire-pulse) при том же результате (virtual sink + monitor-источник для ffmpeg). При памяти 9.3 ГиБ на несколько проектов лишние resident-процессы — не бесплатны, а выигрыша для одноразового контейнера «поднялся-записал-погас» (не десктопная сессия с горячим переключением устройств, ради чего вообще существует PipeWire) не видно.
  - Утверждение «в 2026 году вся энергия экосистемы ушла в PipeWire, PulseAudio не развивается» встретилось в блоге techrefreshing.com (https://techrefreshing.com/pipewire-vs-pulseaudio/) — **это не первичный источник и не техническая цитата, а мнение блога**; привожу с пометкой «не проверено первичным источником», не как факт.
- **Вывод: для этого контейнера — PulseAudio, а не PipeWire.** Есть действующий продакшн-прецедент именно на PulseAudio (screenappai/meeting-bot, свежий пуш 2026-08-28) с уже пойманными и закрытыми граблями (XDG_RUNTIME_DIR, exit-idle-time, поллинг готовности, self-check монитор-сорса) — то есть путь одним демоном воспроизводим и подтверждён. PipeWire для одноразового short-lived контейнера добавляет D-Bus и session manager без выигрыша, который имел бы смысл на десктопе с несколькими одновременными аудио-клиентами.

### Прочие подтверждённые грабли PulseAudio в контейнерах

- Известная и часто описываемая проблема — **звук пишется как тишина без явной ошибки**, если по невнимательности не создан/не назначен monitor-source или сам null-sink не сделан default (см. п.6 выше). В общих обсуждениях (не специфично для ботов) Chromium-специфичная деталь: getUserMedia в Chromium **не показывает** пункт «Monitor of <device>» в списке устройств (в отличие от Firefox), поэтому для системного захвата вывода в Chromium нужно либо явно выставить monitor как default source в PulseAudio (как в рецепте выше), либо настраивать `~/.asoundrc`. Источник обсуждения: https://lists.w3.org/Archives/Public/public-webrtc-logs/2020May/0119.html (не changelog/офдок, а тред W3C webrtc — фиксирую это явно; для нашего случая это не критично, т.к. мы не используем getUserMedia в Chromium для захвата, а пишем через PulseAudio monitor напрямую средствами ffmpeg — но конкретно этот нюанс объясняет, почему «попытаться получить system audio через getUserMedia в браузере» — путь-ловушка, которым лучше не идти).


## 4. Версии и несовместимости — сводка по первичным источникам

**Прочитано напрямую**: сырой `release-notes-js.md` из репозитория microsoft/playwright (curl + grep, не пересказ), официальный `schedule.json` из репозитория nodejs/Release (curl + json.load, не пересказ), страница пакета ffmpeg на packages.ubuntu.com.

### Node.js — точные даты EOL/LTS на 2026-09-17

Источник: https://github.com/nodejs/Release/blob/main/schedule.json (официальный репозиторий проекта Node.js, машиночитаемый, используется самим nodejs.org).

| Ветка | LTS с | Maintenance с | EOL | Кодовое имя |
|---|---|---|---|---|
| v20 | 2023-10-24 | 2024-10-22 | **2026-04-30** | Iron |
| v22 | 2024-10-29 | 2025-10-21 | 2027-04-30 | Jod |
| v24 | 2025-10-28 | 2026-10-20 | 2028-04-30 | Krypton |
| v26 | 2026-10-28 (ещё не наступило) | — | 2029-04-30 | — |

- **Node.js 20 (Iron) уже мёртв** — EOL наступил 2026-04-30, то есть почти 5 месяцев назад относительно даты исследования (2026-09-17). Использовать его для нового проекта нельзя.
- **Node.js 22 (Jod)** — сейчас в Maintenance LTS (с 2025-10-21), доживёт до 2027-04-30.
- **Node.js 24 (Krypton) — сейчас Active LTS**, войдёт в Maintenance только 2026-10-20 (через ~месяц от даты исследования), а EOL — 2028-04-30. **Рекомендация: брать Node 24 LTS** — на дату старта стройки у неё самый долгий запас Active-статуса и общий срок жизни дальше, чем у 22.
- Node 26 ещё не LTS (станет им 2026-10-28) — рано брать для прод-контейнера, который нужен уже сейчас.

### Playwright — версия, поддержка Node, версии браузеров

Источник: https://github.com/microsoft/playwright/blob/main/docs/src/release-notes-js.md (сырой файл) + https://playwright.dev/docs/intro (WebFetch страницы «System requirements»).

- Официальная страница `playwright.dev/docs/intro`, раздел System Requirements (актуально на 2026-09-17): **Node.js «latest 22.x, 24.x or 26.x»**; ОС — Windows 11+/Server 2019+/WSL, macOS 14+, **Debian 12/13, Ubuntu 22.04/24.04/26.04** (x86-64 или arm64). Значит база `ubuntu:noble` (24.04), которую и берёт официальный `mcr.microsoft.com/playwright` образ (см. §1), — среди официально поддерживаемых.
- Playwright **1.63.0**: Chromium **153.0.8010.12**, Firefox 155.0, WebKit 26.6 (дословно из «Browser Versions» релиз-нот).
- **Подтверждённая история смены Node в официальном Docker-образе Playwright** (дословные строки из release-notes-js.md, раздел «Miscellaneous» под соответствующими версиями):
  - v1.42 (ветка на строке ~1942): «Playwright docker image now comes with Node.js v20.»
  - v1.50 (строка ~1304): «Playwright docker images switched from Node.js v20 to Node.js v22 LTS.»
  - v1.57 (строка ~836): «Playwright docker images switched from Node.js v22 to Node.js v24 LTS.»
  - **Не нашёл подтверждения возврата на Node 22** (это было ошибочное утверждение в одной из промежуточных суммаризаций WebFetch — проверено по сырому тексту, отбрасываю как неверное). Актуальная линия — только рост: v20 → v22 → v24.
- Прекращение поддержки старых Node в самом Playwright: «Support for Node.js 16 has been removed» + «Support for Node.js 18 has been deprecated, and will be removed in the future» (v1.54, дословно).
- Bundled ffmpeg Playwright'а (для собственных нужд трассировки/скриншотов Playwright, НЕ для нашей записи звонка) зафиксирован в `packages/playwright-core/browsers.json` как отдельный компонент `{"name": "ffmpeg", "revision": "1011"}` — подтверждает вывод §1: это другой, свой ffmpeg, не системный пакет.

### ffmpeg — версия из Ubuntu-репозитория и грабля со статическими сборками

- Ubuntu 24.04 (noble) даёт `ffmpeg` версии **6.1.1** (пакет `7:6.1.1-3ubuntu5`, префикс `7:` — эпоха пакета Debian/Ubuntu, не номер версии ffmpeg). Источник: https://packages.ubuntu.com/noble/ffmpeg
- **Грабля: не все сборки ffmpeg умеют писать/читать PulseAudio.** Известный тред/тикет: «Latest static build fails with "Unknown input format: 'pulse'"» — https://trac.ffmpeg.org/ticket/8817 (упомянут как заглавие тикета; сам тикет отдал 403/Anubis-защиту при прямом чтении, поэтому цитирую только заголовок, не тело — **честно отмечаю, что тело тикета не прочитано**, только его название через веб-поиск). Смежное практическое обсуждение той же ошибки: https://github.com/Bleuzen/SpotRec/issues/8. Причина — сборка ffmpeg без флага `--enable-libpulse` (актуально для «статических» сборок вроде johnvansickle.com, часто берут именно такие ради компактности статического бинаря). **Пакет ffmpeg из репозитория Ubuntu/Debian собран с поддержкой PulseAudio «из коробки»** — именно поэтому референсный `Dockerfile.production` (см. §1/§2) берёт `ffmpeg` через `apt-get install`, а не статический бинарь.
  - **Практический вывод: проверять на смоук-тесте `ffmpeg -formats | grep -i pulse` (или `ffmpeg -devices | grep pulse`) сразу после сборки образа** — если пусто, ffmpeg не сможет писать `-f pulse -i ....monitor` вообще, и это тоже одна из форм «тишины», только раньше — process просто не стартует / падает с `Unknown input format`.

