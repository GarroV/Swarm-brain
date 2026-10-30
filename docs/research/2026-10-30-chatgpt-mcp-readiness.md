# Подготовка подключения ChatGPT: проверка на стенде

Дата: 30.10.2026. Ветка: `GarroV/g5-feedback`, база `33a2273f`.
Прод не менялся; push/main, продовые миграции и выкладка функций не выполнялись.
Граница владельца — [решение](../decisions/2026-10-30-chatgpt-mcp.md).
Контракт, маршрут пользователя и состав выкладки — [MCP OAuth](../MCP_OAUTH.md).

## Подготовлено

- Карточка ChatGPT в личных настройках сотрудника: браузерная инструкция, адрес,
  приложения, последнее обращение, ожидание первого запроса, собственный отзыв доступа.
- Экран согласия после обычного входа и второго шага, тексты RU/EN.
- Отдельная OAuth-выдача, обновление и отзыв доступа к существующим MCP-инструментам.
- Миграция, функция `swarm-oauth`, Pages-прокси discovery/OAuth, интеграция в API/MCP.
- Статический токен Claude сохраняет свой независимый путь.

## Удалённый стенд

MUSPELHEIM, `C:\projects\swarm-mcp-chatgpt-stand`. Синтетические сотрудники двух
пространств. Отдельная БД `swarm_mcp_chatgpt_20261030`, созданная из схемы общего
тестового контура без копирования его данных. Общая схема и прод не менялись.
Контейнеры `swarm-chatgpt-{gateway,api,oauth,mcp,rest}`; образы закреплены digest.
Внешних секретов моделей/ботов на этом стенде нет.

Открыть через SSH-forward:

```sh
ssh -N -L 18442:127.0.0.1:18442 muspelheim
```

Адрес: `http://localhost:18442/api/auth/login?next=%2F%3Fview%3Dsettings`.
Gateway имеет специальный синтетический вход, работает только в тестовом контуре и
не является продовым компонентом. Порт на сервере опубликован на loopback.

Секреты хранятся только вне source: remote `private/stand.env`, `private/rest.env`;
локальный файл для тестов — `~/Documents/workbench/private/swarm-mcp-chatgpt-stand/test.env`
с правами 0600. Значения не входят в git и отчёты.

### Повторить подготовку

Собрать веб `npm ci` и `npm run build` в `miniapp/`. Передать исходники и экспорт на
MUSPELHEIM (без `.git`, node_modules, `.next` и private):

```sh
COPYFILE_DISABLE=1 tar -czf /tmp/swarm-chatgpt-source.tgz --exclude=node_modules --exclude=.next --exclude='._*' \
  supabase miniapp/functions miniapp/src miniapp/out deno.json deno.lock scripts
ssh muspelheim 'if not exist C:\projects\swarm-mcp-chatgpt-stand\source mkdir C:\projects\swarm-mcp-chatgpt-stand\source'
scp /tmp/swarm-chatgpt-source.tgz muspelheim:C:/projects/swarm-mcp-chatgpt-stand/source.tgz
ssh muspelheim 'tar -xzf C:/projects/swarm-mcp-chatgpt-stand/source.tgz -C C:/projects/swarm-mcp-chatgpt-stand/source'
ssh muspelheim 'powershell -NoProfile -File C:/projects/swarm-mcp-chatgpt-stand/source/scripts/mcp-chatgpt-stand.ps1 -Action Prepare'
ssh muspelheim 'powershell -NoProfile -File C:/projects/swarm-mcp-chatgpt-stand/source/scripts/mcp-chatgpt-stand.ps1 -Action Start'
```

`Prepare` затрагивает только выделенную БД; `Start` — только выделенные контейнеры.
Не выполнять во время чужого прогона именно этого выделенного стенда.

## Проверки

| Проверка | Фактический результат |
|---|---|
| `npm run build` в `miniapp/` | Успешно, включая TypeScript |
| `npm test` в `miniapp/` | 640 passed, 0 failed |
| MCP, мост Claude и чистые OAuth-тесты (до последней доработки callback errors) | 187 passed, 0 failed |
| Чистый OAuth-набор после доработки callback errors | 10 passed, 0 failed |
| OAuth DB-suite против выделенной БД MUSPELHEIM | 7 passed, 0 failed |
| `./scripts/check fast` | Зелёный; объявленные штатные исключения остаются |
| Явный lint новых frontend/proxy/stand/smoke-файлов | Успешно |
| Wrangler Pages Functions build | Успешно; скомпилированный router содержит discovery и `/oauth/*` |
| SQL-права | anon не читает tokens и не вызывает exchange; service_role вызывает |
| Официальный MCP SDK на живом стенде | Discovery, consent, identity, чтение задач, refresh, отзыв, replay — успешно |
| Действующий тип статического токена Claude на живом стенде | Официальный SDK подключился и выполнил whoami; OAuth после выдачи статического токена продолжил работать |
| Chrome for Testing: личные настройки, согласие, ожидание и отзыв | Все три этапа прошли; desktop/mobile, светлая и тёмная темы просмотрены |

DB-suite проверяет неправильные PKCE/client/callback/resource, одноразовость согласия и
кода, конкурентный refresh и повтор, сроки, демо/короткие сессии, чужой отзыв,
смену роли/пространства и удаление сотрудника. Порча проверки scope в отдельной копии
сделала тест красным. Проверки CSRF и пропуска OAuth мимо SW воспроизвели ошибки до исправления.

Команды живого протокольного прогона и DB-suite:

```sh
deno run -A scripts/mcp-oauth-smoke.ts
deno test --env-file="$HOME/Documents/workbench/private/swarm-mcp-chatgpt-stand/test.env" \
  -A supabase/functions/swarm-oauth/oauth.db.test.ts
```

Браузерный прогон использует Chrome for Testing и только этот стенд:

```sh
SWARM_E2E_URL=http://localhost:18442/ \
MCP_QA_OUTPUT="$HOME/Documents/workbench/scratch/swarm-mcp-chatgpt-qa" \
node miniapp/e2e/mcp-oauth.mjs
```

Он проверяет личную карточку на desktop/mobile, экран согласия, callback,
ожидание первого обращения и отключение. Callback ChatGPT перехватывается внутри
теста: реальное приложение в аккаунте ChatGPT не создаётся. Снимки — в указанном каталоге.

## Проверка безопасности и ограничения

AITriage portable 1.13.0 запущен на MUSPELHEIM; официальный SHA256 проверен, системная
установка не менялась. Все четыре сканера готовы. Raw-сравнение baseline/candidate:
18 → 27 результатов; новых error нет. Девять новых ENTR-04 warning срабатывают на имя
ChatGPT в названиях/импортах/инструкции и вручную признаны ложными срабатываниями.
Это сырой скан с ручным разбором разницы, **не** полный вердикт SecureCoder.

Remote-запуск тестового Deno-контейнера встречал esm.sh HTTP 520 при скачивании зависимостей.
DB-suite фактически выполнен Deno на Mac против отдельной удалённой БД через туннель;
продуктовые процессы и база работали на MUSPELHEIM. Локальные продуктовые серверы и Docker
на Mac не запускались.

Официальный SDK и собственная браузерная часть проверены; реальное добавление сервера
через корпоративный интерфейс ChatGPT ещё требует совместной приёмки. Приватный
loopback-стенд недоступен облачному ChatGPT. Для такого прогона нужен согласованный
публичный HTTPS-адрес именно тестового контура и разрешение рабочего пространства.
Публикация такого адреса и создание подключения в аккаунте ChatGPT в этой подготовке
не выполнялись. Продовая раскатка остаётся отдельным действием с владельцем.
