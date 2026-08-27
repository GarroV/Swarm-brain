-- Закрытие дыры: публичный anon-ключ мог выпустить/отозвать MCP-токен на любого пользователя.
--
-- Найдено 26.08.2026 database-advisor'ом после раскатки (приватный advisory GHSA-vxrp-599j-46hv).
-- generate_mcp_token/revoke_mcp_token — SECURITY DEFINER, а EXECUTE висел на PUBLIC (роли anon и
-- authenticated наследуют оттуда). Значит через публичный REST /rest/v1/rpc/... с anon-ключом,
-- который лежит во фронтенде, кто угодно мог:
--   * generate_mcp_token(<чужой telegram_id>) → валидный smcp_-токен → доступ к базе от имени
--     жертвы, включая её приватные записи (полный обход MCP_AUTH_REQUIRED);
--   * revoke_mcp_token(<чужой telegram_id>) → гашение чужого токена (DoS + выбитый Claude Desktop).
--
-- Приложение эти SQL-функции НЕ вызывает: токен минтится в коде (_shared/mcp-token.ts) под
-- service_role. Функции — legacy-инструмент для ручного вызова из SQL Editor (сессия под postgres).
-- Поэтому доступ оставляем только service_role; anon/authenticated/PUBLIC — закрываем.
--
-- Правка ПРАВ, схему функций не трогаем. Закрепляем миграцией, потому что будущий
-- `create or replace function` сбросил бы гранты к дефолту (PUBLIC) и вернул дыру.
-- Идемпотентно: REVOKE/GRANT повторяемы.

REVOKE EXECUTE ON FUNCTION
  public.generate_mcp_token(bigint), public.generate_mcp_token(integer),
  public.revoke_mcp_token(bigint),   public.revoke_mcp_token(integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.generate_mcp_token(bigint), public.generate_mcp_token(integer),
  public.revoke_mcp_token(bigint),   public.revoke_mcp_token(integer)
  TO service_role;
