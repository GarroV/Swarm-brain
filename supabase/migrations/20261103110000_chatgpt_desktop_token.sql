-- Independent personal credential for the ChatGPT desktop stdio bridge.
ALTER TABLE public.allowed_users
  ADD COLUMN IF NOT EXISTS chatgpt_mcp_token_hash text,
  ADD COLUMN IF NOT EXISTS chatgpt_mcp_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS chatgpt_mcp_last_seen_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS allowed_users_chatgpt_mcp_hash
  ON public.allowed_users(chatgpt_mcp_token_hash) WHERE chatgpt_mcp_token_hash IS NOT NULL;
CREATE OR REPLACE FUNCTION public.revoke_chatgpt_mcp_on_access_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    NEW.chatgpt_mcp_token_hash := NULL;
    NEW.chatgpt_mcp_token_expires_at := NULL;
    NEW.chatgpt_mcp_last_seen_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_chatgpt_mcp_on_access_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_chatgpt_mcp_on_access_change() TO service_role;
DROP TRIGGER IF EXISTS allowed_users_revoke_chatgpt_mcp ON public.allowed_users;
CREATE TRIGGER allowed_users_revoke_chatgpt_mcp
  BEFORE UPDATE OF group_id,is_admin ON public.allowed_users
  FOR EACH ROW EXECUTE FUNCTION public.revoke_chatgpt_mcp_on_access_change();
