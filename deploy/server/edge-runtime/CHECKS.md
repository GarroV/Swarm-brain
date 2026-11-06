# Проверки host artifact и граница standalone TypeScript

Команда: `deno check --no-lock --no-config deploy/server/edge-runtime/main.ts`.
Фактический exit code: **1**. Diagnostics: **12**. Это не зелёный standalone typecheck.

1. TS2339: `Deno.errors.InvalidWorkerCreation` отсутствует в типах CLI.
2. TS2339: `Deno.errors.WorkerRequestCancelled` отсутствует в типах CLI.
3. TS2339: `Deno.errors.WorkerRequestIdleTimeout` отсутствует в типах CLI.
4. TS2339: `Deno.errors.InvalidWorkerResponse` отсутствует в типах CLI.
5. TS18046: `e` имеет тип `unknown`.
6. TS2339: `Deno.errors.WorkerAlreadyRetired` отсутствует в типах CLI.
7. TS2339: `Deno.errors.InvalidWorkerResponse` отсутствует в типах CLI (ещё одно место).
8. TS7053: строковый индекс не допускается для выведенного типа объекта envVarsObj
   `{ SUPABASE_FUNCTION_SLUG: string }`.
9. TS2304: `EdgeRuntime` не найден.
10. TS2304: `EdgeRuntime` не найден (ещё одно место).
11. TS2339: `Deno.errors.WorkerAlreadyRetired` отсутствует в типах CLI (ещё одно место).
12. TS2304: `EdgeRuntime` не найден (ещё одно место).

Файл выполняется в host runtime Supabase. Нельзя свести все сообщения к отсутствующему
SDK и объявить результат зелёным: есть также env-index/narrowing diagnostics. Snapshot
не изменялся; подложные SDK-типы и подавления не добавлялись.

## Host bundling

Установленный image: `supabase/edge-runtime:v1.76.2`; его CLI сообщает
`edge-runtime 0.1.0`, `deno 2.1.4 (release, x86_64-unknown-linux-gnu)`.
Доступные подкоманды: start, bundle, unbundle, help. TypeScript `check` отсутствует.

Проверка существующего mounted artifact, без start/restart, изменения source/settings
и без выходного файла в production:

```bash
ssh contabo 'sudo docker exec supabase-edge-functions edge-runtime bundle --entrypoint /home/deno/functions/main/index.ts --output /dev/null --disable-module-cache --timeout 30'
```

Фактический результат 06.11.2026: **host bundle exit 0, SSH exit 0**, без diagnostics.
Отключён module cache; результат уходит в `/dev/null`. Это проверка host bundling
(разбор, resolution и eszip), **не TypeScript typecheck и не полный runtime flow**.
Зелёный bundle не устраняет 12 diagnostics выше: host globals отсутствуют в standalone
CLI, но также остаются env-index/narrowing diagnostics неизменённого vendor artifact.
Не использовать этот файл как обычную application Edge Function.

06.11.2026 installed SHA256 совпал с snapshot:
`aa7dbdc83d915797ed92600bc0f7c500d6f6203361edc92b61716d19a7382f07`.
`make smoke-prod` на текущем публичном self-hosted API завершился exit 0:
public version 200, fake-token current 401, unauthenticated MCP JSON-RPC -32001.
Проверки не создают встреч и не отправляют уведомлений.

