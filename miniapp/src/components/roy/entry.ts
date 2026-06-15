import type { RoyTypeKey } from "./ui";

// Хелперы записи базы, общие для Базы и RecordDetail.

// Ключ TypeTag (doc/mic/note/meet/pdf) из entry_type + metadata.file_type.
export function entryTagKey(e: { entry_type: string; metadata: Record<string, unknown> }): RoyTypeKey {
  const ft = typeof e.metadata?.file_type === "string" ? (e.metadata.file_type as string) : "";
  if (ft.includes("pdf")) return "pdf";
  switch (e.entry_type) {
    case "transcript":
      return "mic";
    case "meeting":
      return "meet";
    case "note":
      return "note";
    case "document":
      return "doc";
    default:
      return "doc";
  }
}

// Человеческий заголовок: metadata.title → первая непустая строка summary → срез content.
// (Главная починка Базы из хендоффа: заголовок — не сырой первый абзац.)
export function deriveEntryTitle(e: { summary: string | null; content: string; metadata: Record<string, unknown> }): string {
  const mt = typeof e.metadata?.title === "string" ? (e.metadata.title as string).trim() : "";
  if (mt) return mt;
  const base = (e.summary && e.summary.trim()) || e.content || "";
  const fl = base.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  return fl.length > 80 ? fl.slice(0, 77) + "…" : fl || "Запись";
}
