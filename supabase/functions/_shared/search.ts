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
  /** @deprecated — RRF ранжирует, порог по косинусу больше не применяется (принимаем для совместимости). */
  threshold?: number;
  limit?: number;
  /** Restrict to a single entry source (e.g. "note", "link"). */
  source?: string | null;
  /** Текст запроса → включает лексический (full-text) сигнал в гибриде. Без него — чистая семантика. */
  queryText?: string | null;
  /** ISO-код страны из запроса → буст записей с этим тегом (линза, не жёсткий фильтр). */
  country?: string | null;
  /** ISO-дата (YYYY-MM-DD): ЖЁСТКИЙ фильтр свежести для временных запросов («за 2 недели») —
   * кандидаты набираются только из окна, иначе свежие записи не попадают в top-N (issue #17). */
  since?: string | null;
};

/**
 * Гибридный поиск по `entries` через RPC `match_entries_hybrid`:
 *   • семантика (pgvector cosine) — всегда;
 *   • full-text (русский tsvector) — если передан `queryText`;
 *   • сливаются через RRF; буст по стране (`country`) и свежести (entry_date).
 * Без `queryText` ведёт себя как прежняя чистая семантика (обратная совместимость).
 *
 * Единый источник для трёх вещей, которые раньше расходились по swarm-bot/mcp/api:
 *   1. формат pgvector-литерала (`[a,b,c]`, НЕ JS-массив);
 *   2. воркспейс-изоляция + фильтр источника — теперь ВНУТРИ RPC (не внешним `.eq`,
 *      иначе пул кандидатов мог недобираться и терять целевой воркспейс);
 *   3. приватность (`requesting_user_id`).
 *
 * Бросает при ошибке RPC — вызывающий решает, как показать.
 */
export async function matchEntries(
  supabase: SupabaseClient,
  embedding: number[],
  { groupId = null, requestingUserId = null, limit = 15, source = null, queryText = null, country = null, since = null }: MatchOptions = {},
): Promise<MatchedEntry[]> {
  const { data, error } = await supabase.rpc("match_entries_hybrid", {
    query_embedding: `[${embedding.join(",")}]`,
    query_text: queryText ?? null,
    match_count: limit,
    requesting_user_id: requestingUserId ?? null,
    filter_group_id: groupId ?? null,
    filter_country: country ?? null,
    filter_source: source ?? null,
    filter_since: since ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as MatchedEntry[];
}
