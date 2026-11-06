# scriba: другие рекордеры не удерживают пустой Meet

Регрессия #872: после ухода людей в Meet остались scriba и `tl;dv AI Notetaker`.
Подсчёт всех участников удерживал scriba ещё около двух часов вместо выхода
после двух минут одиночества.

`bot/src/meet-adapter/speakers.ts:isAloneSnapshot` вычитает из числа участников
доказанные плитки известных рекордеров, по уникальному `data-participant-id`.
Если панель содержит больше участников, чем видно в галерее, скрытые участники
сохраняются. Видимый человек удерживает бота и при отстающем счётчике панели.
Отсутствие сигнала остаётся `null`, неизвестное имя считается участником.

Распознаются полные имена `tl;dv`, `tl;dv AI Notetaker`, `Read.ai`, `Fireflies`,
`Otter`, а также стандартные формы поставщиков:

- `read.ai meeting notes` и `Meeting Analytics from Read` — [Read Help Center](https://support.read.ai/hc/en-us/articles/20465026465299-How-can-I-customize-the-Read-Assistant-name-that-shows-during-meetings).
- `Fireflies.ai Notetaker` — [Fireflies Desktop App](https://guide.fireflies.ai/articles/1208704416-getting-started-with-the-fireflies-desktop-app).
- Имя владельца с суффиксом `'s Notetaker (Otter.ai)` (также типографский апостроф
  и `AI Notetaker`) — [Otter Notetaker Overview](https://help.otter.ai/hc/en-us/articles/4425393298327-Otter-Notetaker-Overview).

Регистр, повторные пробелы и служебные пометки Meet нормализуются. Совпадение
бренда внутри имени человека не является основанием для выхода: например,
`Otter Smith` и `Anna from Read.ai` сохраняются. Произвольно переименованного
рекордера по имени определить нельзя; без известной формы он остаётся участником.

Двухминутный `AloneTimer` получает исправленный сигнал. Существующий
`SilenceWatch` получает тот же сигнал «есть люди»; его правила и тексты остаются
прежними. Арбитраж записей по D020 находится в конвейере claim/ingest и с этим
подсчётом не связан.

Проверки: unit-регрессии подсчёта, `AloneTimer` и `SilenceWatch`; сценарий
`in-call-other-recorder.html` в `smoke-meet.ts` проверяет настоящий адаптер,
таймер выхода и освобождение браузерного контекста. Протокольный прогон
использует Chrome for Testing и перехваченные fixture-страницы, без живой встречи,
аудио или отправки сообщений. Полный живой Meet-smoke остаётся отдельной проверкой;
`SCRIBA_MEET_LIVE=0` помечает его неполным (код 2), а не зелёным.
