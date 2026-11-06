# Edge runtime main-router — канон установленного кода

Задача #1129: версионировать существующий app-router без изменения поведения.
`main.ts` скопирован с установленного файла побайтно; этот snapshot не устанавливался
автором в production. Версионирование не меняет работающий runtime.

## Происхождение и лицензия

- Установленный путь: `/srv/swarm/supabase/volumes/functions/main/index.ts`.
- Snapshot 06.11.2026: 13 124 bytes, 403 строки.
- SHA256: `aa7dbdc83d915797ed92600bc0f7c500d6f6203361edc92b61716d19a7382f07`.
- Наблюдаемый image: `supabase/edge-runtime:v1.76.2`.
- Vendor source: `supabase/supabase`, `docker/volumes/functions/main/index.ts`.
- Лицензия upstream: Apache-2.0; точный upstream LICENSE сохранён рядом.
- На сервере нет `.supabase-version`, поэтому точный исходный vendor ref не доказан.
  Сравнение сделано с upstream commit `396358c7cbccf998df72a7d225d0c7c32b73ce57`
  от 06.11.2026; это **comparison ref**, а не утверждение о происхождении snapshot.

## Наблюдаемые отличия и неизменяемая граница

Установленный snapshot сохраняет memory 150 MB, wall 400000 ms, requestAbsent 60000 ms,
CPU override только для market-ingest (soft 20000 / hard 30000 ms), передаваемый
SUPABASE_FUNCTION_SLUG и три повтора при WorkerAlreadyRetired. Байты не форматировались,
настройки и авторизация не менялись.

От backup до CPU-правки 04.11 код отличается только cpuLimits declaration/spread;
после их удаления AST совпадает с backup. В текущем upstream comparison ref уже
присутствуют wall/slug, memory составляет 256 MB, изменены bootstrap/error handling
и части обработки раннего запроса. Эти расхождения нельзя объявлять только локальными
модификациями: source version на сервере не записана. Upstream upgrade в эту задачу
не входит; snapshot не перебазировался.

Обычный functions archive исключает main-router. Существующий updater стека включает
его в трёхсторонний merge; updater здесь не менялся. Перед будущим обновлением требуется
сверить SHA установленного файла и канона, сохранить private backup, проверить literal
material и отдельно рассмотреть upstream diff. Автоматически устанавливать этот snapshot
или запускать update.sh в рамках версионирования не требуется.

## Сравнение и обновление

`main.ts` — исполняемый host artifact, отдельно от пользовательских Edge Functions.
`make deploy` его не устанавливает: gateway распаковывает только `supabase/functions/`.
Изменение router требует отдельного разрешённого операторского выпуска; обновление стека
через `update.sh` также не заменяет review итогового трёхстороннего merge.

Перед обновлением оператор:

1. Фиксирует SHA релизного коммита, версию image и SHA256 установленного файла.
   Сверяет `shasum -a 256 deploy/server/edge-runtime/main.ts` с `sudo sha256sum
   /srv/swarm/supabase/volumes/functions/main/index.ts` на сервере. Неожиданное отличие —
   остановка и review diff; не перезаписывать чужие изменения.
2. Сохраняет установленный файл в private backup вне git, с ограниченными правами.
   При vendor upgrade сохраняет точный upstream ref и лицензию; отдельно рассматривает
   diff с каноном. Изменение CPU/timeouts/auth/env не является частью механического sync.
3. Проверяет итоговый artifact в той же версии host runtime (команда в [CHECKS.md](CHECKS.md)),
   проверяет активность и выполняет согласованный rollout. Для установки — временный
   файл в том же каталоге, сравнение SHA256, сохранение владельца/режима исходного файла,
   атомарный rename и штатный restart functions. При неуспешном smoke возвращает backup
   и повторяет restart. Не запускать bootstrap и не менять env/права шлюза.
4. Повторно сверяет установленный SHA и выполняет `make smoke-prod`. Обновляет snapshot,
   provenance и подтверждения в этом каталоге тем же PR, сохраняя байты финального файла.

Установка/restart не требуются для добавления уже установленного snapshot в git и
в рамках этой пачки не выполнялись. Проверка через `bundle` не запускает новый сервер.

## Проверки и ограничения

- SHA копии совпал с private snapshot и повторно прочитанным installed hash.
- Gitleaks: 0 findings; TypeScript AST parse: 0 errors.
- Host `edge-runtime bundle` и публичный smoke описаны в [CHECKS.md](CHECKS.md).
- **Standalone `deno check` — RED, 12 diagnostics.** Подложные SDK declarations,
  ignores и изменения байтов ради зелёного результата не добавлялись.

#1000 остаётся открытым: текущие retained логи начинаются после пересоздания
контейнеров 06.11 и не покрывают семь эпизодов 14–17.10. Текущий ноль совпадений по
resource/CPU/memory/546 не доказывает причину исторических HTTP 546. Код опроса вызывает
meeting-calendar; HTTP 546 соответствует WorkerRequestCancelled/WorkerResourceLimit,
но сам статус не отличает CPU от остальных причин. Calendar не имеет отдельного CPU
override в snapshot; численные host defaults и историческая корреляция нагрузки
не установлены. Лимиты не повышались, новые встречи не создавались.
