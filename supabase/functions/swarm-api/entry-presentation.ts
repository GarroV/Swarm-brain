// Человеческий заголовок записи: metadata.title → первая непустая строка summary → срез content.
export function deriveEntryTitle(
  e: {
    summary: string | null;
    content: string;
    metadata: Record<string, unknown>;
  },
): string {
  const metaTitle = typeof e.metadata?.title === "string" ? (e.metadata.title as string).trim() : "";
  if (metaTitle) return metaTitle;
  const base = (e.summary && e.summary.trim()) || e.content || "";
  const firstLine = base.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  if (!firstLine) return "Запись";
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
}

// Ключ типа для TypeTag фронта (doc/mic/note/meet/pdf) из entry_type + metadata.file_type.
export function entryTagKey(
  entryType: string,
  metadata: Record<string, unknown>,
): string {
  const ft = typeof metadata?.file_type === "string" ? (metadata.file_type as string) : "";
  if (ft.includes("pdf")) return "pdf";
  switch (entryType) {
    case "transcript":
      return "mic";
    case "meeting":
      return "meet";
    case "note":
      return "note";
    case "document":
      return "doc";
    case "summary":
      return "note";
    default:
      return "doc";
  }
}
