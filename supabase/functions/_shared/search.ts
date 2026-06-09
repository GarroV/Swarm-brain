import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Shape returned by the match_entries RPC (must mirror its RETURNS TABLE).
export type MatchedEntry = {
  id: string;
  content: string;
  summary: string | null;
  source: string;
  metadata: Record<string, unknown>;
  countries: string[];
  entry_type: string;
  entry_date: string | null;
  group_id: string | null;
  similarity: number;
};

export type MatchOptions = {
  groupId?: string | null;
  requestingUserId?: number | null;
  threshold?: number;
  limit?: number;
  /** Restrict to a single entry source (e.g. "note", "link"). */
  source?: string;
};

/**
 * Semantic search over `entries` via the `match_entries` RPC.
 *
 * Single source of truth for three things that previously diverged across
 * swarm-bot, swarm-mcp and swarm-api — and whose drift silently broke search:
 *   1. the pgvector literal format (`[a,b,c]` string, NOT a JS array);
 *   2. the workspace-isolation filter (`.eq("group_id", …)`);
 *   3. the private-entry visibility rule (handled inside the RPC via
 *      `requesting_user_id`).
 *
 * Throws on RPC error so callers decide how to surface it.
 */
export async function matchEntries(
  supabase: SupabaseClient,
  embedding: number[],
  { groupId = null, requestingUserId = null, threshold = 0.3, limit = 15, source }: MatchOptions = {},
): Promise<MatchedEntry[]> {
  let query = supabase.rpc("match_entries", {
    query_embedding: `[${embedding.join(",")}]`,
    match_threshold: threshold,
    match_count: limit,
    requesting_user_id: requestingUserId ?? null,
  });
  if (groupId) query = query.eq("group_id", groupId);
  if (source) query = query.eq("source", source);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as MatchedEntry[];
}
