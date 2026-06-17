-- Отдельный токен для рекордера встреч (desktop-agent), независимый от claude_mcp_token (/mytoken).
-- Перевыпуск MCP-токена в Claude Desktop больше не ломает авторизацию рекордера.
-- agent-auth принимает любой из двух (claude_mcp_token_hash | recorder_token_hash).
ALTER TABLE allowed_users
  ADD COLUMN IF NOT EXISTS recorder_token_hash text,
  ADD COLUMN IF NOT EXISTS recorder_token_expires_at timestamptz;
