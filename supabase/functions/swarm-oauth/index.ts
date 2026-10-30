// Public OAuth endpoints. Personal approval/revocation live behind swarm-api's existing
// session + second-step gate; this entry never accepts a browser session as authorization.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOAuthPublicRequest, oauthConfig } from "../_shared/mcp-oauth/index.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const config = oauthConfig();
Deno.serve((req) => handleOAuthPublicRequest(supabase, req, config));
