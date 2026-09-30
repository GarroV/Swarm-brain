// Запись для выгрузки файлом (ИИ-инструмент бота export_entry).
//
// Ищется только в воркспейсе зрителя и только среди видимых ему записей (личные — только
// свои). Полный текст — собственный текст записи; если запись разбита на части
// (`metadata.chunk_group_id`, так режет длинный текст swarm-mcp), к нему добираются части
// ЭТОЙ группы — с теми же фильтрами и с лимитом.
//
// Клиент передаётся параметром: модуль не тянет lib/supabase.ts и проверяется тестом без базы.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { visibilityFilter } from "./visibility.ts";

// Потолок частей одной записи: swarm-mcp режет текст на десятки частей, не на тысячи.
const MAX_CHUNKS = 200;

export type ExportEntry = {
  content: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  source: string | null;
  created_at: string;
};

export async function loadEntryForExport(
  supabase: SupabaseClient,
  entryId: string,
  { groupId, userId }: { groupId: string; userId: number },
): Promise<{ entry: ExportEntry; fullContent: string } | null> {
  const { data } = await supabase
    .from("entries")
    .select("content, summary, metadata, source, created_at")
    .eq("id", entryId)
    .eq("group_id", groupId)
    .or(visibilityFilter(userId))
    .maybeSingle();
  if (!data) return null;
  const entry = data as ExportEntry;

  const content = entry.content ?? "";
  // Тезисы длиннее текста — берём их (полные тезисы встречи).
  let fullContent = entry.summary && entry.summary.length > content.length ? entry.summary : content;

  const chunkGroup = entry.metadata?.chunk_group_id;
  if (!entry.summary && typeof chunkGroup === "string" && chunkGroup) {
    const { data: chunks } = await supabase
      .from("entries")
      .select("content, metadata")
      .eq("group_id", groupId)
      .eq("metadata->>chunk_group_id", chunkGroup)
      .or(visibilityFilter(userId))
      .order("created_at", { ascending: true })
      .limit(MAX_CHUNKS);
    const parts = (chunks ?? []) as Array<{ content: string; metadata: Record<string, unknown> | null }>;
    if (parts.length) {
      fullContent = [...parts]
        .sort((a, b) => ((a.metadata?.chunk as number) ?? 0) - ((b.metadata?.chunk as number) ?? 0))
        .map((c) => c.content)
        .join("\n");
    }
  }
  return { entry, fullContent };
}
