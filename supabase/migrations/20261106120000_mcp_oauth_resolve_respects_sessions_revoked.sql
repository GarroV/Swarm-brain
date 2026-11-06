-- «Выйти везде» (allowed_users.sessions_revoked_at) отключает и подключения нейросетей:
-- подключение, созданное раньше отметки отзыва, mcp_oauth_resolve не принимает.
-- Аддитивная правка тела функции; права прежние (только service_role).
CREATE OR REPLACE FUNCTION public.mcp_oauth_resolve(p_token_hash text,p_resource text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.mcp_oauth_connections;
BEGIN
  SELECT g.* INTO c FROM public.mcp_oauth_tokens t
    JOIN public.mcp_oauth_connections g ON g.id=t.connection_id
    JOIN public.allowed_users u ON u.telegram_id=g.telegram_id AND u.group_id=g.group_id
    WHERE t.token_hash=p_token_hash AND t.kind='access' AND t.expires_at>now()
      AND g.resource=p_resource AND g.scope IN ('mcp','mcp offline_access') AND g.expires_at>now() AND g.revoked_at IS NULL
      AND (u.sessions_revoked_at IS NULL OR g.created_at>u.sessions_revoked_at);
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.mcp_oauth_connections SET last_seen_at=now() WHERE id=c.id
    AND (last_seen_at IS NULL OR last_seen_at<now()-interval '1 minute') AND revoked_at IS NULL;
  RETURN jsonb_build_object('telegramId',c.telegram_id,'groupId',c.group_id,'connectionId',c.id);
END; $$;

REVOKE ALL ON FUNCTION public.mcp_oauth_resolve(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_resolve(text,text) TO service_role;
