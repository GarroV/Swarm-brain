# Блок: ingest-speakers

## Назначение

Учит сервер принимать таймлайн говорящих и подставлять настоящие имена в стенограмму вместо метки
«собеседник». Отдельный блок, потому что трогает `meeting-processor` — общий модуль с действующим
потребителем, и цена ошибки тут выше, чем у кода бота.

Работы меньше, чем кажется: модель уже есть — `Segment { start, end, text, speaker? }` хранит
говорящего по интервалу, а имя вычисляется ровно в одной строке сборки.

## API-контракт

```jsonc
// поле speakers формы meeting-ingest — НЕОБЯЗАТЕЛЬНОЕ, JSON-строка, времена в секундах от начала записи
[{ "start": 0.0, "end": 12.4, "name": "Василий Гарро" }]
```

- имя подставляется в `Segment.speaker` по наибольшему перекрытию интервалов;
- нет поля / пустой таймлайн / нет совпадения → **прежнее поведение**, не ошибка;
- `Part.track` и восемь мест вокруг него не трогаются.

### Чистый модуль `_shared/speakers.ts` (без сети, без `Deno.env`)

```ts
export interface SpeakerSpan { start: number; end: number; name: string }
export interface Segment { start: number; end: number; text: string; speaker?: string }
export interface SpeakerPart { track: "sys" | "mic"; done: boolean; segments?: Segment[] }
export class SpeakerTimelineError extends Error {}
export const MAX_SPEAKER_SPANS = 5000;
export const MAX_SPEAKER_NAME_LEN = 120;

export function parseSpeakerTimeline(raw: unknown): SpeakerSpan[];      // бросает SpeakerTimelineError
export function nameAt(tl: readonly SpeakerSpan[], start: number, end: number): string | null;
export function buildSegments(parts: readonly SpeakerPart[], micOffset: number, tl: readonly SpeakerSpan[]): Segment[];
export function speakerLegend(ownerName: string | null, labels: Iterable<string | undefined>): string;
```

- `parseSpeakerTimeline`: `null`/`undefined`/`""` → `[]`; строка → `JSON.parse`. Отвергает: не-JSON,
  не-массив, не-объект в элементе, `name` не строка / пустое после чистки / длиннее
  `MAX_SPEAKER_NAME_LEN`, `start`/`end` не конечные числа, `start < 0`, `end <= start`, больше
  `MAX_SPEAKER_SPANS` интервалов. Имя чистится: управляющие символы и переводы строк → пробел,
  пробелы схлопываются, trim (имя едет в промпт — перевод строки там ломает формат и открывает
  инъекцию).
- `nameAt`: побеждает наибольшее **строго положительное** перекрытие; ничья → более ранний элемент
  массива; касание границ (`end === span.start`) перекрытием не считается; сегмент нулевой длины →
  интервал, содержащий точку; нефинитные входы → `null`.
- `buildSegments`: имя подставляется **только** дорожке `sys`; `mic` остаётся «я» (по построению это
  голос `claim_owner`, он авторитетнее таймлайна, и у бота дорожки `mic` не бывает). Пустой таймлайн
  → результат байт-в-байт как сейчас.
- `speakerLegend`: именованных меток нет → **прежняя строка дословно** (bumblebee не замечает
  правки); появились имена → легенда перечисляет ровно те метки, что есть в стенограмме.

## Зависимости

`identity` (бот должен уметь аутентифицироваться, прежде чем что-то слать). Внешнее: существующие
`meeting-ingest`, `_shared/meeting-processor.ts`.

## Definition of Done блока

| этап | пункт |
| --- | --- |
| 1 | `nameAt` покрыта тестами: перекрытия, дыры, пустой таймлайн, несовпадение времён |
| 1 | таймлайн валидируется на границе: мусор отвергается внятной ошибкой, а не молча |
| 1 | **мягкая деградация проверена тестом:** без таймлайна стенограмма ровно такая, как сейчас |
| 1 | легенда говорящих в промпте тезисов согласована с новыми именами (не обещает «я», которого нет) |
| 1 | `bumblebee` прогнан: его записи размечаются как раньше |
| 1 | `ARCHITECTURE.md` обновлён тем же коммитом |

## Статус

in_progress · 2026-09-23

- **Где стою:** контракт модуля зафиксирован (выше); тесты пишет `optio`, реализацию — сам.
- **Схему НЕ трогаю:** таймлайн живёт в существующей jsonb-колонке `meetings.process_state`
  (`ProcessState.speakers?`), миграция не нужна — поле необязательное, старые строки читаются как
  «таймлайна нет».
- **Дальше:** `_shared/speakers.ts` → проводка в `meeting-ingest` и `meeting-processor` → легенда →
  `ARCHITECTURE.md`/`QUICK_REF.md` → `./scripts/check`.
- **Открыто:** живого прогона bumblebee из сессии нет (нужна машина человека) — регресс закрывается
  тестом мягкой деградации и неизменностью формы запроса без поля `speakers`.
