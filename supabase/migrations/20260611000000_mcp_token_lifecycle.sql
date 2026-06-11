-- MCP token lifecycle: expiry + revocation
-- Раньше токены были вечными и без явного отзыва. Добавляем срок жизни
-- (по умолчанию 90 дней) и функцию отзыва, чтобы при выходе коннектора
-- в орг-список доступ можно было выдавать и закрывать предсказуемо.

ALTER TABLE allowed_users
  ADD COLUMN IF NOT EXISTS claude_mcp_token_expires_at timestamptz;

-- generate_mcp_token теперь проставляет срок жизни (90 дней).
-- Сигнатура (bigint) не меняется — CREATE OR REPLACE чисто перезаписывает тело.
CREATE OR REPLACE FUNCTION generate_mcp_token(p_telegram_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token text;
BEGIN
  v_token := 'smcp_' || gen_random_uuid()::text;
  UPDATE allowed_users
    SET claude_mcp_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        claude_mcp_token_expires_at = now() + interval '90 days'
    WHERE telegram_id = p_telegram_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % not found in allowed_users', p_telegram_id;
  END IF;
  RETURN v_token;
END;
$$;

-- Отзыв: гасит хэш и срок — токен перестаёт работать немедленно.
CREATE OR REPLACE FUNCTION revoke_mcp_token(p_telegram_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE allowed_users
    SET claude_mcp_token_hash = NULL,
        claude_mcp_token_expires_at = NULL
    WHERE telegram_id = p_telegram_id;
$$;

CREATE OR REPLACE FUNCTION revoke_mcp_token(p_telegram_id integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT revoke_mcp_token(p_telegram_id::bigint);
$$;
