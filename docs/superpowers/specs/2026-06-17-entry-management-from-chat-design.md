# Управление записями из чата (правка/удаление) — дизайн

Дата: 2026-06-17 · Ветка: `sandbox_vas` · Surface: Telegram-бот (swarm-bot)

## Проблема

Бот умеет только **добавлять** записи. Нельзя поправить устаревшую ссылку/факт или
удалить мусор/дубль прямо из чата. Инцидент-триггер: «замени эту форму на `<url>`»
молча сохранилось как новая запись с командой в заголовке (уже починено гейтом
`isEditEntryCommand` — он отвечал «не умею менять»). Этот дизайн заменяет честный
отказ на реальную операцию.

## Решение (подход B — детерминированный флоу)

Намерение `удалить`/`заменить` ловится регэкспом, дальше — структурный флоу без
участия LLM в исполнении: **поиск → показать → кнопка подтверждения → действие**.
Переиспользуем существующий паттерн инлайн-удаления (встречи `md_<id>`,
юзеры `udel_`/`udelc_`).

## Компоненты

### 1. Классификатор намерения — `lib/intent.ts`
Заменяет `isEditEntryCommand`:
```
classifyEntryCommand(text): 'delete' | 'replace' | null
parseManageCommand(text): { cmd, query, newValue? }   // чистая, тестируемая
```
- **delete**: удали/удалить/убери/убрать/сотри/стереть/отмени/отменить
- **replace**: замени/заменить/поменяй/поменять/измени/изменить/обнови/обновить/исправь/исправить/поправь/поправить/отредактируй/редактируй
- **null**: `переименуй`/`перенеси`/«исправь дату/заголовок/теги» — это метаданные,
  их обрабатывает агент через `update_entry`. Также «как удалить…» (вопрос) → null
  (якорь `^\s*<глагол>` + lookahead, чтобы не ловить «заменитель/обновление/удалённая»).
- `parseManageCommand` срезает глагол и филлеры («запись/заметку/ссылку/эту/про/о/об»)
  → `query`; для replace вытаскивает `newValue` (URL через `extractUrl` или текст после «на»/«→»).

### 2. Хендлер — `handlers/manage.ts`
`handleEntryCommand(chatId, userId, text, cmd, groupId)`:
1. `parseManageCommand` → query, newValue.
2. Поиск тем же движком, что `search_knowledge`, **со `visibilityFilter(userId)` + `group_id`** → топ-5.
3. **0** совпадений → «Не нашёл записи по „query". Уточни тему.»
   **1** → сразу карточка записи. **>1** → список кнопками `kbpick_<id>`.
4. Карточка (заголовок, дата, тип, превью контента, ссылка) + кнопки по намерению:
   - delete → `[🗑 Да, удалить]`=`kbdelc_<id>` / `[Отмена]`=`kbcancel`
   - replace + newValue есть → `[✏️ Заменить]`=`kbreplc_<id>` / `[Отмена]`
   - replace без newValue → сессия `manage_replace` (context=id), «Пришли новое содержимое/ссылку»
5. Подтверждение → `assertManageable` → действие → «✅ Удалено / Заменено».

`handleManageCallbacks(...)` — обработка `kb*`-коллбеков. `handleManageSessionInput(...)` —
ввод нового значения для replace.

### 3. Гейт безопасности — `assertManageable(supabase, id, userId, groupId)`
Перед КАЖДЫМ DELETE/UPDATE:
- fetch `id, group_id, is_private, owner_id`; нет записи → «не найдена».
- `group_id !== groupId` → отказ (изоляция воркспейса).
- `is_private && owner_id !== userId` → отказ (чужая личная).
- иначе ОК. Общие записи (`is_private=false`) → любой в воркспейсе (решение владельца).
Все запросы: `WHERE id=… AND group_id=…` (никогда без WHERE).

### 4. Механика replace — `updateEntryContent(id, newContent)` в `storage.ts`
Новый контент → `buildEntryIndex(newContent)` + `getEmbedding` → UPDATE
`content, summary, embedding, countries, entry_type` (+ `metadata.url` для ссылок,
`updated_at`). Сохраняем `created_at, owner_id, is_private, group_id, added_by`.
Для ссылочной записи newValue=URL: `metadata.url=newUrl`, контент перестраивается
с новой ссылкой. Только полная замена, без «дописать» (YAGNI).

### 5. Регистрация (антиколлизия)
- Callback-префиксы: `kbpick_`, `kbdelc_`, `kbreplc_`, `kbcancel` (семейство `kb_` свободно).
- Сессии: `manage_pick` (context: {cmd,newValue?}), `manage_replace` (context: id).
- Роутинг: `index.ts` — `classifyEntryCommand` ДО URL-блока; диспетч `kb*` в секции коллбеков.
- Обновить `docs/QUICK_REF.md` (таблицы префиксов/сессий) и `docs/ARCHITECTURE.md`.

### 6. Ошибки/крайние случаи
- Истёкшая сессия (нет context) → «Сессия истекла, повтори команду».
- Запись уже удалена (0 rows) → «Запись уже удалена».
- Ошибка БД/поиска → дружелюбное сообщение + `console.log` контекста.
- Несколько окон/гонка — операция идемпотентна по id.

### 7. Тесты
- `intent_test.ts`: `classifyEntryCommand` (delete/replace/null; «как удалить»→null;
  «переименуй»→null; «заменитель/обновление/удалённая»→null) и
  `parseManageCommand` (query + newValue извлечение).
- Хендлер/коллбеки/гейт — ручной smoke в боте (детерминированный флоу).

### 8. Рамки (YAGNI)
- Только Telegram-бот. MCP/Claude Desktop — вне рамок (там Claude рассуждает сам).
- Метаданные (переименование/дата/теги/перенос приват↔общая) — у агента `update_entry`.
- Без массового удаления, без «дописать».

## Затрагиваемые файлы
- `lib/intent.ts` (рефактор классификатора + parseManageCommand)
- `handlers/manage.ts` (новый: хендлер + коллбеки + session input)
- `lib/storage.ts` (`updateEntryContent`, `assertManageable`)
- `index.ts` (роутинг намерения + диспетч `kb*`-коллбеков)
- `lib/intent_test.ts` (расширить)
- `docs/QUICK_REF.md`, `docs/ARCHITECTURE.md`

## Критерии готовности
- `удали запись про X` → поиск → подтверждение → удалено (с гейтом).
- `замени эту форму на <url>` → поиск → подтверждение → ссылка заменена, эмбеддинг пересчитан.
- Чужую приватную запись нельзя ни найти, ни удалить, ни изменить.
- `deno check` зелёный, тесты классификатора зелёные, задеплоено `--no-verify-jwt`.
