// Internal durable queue drain. pg_cron invokes this only when a signal is due.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchScribaSignals, signalAuthorized } from "../_shared/scriba-signals.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
Deno.serve(async (req) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false }), { status: 405, headers });
  if (!await signalAuthorized(req, Deno.env.get("SCRIBA_SIGNAL_SECRET") ?? "")) {
    return new Response(JSON.stringify({ ok: false }), { status: 401, headers });
  }
  try {
    const result = await dispatchScribaSignals(db);
    return new Response(JSON.stringify({ ok: true, ...result }), { headers });
  } catch {
    console.error("scriba-dispatch: queue drain failed; leases will retry");
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers });
  }
});
