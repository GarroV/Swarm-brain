import { assertEquals } from "jsr:@std/assert@1";
import {
  storagePathFromLink,
  webFileUrl,
  absoluteFileUrl,
  normalizeFileLink,
} from "./storage-links.ts";

const PUBLIC_DRIVE =
  "https://vbqglndbxkpmreccpqmr.supabase.co/storage/v1/object/public/swarm_drive/uploads/2026-09-05_отчёт.pdf";
const PUBLIC_PRIVATE_BUCKET =
  "https://vbqglndbxkpmreccpqmr.supabase.co/storage/v1/object/public/swarm_private/uploads/x.pdf";
const SIGNED =
  "https://vbqglndbxkpmreccpqmr.supabase.co/storage/v1/object/sign/swarm_private/uploads/x.pdf?token=abc.def";

// ── storagePathFromLink: из чего угодно достать путь объекта ──────────────────

Deno.test("storagePathFromLink: публичный URL старого бакета → путь без бакета", () => {
  assertEquals(storagePathFromLink(PUBLIC_DRIVE), "uploads/2026-09-05_отчёт.pdf");
});

Deno.test("storagePathFromLink: публичный URL приватного бакета → путь", () => {
  assertEquals(storagePathFromLink(PUBLIC_PRIVATE_BUCKET), "uploads/x.pdf");
});

Deno.test("storagePathFromLink: signed URL → путь без query", () => {
  assertEquals(storagePathFromLink(SIGNED), "uploads/x.pdf");
});

Deno.test("storagePathFromLink: percent-encoded имя декодируется", () => {
  const url =
    "https://x.supabase.co/storage/v1/object/public/swarm_drive/uploads/a%20b%2Bc.pdf";
  assertEquals(storagePathFromLink(url), "uploads/a b+c.pdf");
});

Deno.test("storagePathFromLink: уже путь — возвращается как есть", () => {
  assertEquals(storagePathFromLink("uploads/x.pdf"), "uploads/x.pdf");
});

Deno.test("storagePathFromLink: чужой URL → null (не наш объект, не выдаём за путь)", () => {
  assertEquals(storagePathFromLink("https://example.com/secret.pdf"), null);
});

Deno.test("storagePathFromLink: пустое/не строка → null", () => {
  assertEquals(storagePathFromLink(""), null);
  assertEquals(storagePathFromLink("   "), null);
});

Deno.test("storagePathFromLink: путь с ведущим слэшем нормализуется", () => {
  assertEquals(storagePathFromLink("/uploads/x.pdf"), "uploads/x.pdf");
});

// ── webFileUrl: ссылка для веба (same-origin через прокси /api) ───────────────

Deno.test("webFileUrl: путь → /api/file/<path>, слэши сохранены", () => {
  assertEquals(webFileUrl("uploads/x.pdf"), "/api/file/uploads/x.pdf");
});

Deno.test("webFileUrl: пробелы и кириллица кодируются посегментно", () => {
  assertEquals(
    webFileUrl("uploads/a b.pdf"),
    "/api/file/uploads/a%20b.pdf",
  );
  assertEquals(
    webFileUrl("uploads/отчёт.pdf"),
    "/api/file/uploads/%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf",
  );
});

Deno.test("webFileUrl: слэш внутри имени сегмента кодируется, разделители нет", () => {
  // Разделитель пути остаётся слэшем, а '?' и '#' в имени не должны рвать URL.
  assertEquals(webFileUrl("uploads/a?b#c.pdf"), "/api/file/uploads/a%3Fb%23c.pdf");
});

// ── absoluteFileUrl: для получателей без нашей страницы (MCP, письма) ─────────

Deno.test("absoluteFileUrl: база + путь", () => {
  assertEquals(
    absoluteFileUrl("uploads/x.pdf", "https://swarm-brain.pages.dev"),
    "https://swarm-brain.pages.dev/api/file/uploads/x.pdf",
  );
});

Deno.test("absoluteFileUrl: завершающий слэш базы не удваивается", () => {
  assertEquals(
    absoluteFileUrl("uploads/x.pdf", "https://swarm-brain.pages.dev/"),
    "https://swarm-brain.pages.dev/api/file/uploads/x.pdf",
  );
});

// ── normalizeFileLink: то, что применяем к metadata.file_url на отдаче ────────

Deno.test("normalizeFileLink: старый публичный URL → ссылка через /api/file", () => {
  assertEquals(
    normalizeFileLink(PUBLIC_DRIVE),
    "/api/file/uploads/2026-09-05_%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf",
  );
});

Deno.test("normalizeFileLink: уже нормализованная ссылка не трогается", () => {
  assertEquals(normalizeFileLink("/api/file/uploads/x.pdf"), "/api/file/uploads/x.pdf");
});

Deno.test("normalizeFileLink: абсолютный вид, когда задана база", () => {
  assertEquals(
    normalizeFileLink(PUBLIC_DRIVE, { baseUrl: "https://swarm-brain.pages.dev" }),
    "https://swarm-brain.pages.dev/api/file/uploads/2026-09-05_%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf",
  );
});

Deno.test("normalizeFileLink: нераспознанное значение → null (не выдумываем ссылку)", () => {
  assertEquals(normalizeFileLink("https://example.com/secret.pdf"), null);
  assertEquals(normalizeFileLink(undefined), null);
  assertEquals(normalizeFileLink(42), null);
});
