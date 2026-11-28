// Public Google webhook only persists a dirty marker. Internal maintenance performs bounded work
// on the VPS; it is not a bot polling endpoint and never returns credentials/calendar data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signalAuthorized } from "../_shared/scriba-signals.ts";
import { maintainCalendarPush } from "./worker.ts";
import { receiveCalendarNotification } from "./webhook.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  try {
    if (new URL(req.url).searchParams.get("action") === "maintain") {
      const secret = Deno.env.get("SCRIBA_SIGNAL_SECRET") ?? "";
      if (!await signalAuthorized(req, secret)) return json({ ok: false }, 401);
      const address = Deno.env.get("GOOGLE_CALENDAR_PUSH_URL") ?? "";
      if (!address) return json({ ok: false, error: "calendar_push_not_configured" }, 503);
      return json({ ok: true, ...await maintainCalendarPush(db, address) });
    }
    return await receiveCalendarNotification(req, {
      async channel(id) {
        const { data, error } = await db.from("calendar_watch_channels").select(
          "telegram_id,token,resource_id,state,expires_at",
        )
          .eq("id", id).maybeSingle();
        if (error) throw error;
        return data;
      },
      async dirty(person) {
        const result = await db.rpc("calendar_push_dirty", { p_person: person });
        if (result.error) throw result.error;
      },
    });
  } catch {
    console.error("calendar-push: durable operation failed");
    return json({ ok: false, error: "calendar_push_failed" }, 503);
  }
});
