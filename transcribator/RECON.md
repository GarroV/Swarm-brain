# RECON — разведка anarlog (Этап 0, код-часть)

Дата: 2026-06-12. Источник: клон `fastrepl/anarlog` (548 МБ). Метод: чтение исходников.
Незакрыто (требует мака): живой тест-созвон на русском для оценки качества Soniqo.

## Главный вопрос (гейт): достаёт ли агент идентичность встречи?

**ОТВЕТ: для запланированных встреч — ДА, из коробки. Для ad-hoc — нет id комнаты, как и заложено (→ manual + ручное «объединить»).**

### Запланированные (основная масса синков) — полностью поддержано

`crates/calendar-interface/src/lib.rs:44-90` — модель `CalendarEvent` уже содержит всё, что нужно нашему дедупу:

| Наше поле | Поле anarlog | Доказательство |
|---|---|---|
| `identity_key` (дедуп) | **`external_id`** | `lib.rs:53-55`: «iCal identifier used for deduplication. Apple: calendarItemExternalIdentifier, Google: iCalUID» — буквально наш ключ |
| дата экземпляра (повторы) | **`id`** | `lib.rs:48`: «Synthesized for Apple events (eventIdentifier:YYYY-MM-DD for recurring)» — проблема повторов уже решена |
| серия повторов | `recurring_event_id` | `lib.rs:83-86` |
| id комнаты (Meet/Zoom) | **`meeting_link`** | `lib.rs:61-62` + `crates/calendar/src/lib.rs:190` `parse_meeting_link()` — реальные регэкспы Meet/Zoom/cal.com, тесты на `meet.google.com`/`zoom.us` (`:217-248`) |
| участники | `attendees`, `organizer` | `lib.rs:76-77` |
| title/время | `title`, `started_at`, `ended_at` | `lib.rs:57,65-67` |

Вывод: для `identity_kind=calendar` агент мапит `identity_key = external_id` напрямую, **без скрейпинга браузера**, и бесплатно отдаёт `meeting_link`, участников, title, время — наш payload станет богаче, чем в контракте.

### Контур.Толк — мелкий патч

`parse_meeting_link` (`crates/calendar/src/lib.rs:195-209`) знает Meet/Zoom/cal.com; для Толка спец-регэкспа нет, но есть generic-fallback (`URL_RE` → первый https-URL в notes/url). Значит ссылка Толка **подхватится fallback'ом**, если она в событии единственная. Для надёжности — добавить регэксп Толка (`ktalk.ru`/`talk.kontur.*`) одной строкой в форке.

### Ad-hoc (без события календаря) — id комнаты НЕТ, как и планировали

`plugins/detect/src/events.rs:12-23` — `detect` эмитит `MicDetected { apps }` / `MicStopped { apps }`: знает **какое приложение** заняло микрофон (bundle id), но **НЕ** даёт URL/id комнаты. Авто-извлечения conference_id для ad-hoc в anarlog нет.

→ Подтверждает наше решение: ad-hoc звонок → `identity_kind=manual` (кнопка) + warn-at-add (ручное «объединить»). Путь `identity_kind=room` (id комнаты из URL вкладки браузера) потребовал бы **нашего** патча (чтение активной вкладки через AppleScript/accessibility) — необязательный, отложен.

## Прочие вопросы Этапа 0

- **Batch + русский (подтверждено ранее + здесь):** локальный STT = Soniqo (Parakeet TDT v3 INT8), русский в списке языков, batch — единственный локальный режим для не-английского. Whisper q8 — за фиче-флагом `whisper-cpp` (в дефолте выкл). **Качество русского — оценить живым тест-созвоном (остаётся на маке).**
- **Точка интеграции `plugin-swarm`:** `apps/desktop/src/stt/batch-completed-notification.ts` — событие `batch-completed:<sessionId>` = «транскрипт готов». Хук: на стоп записи → `claim` (с `external_id`/`meeting_link` из связанного события календаря, либо manual); на `batch-completed` → читаем транскрипт сессии → `ingest`.
- **Авто-старт по календарю** уже есть (`auto_start_scheduled_meetings`) → сессия записи привязана к событию календаря, значит агент знает `external_id` встречи на старте (подтвердить при сборке, но фича это подразумевает).
- **Пометки с таймстампами** — в anarlog НЕТ (raw_md Tiptap без времени) → окно пометок пишем сами (как и заложено).
- **Bootstrap:** регистрация плагинов — `apps/desktop/src-tauri/src/lib.rs`; `plugin-swarm` добавить, лишние не регистрировать.

## Итог гейта

Гейт Этапа 0 (код-часть) **пройден положительно**: идентичность/дедуп для запланированных встреч поддержаны anarlog нативно (`external_id`); ad-hoc — manual + ручная склейка, как спроектировано; batch-режим и точка хука есть. Остаётся одно — **живой тест-созвон на русском** (нужен мак) для решения Soniqo vs Whisper-q8 по качеству.

Влияние на наш контракт: для `identity_kind=calendar` агент берёт `identity_key = CalendarEvent.external_id` и дополнительно шлёт `meeting_link`/attendees/title — уточнить в `10-REVISED-DESIGN.md §7.1` при сборке агента.
