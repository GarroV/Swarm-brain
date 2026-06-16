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

function firstLine(s: string): string {
  return s.split("\n").map((x) => x.trim()).find(Boolean) ?? "";
}

// Заголовок — человеческий: metadata.title → первая строка content. summary НЕ берём:
// у заметок (source=note) и ссылок (source=link) summary — это «поисковый индекс»
// (синонимы/ключевые слова для recall), а не заголовок. content и metadata.title — чистые.
export function deriveEntryTitle(e: { content: string; metadata: Record<string, unknown> }): string {
  const mt = typeof e.metadata?.title === "string" ? (e.metadata.title as string).trim() : "";
  if (mt) return mt;
  const fl = firstLine(e.content || "");
  if (!fl) return "Запись";
  return fl.length > 80 ? fl.slice(0, 77) + "…" : fl;
}

// summary как «поисковый индекс» (синонимы/ключевые слова для recall), не реальные тезисы:
// так бэкенд обогащает короткие заметки и ссылки (swarm-bot knowledge.ts / media.ts). Не показываем.
export function isSearchIndexSummary(e: { source: string; summary: string | null }): boolean {
  if (!e.summary) return false;
  if (e.source === "note" || e.source === "link") return true;
  return /^синоним/i.test(e.summary.trim());
}

// Превью под заголовком: реальные тезисы (если есть) — иначе чистый сниппет из content
// (без строки-заголовка и без «Ссылка: …»). Может вернуть "" → тогда превью не показываем.
export function entryPreview(e: { source: string; summary: string | null; content: string; metadata: Record<string, unknown> }): string {
  if (e.summary && !isSearchIndexSummary(e)) return e.summary.trim();
  const title = deriveEntryTitle(e);
  return (e.content || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((line) => line !== title && !/^ссылка:/i.test(line))
    .join(" ");
}
