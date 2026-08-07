import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntryRow = {
  id: string;
  content: string;
  summary: string | null;
  added_by: string;
  source: string;
  metadata: Record<string, unknown>;
  countries: string[];
  entry_type: string;
  entry_date: string | null;
  group_id: string | null;
  is_private: boolean;
  owner_id: number | null;
  created_at: string;
};

// ── Error ─────────────────────────────────────────────────────────────────────

export class EntryAccessError extends Error {
  constructor(public readonly status: 404 | 403, message: string) {
    super(message);
    this.name = "EntryAccessError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch a single entry with both security layers enforced:
 *
 *   Layer 1 — workspace isolation:  entry.group_id must match groupId
 *   Layer 2 — visibility:           private entries are invisible to non-owners
 *   Layer 3 — ownership (opt-in):   only the owner can mutate (DELETE / PATCH)
 *
 * Throws EntryAccessError(404) if the entry doesn't exist or access is denied.
 * Throws EntryAccessError(403) if requireOwner=true and the caller is not the owner.
 *
 * Both 404 cases are intentionally indistinguishable to callers — leaking
 * "entry exists but is private" would be a privacy violation.
 */
export async function getEntrySecure(
  supabase: SupabaseClient,
  id: string,
  {
    groupId,
    telegramId,
    requireOwner = false,
  }: { groupId: string; telegramId: number; requireOwner?: boolean },
): Promise<EntryRow> {
  const { data } = await supabase
    .from("entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // Layer 1: workspace isolation — ВСЕГДА (кросс-воркспейс доступа нет).
  if (!data || data.group_id !== groupId) {
    throw new EntryAccessError(404, "Not found");
  }

  // Приватность — БЕЗ admin-байпаса (решение владельца 2026-08-07): личная запись видна
  // ТОЛЬКО владельцу, даже админу/руководителю. Оверсайт-исключение оставлено лишь для ЗАДАЧ
  // (см. canViewTask в swarm-api), не для записей/встреч.
  // Layer 2: visibility — private entries invisible to non-owners
  if (data.is_private && data.owner_id !== telegramId) {
    throw new EntryAccessError(404, "Not found");
  }

  // Layer 3: ownership — for mutations (DELETE / PATCH)
  if (requireOwner && data.owner_id !== telegramId) {
    throw new EntryAccessError(403, "Forbidden");
  }

  return data as EntryRow;
}

/**
 * Start a list query against entries with both security filters pre-applied.
 *
 * ALWAYS use this instead of supabase.from("entries").select(...) directly
 * in list endpoints — it bakes in workspace isolation + visibility filter.
 *
 * Usage:
 *   const { data } = await buildEntriesQuery(supabase, "id, content, summary", { groupId, telegramId })
 *     .order("created_at", { ascending: false })
 *     .limit(50);
 */
export function buildEntriesQuery(
  supabase: SupabaseClient,
  select: string,
  { groupId, telegramId }: { groupId: string; telegramId: number },
) {
  return supabase
    .from("entries")
    .select(select)
    .eq("group_id", groupId)
    .or(`is_private.eq.false,and(is_private.eq.true,owner_id.eq.${telegramId})`);
}
