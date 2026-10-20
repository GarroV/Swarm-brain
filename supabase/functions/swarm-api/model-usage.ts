// GET /admin/model-usage?from=YYYY-MM-DD&to=YYYY-MM-DD[&workspace=ID] — расход OpenAI для админки
// (issue #311). Объём (#233): мастер-админ — вся система или одно пространство (`workspace`);
// админ пространства — только своё (чужое пространство — 404, как у остальных маршрутов
// пространства); остальным — 403. Строки пишет _shared/model-usage.ts, сводку считает
// _shared/model-usage-summary.ts.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { onlyLiveEntries } from "../_shared/entries/live.ts";
import { canViewEntry, type EntryAccessRow } from "../_shared/entries/access.ts";
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
  groupId: string | null,
): Promise<{ rows: UsageRow[]; truncated: boolean }> {
  const rows: UsageRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let query = supabase.from("model_usage")
      .select("created_at, kind, model, purpose, meeting_id, prompt_tokens, completion_tokens, audio_seconds, cost_usd")
      .gte("created_at", since).lt("created_at", until);
    if (groupId !== null) query = query.eq("group_id", groupId);
    const { data, error } = await query.order("created_at", { ascending: true }).range(
      from,
      from + PAGE - 1,
    );
    if (error) throw new Error(`model_usage: ${error.message}`);
    rows.push(...(data as UsageRow[]));
    if ((data ?? []).length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export type UsageScope = { isMaster: boolean; isAdmin: boolean; groupId: string; telegramId: number };

/** Чьи строки читать: null — все (мастер без фильтра); строка — одно пространство; Response — отказ. */
function usageGroup(scope: UsageScope, requested: string | null, origin: string): string | null | Response {
  if (scope.isMaster) return requested || null;
  if (!scope.isAdmin) return apiErr(403, "Forbidden", origin);
  if (!scope.groupId || (requested && requested !== scope.groupId)) {
    return apiErr(404, "Workspace not found", origin);
  }
  return scope.groupId;
}

type MeetingRow = {
  id: string;
  title: string | null;
  entry_id: string | null;
  claim_owner: number | string | null;
  recorders: Array<{ telegram_id?: number | string }> | null;
};
type EntryRow = EntryAccessRow & { id: string };

/**
 * Названия встреч, которые зритель вправе видеть. Расход (суммы) показывается всем админам по
 * объёму, а НАЗВАНИЕ встречи — содержание: личная встреча видна только владельцу и тем, с кем
 * разделена, без админского обхода (решение владельца 2026-08-07, #15). Правило — `canViewEntry`.
 * Опубликованная встреча — по своей записи; черновик (записи ещё нет) — только тому, кто записывал
 * или транскрибирует. Не прошла проверка или записи не нашли — `null` (fail-closed); строки расхода остаются.
 */
async function visibleTitles(
  supabase: SupabaseClient,
  ids: string[],
  viewerId: number,
): Promise<Map<string, string | null>> {
  const titles = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += TITLE_BATCH) {
    const batch = ids.slice(i, i + TITLE_BATCH);
    const { data, error } = await supabase.from("meetings")
      .select("id, title, entry_id, claim_owner, recorders").in("id", batch);
    if (error) throw new Error(`meetings: ${error.message}`);
    const meetings = (data ?? []) as MeetingRow[];
    const entryIds = [...new Set(meetings.map((m) => m.entry_id).filter((e): e is string => !!e))];
    const entries = new Map<string, EntryRow>();
    if (entryIds.length > 0) {
      // Архивная запись невидима везде (#569): названия её встречи тоже нет.
      const { data: ed, error: ee } = await onlyLiveEntries(
        supabase.from("entries").select("id, is_private, owner_id, shared_with"),
      ).in("id", entryIds);
      if (ee) throw new Error(`entries: ${ee.message}`);
      for (const e of (ed ?? []) as EntryRow[]) entries.set(e.id, e);
    }
    for (const m of meetings) {
      let visible: boolean;
      if (m.entry_id) {
        const entry = entries.get(m.entry_id);
        visible = !!entry && canViewEntry(entry, viewerId);
      } else {
        visible = Number(m.claim_owner) === viewerId ||
          (m.recorders ?? []).some((r) => Number(r.telegram_id) === viewerId);
      }
      titles.set(m.id, visible ? m.title : null);
    }
  }
  return titles;
}

export async function handleModelUsageRoutes(
  req: Request,
  routePath: string,
  supabase: SupabaseClient,
  scope: UsageScope,
  origin: string,
): Promise<Response | null> {
  if (req.method !== "GET" || routePath !== MODEL_USAGE_PATH) return null;
  const q = new URL(req.url).searchParams;
  const groupId = usageGroup(scope, q.get("workspace"), origin);
  if (groupId instanceof Response) return groupId;
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
    const { rows, truncated } = await loadRows(supabase, period.since, period.until, groupId);
    const summary = summarizeUsage(rows.filter((r) => inPeriod(r.created_at, period)));
    // Названия всех встреч периода: веб фильтрует и считает «самые дорогие» сам (#822).
    const ids = [...new Set(summary.cells.map((c) => c.meeting_id).filter((id): id is string => id !== null))];
    const titles = await visibleTitles(supabase, ids, scope.telegramId);
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
