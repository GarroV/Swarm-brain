-- Доступ MCP (#1083, #1082): срок токена 30 дней, отзыв триггером, журнал изменяющих вызовов.
--
-- 1. Срок. Выпуск теперь пишет expires_at = now()+30 дней (_shared/mcp-token.ts); swarm-mcp
--    сверяет срок на каждый вызов и строку без срока считает негодной. Живые токены, выпущенные
--    бессрочными, получают срок 30 дней от этой миграции — никого не отрезаем в момент раскатки.
-- 2. Отзыв. Токен гаснет сам, когда человека перевели в другое пространство или поменяли роль
--    (is_admin): хэш обнуляется в той же транзакции. Удаление из allowed_users убирает строку
--    вместе с хэшем. Отдельного флага «отключён» в таблице нет.
-- 3. Журнал. Дописываемая таблица вызовов write/destructive: без аргументов и без токена.

-- 1. Срок живых токенов.
UPDATE public.allowed_users
   SET claude_mcp_token_expires_at = now() + interval '30 days'
 WHERE claude_mcp_token_hash IS NOT NULL
   AND claude_mcp_token_expires_at IS NULL;

-- 2. Триггер отзыва. Не гасит токен, если тот же UPDATE выпускает новый (хэш меняется).
CREATE OR REPLACE FUNCTION public.revoke_mcp_token_on_access_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.claude_mcp_token_hash IS NOT NULL
     AND NEW.claude_mcp_token_hash IS NOT DISTINCT FROM OLD.claude_mcp_token_hash
     AND (NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.is_admin IS DISTINCT FROM OLD.is_admin) THEN
    NEW.claude_mcp_token_hash := NULL;
    NEW.claude_mcp_token_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Урок GHSA-vxrp: функции по умолчанию исполняемы для PUBLIC. Триггерную не вызвать как RPC,
-- но права закрываем явно, а не полагаемся на это.
REVOKE EXECUTE ON FUNCTION public.revoke_mcp_token_on_access_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_mcp_token_on_access_change() TO service_role;

DROP TRIGGER IF EXISTS allowed_users_revoke_mcp_token ON public.allowed_users;
CREATE TRIGGER allowed_users_revoke_mcp_token
  BEFORE UPDATE OF group_id, is_admin ON public.allowed_users
  FOR EACH ROW EXECUTE FUNCTION public.revoke_mcp_token_on_access_change();

-- 3. Журнал изменяющих вызовов.
CREATE TABLE IF NOT EXISTS public.mcp_tool_journal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  telegram_id bigint NOT NULL,
  tool text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'refused', 'error')),
  -- Последние символы sha256-хэша токена: отличить ключи друг от друга, не восстановив ни один.
  token_hint text
);
CREATE INDEX IF NOT EXISTS mcp_tool_journal_user_ts ON public.mcp_tool_journal (telegram_id, ts DESC);

-- Только дописывается: правка и удаление строк журнала запрещены даже service_role.
CREATE OR REPLACE FUNCTION public.mcp_tool_journal_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'mcp_tool_journal is append-only';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mcp_tool_journal_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_tool_journal_append_only() TO service_role;

DROP TRIGGER IF EXISTS mcp_tool_journal_no_change ON public.mcp_tool_journal;
CREATE TRIGGER mcp_tool_journal_no_change
  BEFORE UPDATE OR DELETE ON public.mcp_tool_journal
  FOR EACH ROW EXECUTE FUNCTION public.mcp_tool_journal_append_only();

-- Внешний замок, как у всех таблиц public: RLS без политик, пишут только функции (service_role).
ALTER TABLE public.mcp_tool_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_tool_journal FROM anon, authenticated;
