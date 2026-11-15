// Read-only projection of the historical MCP 3000/200 UTF-16 storage format.
// No database or permission decisions live here: callers supply only visible, live rows.
export const LEGACY_KNOWLEDGE_LIMIT = 200;
export const LEGACY_KNOWLEDGE_COLUMNS =
  "id,content,summary,metadata,source,added_by,created_at,updated_at,group_id,visible_group_ids,owner_id,is_private,shared_with,countries,entry_type,entry_date";

export interface KnowledgeChunkRow {
  id?: string;
  content: string;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  added_by?: string | null;
  created_at?: string;
  updated_at?: string | null;
  group_id?: string | null;
  visible_group_ids?: string[] | null;
  owner_id?: number | null;
  is_private?: boolean;
  shared_with?: number[] | null;
  countries?: string[] | null;
  entry_type?: string | null;
  entry_date?: string | null;
}

type Marker = { group: string; chunk: number; total: number };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHUNK = 3000;
const OVERLAP = 200;
const STEP = CHUNK - OVERLAP;

export class KnowledgeChunkError extends Error {
  constructor(readonly reason: string) {
    super(`legacy_knowledge_${reason}`);
    this.name = "KnowledgeChunkError";
  }
}

export function knowledgeChunkMarker(row: KnowledgeChunkRow): Marker | null {
  const m = row.metadata;
  if (
    row.added_by !== "claude_desktop" || !m || typeof m.chunk_group_id !== "string" || !UUID_V4.test(m.chunk_group_id)
  ) {
    return null;
  }
  if (!("chunk" in m) || !("total_chunks" in m)) return null;
  if (
    typeof m.chunk !== "number" || !Number.isSafeInteger(m.chunk) ||
    typeof m.total_chunks !== "number" || !Number.isSafeInteger(m.total_chunks) ||
    m.total_chunks < 2 || m.chunk < 1 || m.chunk > m.total_chunks
  ) throw new KnowledgeChunkError("invalid_metadata");
  return { group: m.chunk_group_id, chunk: m.chunk, total: m.total_chunks };
}

const IDENTITY_FIELDS = [
  "source",
  "group_id",
  "visible_group_ids",
  "owner_id",
  "is_private",
  "shared_with",
  "countries",
  "entry_type",
  "entry_date",
] as const;

/** Restore only a complete, unchanged group. Never guess an overlap or overwrite stored rows. */
export function restoreKnowledgeGroup<T extends KnowledgeChunkRow>(
  selected: T,
  rows: T[],
): { head: T; content: string } {
  const wanted = knowledgeChunkMarker(selected);
  if (!wanted) throw new KnowledgeChunkError("not_mcp_group");
  if (wanted.total > LEGACY_KNOWLEDGE_LIMIT) throw new KnowledgeChunkError("limit");
  if (rows.length !== wanted.total) throw new KnowledgeChunkError("incomplete");
  const parts = rows.map((row) => {
    const marker = knowledgeChunkMarker(row);
    if (!marker || marker.group !== wanted.group || marker.total !== wanted.total) {
      throw new KnowledgeChunkError("mismatched_group");
    }
    if (
      Object.keys(row.metadata ?? {}).sort().join(",") !== "chunk,chunk_group_id,total_chunks" ||
      !row.created_at || !Number.isFinite(Date.parse(row.created_at)) || row.updated_at !== row.created_at
    ) throw new KnowledgeChunkError("modified");
    return { row, marker };
  }).sort((a, b) => a.marker.chunk - b.marker.chunk);
  const head = parts[0].row;
  if (!head.id || typeof head.summary !== "string") throw new KnowledgeChunkError("incomplete");
  const current = parts.find((p) => p.row.id === selected.id)?.row;
  if (!current || current.content !== selected.content || current.updated_at !== selected.updated_at) {
    throw new KnowledgeChunkError("modified");
  }
  for (const [i, { row, marker }] of parts.entries()) {
    if (marker.chunk !== i + 1) throw new KnowledgeChunkError("incomplete");
    for (const field of IDENTITY_FIELDS) {
      if (!(field in row) || !(field in head) || JSON.stringify(row[field]) !== JSON.stringify(head[field])) {
        throw new KnowledgeChunkError("mismatched_group");
      }
    }
    if (i > 0 && row.summary !== null) throw new KnowledgeChunkError("modified");
  }
  const lastLength = parts.at(-1)!.row.content.length;
  const length = (parts.length - 1) * STEP + lastLength;
  if (length <= CHUNK || lastLength < 1 || lastLength > STEP) throw new KnowledgeChunkError("shape");
  let content = head.content;
  for (const [i, { row }] of parts.entries()) {
    if (row.content.length !== Math.min(CHUNK, length - i * STEP)) throw new KnowledgeChunkError("shape");
    if (i === 0) continue;
    const overlap = Math.min(OVERLAP, row.content.length);
    if (parts[i - 1].row.content.slice(-overlap) !== row.content.slice(0, overlap)) {
      throw new KnowledgeChunkError("overlap");
    }
    content += row.content.slice(overlap);
  }
  if (content.length !== length) throw new KnowledgeChunkError("shape");
  return { head, content };
}
