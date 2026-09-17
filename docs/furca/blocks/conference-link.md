# Блок: conference-link

## Назначение

Сервер уже отдаёт ссылку на звонок (`join_url`, появилась ради кнопки «Подключиться», #193). Блок
дополняет её тем, чего не хватает боту: какая это площадка и почему ссылки нет, если её нет.
Маленький блок с большим эффектом — он же закрывает часть запланированной Фазы B room-match.

## Контракт

```ts
// meeting-current/join-link.ts
export function joinLink(ev: GEvent): string | null;                    // существует
export function conferencePlatform(url: string): "meet" | "kontur" | "zoom" | null;  // новое

// ответ meeting-current
{ join_url: string | null, platform: "meet" | "kontur" | "zoom" | null, reason?: "no_conference_link" }
```

Источники ссылки по порядку: `conferenceData.entryPoints[]` (video, https) → `hangoutLink` →
`location` → **`description`** (новое). Площадка по хосту: `meet.google.com` → `meet`,
`ktalk.ru` / `talk.kontur*` → `kontur`, `*.zoom.us` → `zoom`.

## Зависимости

Продуктовых нет. Внешнее: существующие `meeting-current/index.ts`, `join-link.ts` и его тесты.

## Готовность блока

| этап | пункт |
| --- | --- |
| 1 | `description` добавлен четвёртым источником, тест на него есть |
| 1 | `conferencePlatform` покрыта тестами: все три площадки, мусор, неизвестный хост → `null` |
| 1 | ссылки нет → в ответе `reason: "no_conference_link"`, а не молчаливый `null` |
| 1 | существующие тесты `join-link.test.ts` зелёные — поведение `join_url` не изменилось |
| 2 | ключ комнаты `zoom:<id>` заведён на сервере и в рекордере одновременно |

## Статус

not_started · 2026-09-17
