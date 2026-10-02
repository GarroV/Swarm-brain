-- Переезд веба на swarm-team.app (#753): все веб-сессии, выданные до этого момента, гасятся —
-- каждый входит заново уже на новом адресе. Механизм — «выйти везде» (allowed_users.sessions_revoked_at,
-- миграция 20260930210000): swarm-api отклоняет сессию, вход которой раньше отметки.
-- Токены рекордера и MCP не затрагиваются. Решение владельца 02.10.2026.
update public.allowed_users
set sessions_revoked_at = now()
where telegram_id is not null;
