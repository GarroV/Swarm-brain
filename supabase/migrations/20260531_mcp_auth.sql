-- MCP authentication: token hash per user
-- Stores sha256(token) hex — plaintext token never persisted

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE allowed_users
  ADD COLUMN IF NOT EXISTS claude_mcp_token_hash TEXT;

-- Faster lookup by hash on every request
CREATE INDEX IF NOT EXISTS allowed_users_mcp_token_hash_idx
  ON allowed_users(claude_mcp_token_hash)
  WHERE claude_mcp_token_hash IS NOT NULL;

-- Generates a fresh token, writes its sha256 hash, returns plaintext (shown once)
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
    SET claude_mcp_token_hash = encode(digest(v_token, 'sha256'), 'hex')
    WHERE telegram_id = p_telegram_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % not found in allowed_users', p_telegram_id;
  END IF;
  RETURN v_token;
END;
$$;
