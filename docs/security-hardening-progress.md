# Security hardening — прогресс (ветка feat/security-storage-fix)

> Рабочий трекер набора security-фиксов. Начат 2026-09-05. НЕ раскатан на прод —
> раскатка только по «да» владельца и в ночное окно (см. CLAUDE.md §Раскатка).

## Аудит (2026-09-05, проверено живыми запросами на прод)

Что закрыто и работает: прямой доступ к таблицам через anon-ключ (RLS deny-all, `*/0`);
`generate_mcp_token` grant отозван (`has_function_privilege('anon',…)=false`); MCP
`tools/call` за токеном; swarm-api за auth (401); cron за `CRON_SECRET`; бакет
`meeting-audio` приватный.

Дыры (advisory-черновики в GarroV/Swarm-brain/security/advisories):
- **#1 Утечка файлов `swarm_drive`** — публичный бакет + предсказуемые пути, внутренний PDF
  скачан анонимно. Advisory GHSA-xx2r-w4g6-g5g6. **← В РАБОТЕ.**
- **#2 Вебхук бота без `secret_token`** — подделка апдейтов = трата OpenAI + команды от
  админа. Advisory GHSA-mjhh-3wvp-23p2.
- **#3 Rate-limiting отсутствует везде** — фрод/DoS OpenAI-ключа.
- **#4 Демо-лимит запросов** (частный случай #3): 5 «дорогих» запросов/день на демо-сессию
  (ключ лимита — `jti` в JWT демо-входа).

Best-practices ресёрч (регулярная практика) — отдельным потоком: включить GitHub secret
scanning + push protection; guard-слой для `tasks`/`meetings`; Dependabot+gitleaks;
раздельные OpenAI-ключи; SLSA-провенанс рекордера; ритм PR/неделя/месяц/квартал с AITriage.

## Дизайн #1 (утверждён владельцем)

Полный фикс за один заход. **Инверсия бакетов:** новый приватный `swarm_private` для данных
команды; `swarm_drive` остаётся публичным, но вычищается до одних recorder-ассетов (не секрет
— установщик и Updater.swift тянут их анонимно, их НЕ трогаем). Раздача приватных файлов через
signed URL после проверки доступа. Веб → стабильный `GET /file/*` (302 на signed). Бот →
signed URL напрямую (Telegram качает сам, наш auth не пройдёт). API нормализует исходящие
ссылки в `/api/file/<path>` — бесшовность без синхронной раскатки клиента. Ноль-потеря:
copy → verify → бэкап → delete последним. Резолв владельца — через реестр `storage_files`
(связь path→запись), права — из записи на лету (без дрейфа приватности).

## Статус реализации #1

- [x] Слой авторизации: `swarm-api/file-access.ts` — `decideFileAccess` + `getFileSecure`.
      11 тестов зелёных. Коммит 18c2204.
- [x] Миграция реестра: `supabase/migrations/20260905200000_storage_files_registry.sql`.
- [ ] **СЛЕДУЮЩЕЕ:** эндпоинт `GET /file/*` в `swarm-api/index.ts` — распарсить path после
      `/file/`, `getFileSecure(supabase, path, {groupId, telegramId, isAdmin})`,
      `supabase.storage.from(bucket).createSignedUrl(path, 60)` → 302 Location. Вставить рядом
      с `/search`/`/ask` (после строки ~1399). Unit-логика уже покрыта; эндпоинт — тонкая
      обёртка, смоук на проде ночью.
- [ ] Нормализация исходящих ссылок: где сейчас `getPublicUrl`/`publicUrl` уходит в ответ
      (`swarm-api/index.ts:1227,2246`, `swarm-bot/lib/storage.ts:385`, `swarm-mcp:134`) —
      отдавать `/api/file/<path>`. Хранить path в БД.
- [ ] Точки загрузки → бакет `swarm_private` + запись в `storage_files` (owner_kind, entry_id).
      `uploadToStorage` (storage.ts), `/entries/upload` (index.ts:1210), feedback (index.ts:2244),
      swarm-mcp upload (index.ts:127).
- [ ] Бот: signed URL напрямую при отправке медиа/скринов в Telegram.
- [ ] Скрипт переноса `uploads/pdfs/feedback` swarm_drive → swarm_private (copy→verify→бэкап),
      идемпотентный. Артефакт для ночной раскатки.
- [ ] Миграция данных: backfill `storage_files` из существующих ссылок + перепись URL→path.
- [ ] Доки: `ARCHITECTURE.md`/`QUICK_REF.md` — эндпоинт `/file`, бакеты, реестр, флоу.

## Порядок ночной раскатки #1 (бесшовно, ноль-потеря)

0. Создать `swarm_private`, скопировать приватные файлы (оригиналы остаются).
1. Деплой swarm-api: `/file` + нормализация ссылок (эндпоинт принимает и старый URL).
2. Миграция БД: backfill реестра + URL→path.
3. Проверить показ на проде → бэкап → удалить приватные объекты из публичного `swarm_drive`.
   Откат до шага 3 — вернуть старый код; после — из бэкапа.
