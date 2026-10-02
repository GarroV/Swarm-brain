// GET /admin/model-usage?days=7|30|90 — расход OpenAI для админки (issue #311). Только
// суперадмин: в сводке деньги всей системы, а не одного воркспейса. Строки пишет
// _shared/model-usage.ts, сводку считает _shared/model-usage-summary.ts.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { summarizeUsage, type UsageRow } from "../_shared/model-usage-summary.ts";

export const MODEL_USAGE_PATH = "/admin/model-usage";
const PERIODS = [7, 30, 90];
const PAGE = 1000;
const MAX_ROWS = 50_000;

async function loadRows(supabase: SupabaseClient, since: string): Promise<{ rows: UsageRow[]; truncated: boolean }> {
  const rows: UsageRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase.from("model_usage")
      .select("created_at, kind, model, purpose, meeting_id, prompt_tokens, completion_tokens, audio_seconds, cost_usd")
      .gte("created_at", since).order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`model_usage: ${error.message}`);
    rows.push(...(data as UsageRow[]));
    if ((data ?? []).length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export async function handleModelUsageRoutes(
  req: Request,
  routePath: string,
  supabase: SupabaseClient,
  isSuperadmin: boolean,
  origin: string,
): Promise<Response | null> {
  if (req.method !== "GET" || routePath !== MODEL_USAGE_PATH) return null;
  if (!isSuperadmin) return apiErr(403, "Forbidden", origin);
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  if (!PERIODS.includes(days)) return apiErr(400, `days must be one of ${PERIODS.join(", ")}`, origin);
  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { rows, truncated } = await loadRows(supabase, since);
    const summary = summarizeUsage(rows);
    const ids = summary.top_meetings.map((m) => m.meeting_id);
    const titles = new Map<string, string | null>();
    if (ids.length > 0) {
      const { data, error } = await supabase.from("meetings").select("id, title").in("id", ids);
      if (error) throw new Error(`meetings: ${error.message}`);
      for (const m of (data ?? []) as Array<{ id: string; title: string | null }>) titles.set(m.id, m.title);
    }
    return json(
      {
        days,
        since,
        truncated,
        ...summary,
        top_meetings: summary.top_meetings.map((m) => ({ ...m, title: titles.get(m.meeting_id) ?? null })),
      },
      200,
      origin,
    );
  } catch (e) {
    return serverError(origin, "model usage", e);
  }
}
