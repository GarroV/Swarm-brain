# swarm-mcp — Аутентификация через токен

> Статус: **выполнено** (2026-05-31, ветка `sandbox_vas`).

---

## Как работает

Каждому пользователю выдаётся персональный токен формата `smcp_<uuid>`.  
В базе хранится **только sha256-хеш** токена — утечка БД не даёт рабочий токен.  
Токен передаётся в заголовке `Authorization: Bearer <token>` с каждым запросом от Claude Desktop.

**Проверка (одна точка, `swarm-mcp/index.ts`, сразу после разбора тела):**
1. Читаем заголовок `Authorization`
2. Если `Bearer <token>` — вычисляем sha256(token) в hex (Web Crypto API)
3. Ищем в `allowed_users.claude_mcp_token_hash`
4. Нашли → `verifiedTelegramId` = telegram_id из строки
5. Не нашли → ошибка JSON-RPC -32001 Unauthorized
6. Нет заголовка + `MCP_AUTH_REQUIRED=true` → ошибка -32001
7. `verifiedTelegramId` инжектируется в `args.requesting_user_id` перед вызовом инструментов — значение из тела запроса игнорируется

**Режимы через переменную окружения `MCP_AUTH_REQUIRED`:**

| Значение | Поведение |
|----------|-----------|
| не задан / `false` (мягкий) | нет заголовка → работает по-старому; есть заголовок → проверяется |
| `true` (жёсткий) | нет валидного токена → всегда ошибка |

---

## Схема БД

Колонка `allowed_users.claude_mcp_token_hash TEXT` (nullable).  
Индекс `allowed_users_mcp_token_hash_idx` на ненулевых значениях.

**Выдача токена (SQL, выполняется вручную):**
```sql
SELECT generate_mcp_token(744230399);
-- Показывает токен один раз. Затем в БД только хеш.
```

**Отзыв токена:**
```sql
UPDATE allowed_users SET claude_mcp_token_hash = NULL WHERE telegram_id = <id>;
```

---

## Что не делает система

- Нет ротации / срока жизни токенов
- Нет команды `/superadmin` для выдачи (вручную через SQL)
- Нет нескольких токенов на пользователя

---

## Ручные шаги для активации

**a) Выдать токен:**
```sql
SELECT generate_mcp_token(744230399);
```
Скопировать результат — он показывается **один раз**.

**b) Прописать в Claude Desktop:**  
В настройках подключения swarm-mcp добавить заголовок:
```
Authorization: Bearer <token из шага a>
```

**c) Проверить мягкий режим:**  
Claude Desktop должен получать данные как раньше. Без токена тоже работает (мягкий режим).

**d) Включить жёсткий режим:**
```bash
supabase secrets set MCP_AUTH_REQUIRED=true
supabase functions deploy swarm-mcp --no-verify-jwt
```

**e) Финальная проверка:**
- Запрос без токена → ошибка Unauthorized
- Запрос с токеном → данные работают
- Дыра закрыта.
