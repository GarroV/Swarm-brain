import type { EntryMeta } from "../_shared/meta-extract.ts";

export interface AddKnowledgeArgs {
  content?: string;
  summary: string;
  source?: string;
  is_private?: boolean;
  owner_telegram_id?: number;
  requesting_user_id?: number;
}

export interface KnowledgeRow {
  content: string;
  summary: string | null;
  embedding: number[] | null;
  added_by: string;
  source: string;
  metadata: Record<string, unknown>;
  countries: string[];
  entry_type: EntryMeta["entry_type"];
  entry_date: string | null;
  group_id: string;
  is_private: boolean;
  owner_id: number;
}

export interface KnowledgeDeps {
  callerScope: (requestingUserId?: number) => Promise<{ userId: number; groupId: string } | null>;
  insertEntry: (row: KnowledgeRow) => PromiseLike<{ error: { message: string } | null }>;
  embeddingOrNull: (groupId: string, text: string) => Promise<number[] | null>;
  extractMeta: (groupId: string, summary: string) => Promise<EntryMeta>;
  applyGeneralSentinel: (countries: string[]) => string[];
  noWorkspaceMessage: string;
  unindexedNote: string;
}

const MAX_EMBEDDING_INPUT_BYTES = 8000;

// A UTF-8 byte budget is conservative for byte-based tokenization, including CJK and emoji.
// This affects the embedding input only; persisted content and summary remain verbatim.
function embeddingExcerpt(text: string): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let units = 0;
  for (const point of text) {
    const size = encoder.encode(point).length;
    if (bytes + size > MAX_EMBEDDING_INPUT_BYTES) break;
    bytes += size;
    units += point.length;
  }
  return text.slice(0, units);
}

export async function addKnowledge(args: AddKnowledgeArgs, deps: KnowledgeDeps): Promise<string> {
  const source = args.source ?? "claude";
  const rawContent = args.content?.trim() ? args.content : args.summary;

  // Личность вызывающего — только из токена (tools/call перетирает поля личности в аргументах).
  // Автор записи (owner_id) = вызывающий — и у личной, и у общей (решение 03.10, #790: каждая
  // запись помечена автором; added_by — канал, не человек). Воркспейс = воркспейс вызывающего.
  const scope = await deps.callerScope(args.requesting_user_id);
  if (!scope) return deps.noWorkspaceMessage;
  const isPrivate = args.is_private === true;
  const ownerId = scope.userId;
  const workspaceGroupId = scope.groupId;
  const [summaryEmbedding, entryMeta] = await Promise.all([
    deps.embeddingOrNull(scope.groupId, embeddingExcerpt(args.summary)),
    deps.extractMeta(scope.groupId, args.summary),
  ]);

  const unindexed = summaryEmbedding === null;
  // One record retains the complete source; only the embedding excerpt is bounded.
  const { error: insertErr } = await deps.insertEntry({
    content: rawContent,
    summary: args.summary,
    embedding: summaryEmbedding,
    added_by: "claude_desktop",
    source,
    metadata: {},
    countries: deps.applyGeneralSentinel(entryMeta.countries),
    entry_type: entryMeta.entry_type,
    entry_date: entryMeta.entry_date,
    group_id: workspaceGroupId,
    is_private: isPrivate,
    owner_id: ownerId,
  });
  if (insertErr) return `Ошибка сохранения: ${insertErr.message}`;

  const contentNote = !args.content?.trim() ? " (оригинал не передан)" : "";
  const dest = isPrivate ? "личное хранилище" : "базу знаний";
  return `✅ Добавлено в ${dest} (1 часть).${contentNote}${unindexed ? deps.unindexedNote : ""}`;
}
