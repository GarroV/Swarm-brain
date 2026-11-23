import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveServiceAgent } from "../_shared/agent-auth.ts";
import { handleUploadRecovery } from "./handle.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
Deno.serve((req) =>
  handleUploadRecovery(req, {
    identify: (r) => resolveServiceAgent(db, r),
    secret: Deno.env.get("WEB_JWT_SECRET") ?? "",
    async lookup(agent, person, meetingId) {
      const user = await db.from("allowed_users").select("telegram_id").eq("telegram_id", person).eq(
        "group_id",
        agent.groupId,
      ).maybeSingle();
      if (user.error) throw new Error(user.error.message);
      if (!user.data) return null;
      const found = await db.from("meeting_agent_grants").select("id,agent_id,group_id,telegram_id,meeting_id")
        .eq("agent_id", agent.agentId).eq("group_id", agent.groupId).eq("telegram_id", person)
        .eq("meeting_id", meetingId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (found.error) throw new Error(found.error.message);
      const g = found.data;
      return g
        ? {
          grantId: g.id,
          agentId: g.agent_id,
          groupId: g.group_id,
          telegramId: g.telegram_id,
          meetingId: g.meeting_id,
        }
        : null;
    },
  })
);
