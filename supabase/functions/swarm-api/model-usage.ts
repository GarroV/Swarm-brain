// GET /admin/model-usage?from=YYYY-MM-DD&to=YYYY-MM-DD — расход OpenAI для админки (issue #311). Только
// суперадмин: в сводке деньги всей системы, а не одного воркспейса. Строки пишет
// _shared/model-usage.ts, сводку считает _shared/model-usage-summary.ts.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import {
  inPeriod,
  MAX_PERIOD_DAYS,
  parsePeriod,
  summarizeUsage,
  type UsageRow,
} from "../_shared/model-usage-summary.ts";

export const MODEL_USAGE_PATH = "/admin/model-usage";
const PAGE = 1000;
const MAX_ROWS = 50_000;
// Сколько id встреч за раз в `in(...)`: длинный список упирается в длину URL PostgREST.
const TITLE_BATCH = 200;

async function loadRows(
  supabase: SupabaseClient,
  since: string,
  until: string,
): Promise<{ rows: UsageRow[]; truncated: boolean }> {
  const rows: UsageRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase.from("model_usage")
      .select("created_at, kind, model, purpose, meeting_id, prompt_tokens, completion_tokens, audio_seconds, cost_usd")
      .gte("created_at", since).lt("created_at", until).order("created_at", { ascending: true }).range(
        from,
        from + PAGE - 1,
      );
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
  const q = new URL(req.url).searchParams;
  // `?days=N` — старый веб (#311), пока не пересобран после раскатки функции; потом можно убрать.
  const legacyDays = Number(q.get("days"));
  const legacyFrom = q.get("from") === null && legacyDays > 0
    ? new Date(Date.now() - (Math.min(legacyDays, MAX_PERIOD_DAYS) - 1) * 86_400_000).toISOString().slice(0, 10)
    : null;
  const period = legacyFrom === null
    ? parsePeriod(q.get("from"), q.get("to"))
    : parsePeriod(legacyFrom, new Date().toISOString().slice(0, 10));
  if (typeof period === "string") return apiErr(400, period, origin);
  try {
    const { rows, truncated } = await loadRows(supabase, period.since, period.until);
    const summary = summarizeUsage(rows.filter((r) => inPeriod(r.created_at, period)));
    // Названия всех встреч периода: веб фильтрует и считает «самые дорогие» сам (#822).
    const ids = [...new Set(summary.cells.map((c) => c.meeting_id).filter((id): id is string => id !== null))];
    const titles = new Map<string, string | null>();
    for (let i = 0; i < ids.length; i += TITLE_BATCH) {
      const { data, error } = await supabase.from("meetings").select("id, title").in(
        "id",
        ids.slice(i, i + TITLE_BATCH),
      );
      if (error) throw new Error(`meetings: ${error.message}`);
      for (const m of (data ?? []) as Array<{ id: string; title: string | null }>) titles.set(m.id, m.title);
    }
    return json(
      {
        from: period.from,
        to: period.to,
        truncated,
        ...summary,
        top_meetings: summary.top_meetings.map((m) => ({ ...m, title: titles.get(m.meeting_id) ?? null })),
        meeting_titles: Object.fromEntries(titles),
      },
      200,
      origin,
    );
  } catch (e) {
    return serverError(origin, "model usage", e);
  }
}
