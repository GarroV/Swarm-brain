import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  storagePathFromLink,
  webFileUrl,
  absoluteFileUrl,
  normalizeFileLink,
  withNormalizedFileLink,
  removeStorageObject,
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

// ── withNormalizedFileLink: то, что применяем к строке записи на отдаче ───────

Deno.test("withNormalizedFileLink: file_url в metadata переписывается на /api/file", () => {
  const row = {
    id: "e1",
    metadata: { filename: "x.pdf", file_url: PUBLIC_DRIVE, file_type: "application/pdf" },
  };
  const out = withNormalizedFileLink(row);
  assertEquals(
    (out.metadata as Record<string, unknown>).file_url,
    "/api/file/uploads/2026-09-05_%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf",
  );
  // Остальные поля metadata не теряются.
  assertEquals((out.metadata as Record<string, unknown>).filename, "x.pdf");
  assertEquals(out.id, "e1");
});

Deno.test("withNormalizedFileLink: исходный объект не мутируется", () => {
  const meta = { file_url: PUBLIC_DRIVE };
  const row = { id: "e1", metadata: meta };
  withNormalizedFileLink(row);
  assertEquals(meta.file_url, PUBLIC_DRIVE);
});

Deno.test("withNormalizedFileLink: внешняя ссылка (не наш бакет) остаётся как есть", () => {
  // Google Drive и прочие внешние ссылки — легитимное содержимое, не наш файл.
  const row = { metadata: { file_url: "https://drive.google.com/file/d/123/view" } };
  const out = withNormalizedFileLink(row);
  assertEquals(
    (out.metadata as Record<string, unknown>).file_url,
    "https://drive.google.com/file/d/123/view",
  );
});

Deno.test("withNormalizedFileLink: запись без файла проходит нетронутой", () => {
  const row = { id: "e1", metadata: { url: "https://example.com" } };
  assertEquals(withNormalizedFileLink(row), row);
  assertEquals(withNormalizedFileLink({ id: "e2" }), { id: "e2" });
  assertEquals(withNormalizedFileLink({ id: "e3", metadata: null }), { id: "e3", metadata: null });
});

Deno.test("withNormalizedFileLink: список строк — каждая нормализуется", () => {
  const rows = [
    { metadata: { file_url: PUBLIC_DRIVE } },
    { metadata: { url: "https://example.com" } },
  ];
  const out = rows.map((r) => withNormalizedFileLink(r));
  assertEquals(
    (out[0].metadata as Record<string, unknown>).file_url,
    "/api/file/uploads/2026-09-05_%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf",
  );
  assertEquals((out[1].metadata as Record<string, unknown>).url, "https://example.com");
});

Deno.test("withNormalizedFileLink: с базой — абсолютная ссылка (MCP, письма)", () => {
  const row = { metadata: { file_url: PUBLIC_DRIVE } };
  const out = withNormalizedFileLink(row, { baseUrl: "https://swarm-brain.pages.dev" });
  assertEquals(
    (out.metadata as Record<string, unknown>).file_url,
    "https://swarm-brain.pages.dev/api/file/uploads/2026-09-05_%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf",
  );
});

// ── removeStorageObject: единственное место, где файл записи удаляется ────────

// Mock: реестр (storage_files) + storage.remove с записью вызовов и настраиваемой ошибкой.
function makeStorage(opts: { registry?: unknown; removeError?: string } = {}) {
  const calls: { removed: Array<{ bucket: string; paths: string[] }>; registryDeleted: string[] } = {
    removed: [],
    registryDeleted: [],
  };
  const tableBuilder: Record<string, unknown> = {};
  let pendingDelete = false;
  tableBuilder.select = () => tableBuilder;
  tableBuilder.delete = () => { pendingDelete = true; return tableBuilder; };
  tableBuilder.eq = (_col: string, val: string) => {
    if (pendingDelete) { calls.registryDeleted.push(val); pendingDelete = false; }
    return tableBuilder;
  };
  tableBuilder.maybeSingle = () => Promise.resolve({ data: opts.registry ?? null });

  const client = {
    from: () => tableBuilder,
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          calls.removed.push({ bucket, paths });
          return Promise.resolve({ error: opts.removeError ? { message: opts.removeError } : null });
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test("removeStorageObject: не наш файл → no-file, в хранилище не лезем", async () => {
  const { client, calls } = makeStorage();
  const res = await removeStorageObject(client, "https://drive.google.com/file/d/1/view");
  assertEquals(res.status, "no-file");
  assertEquals(calls.removed.length, 0);
});

Deno.test("removeStorageObject: нет строки реестра → старый бакет swarm_drive", async () => {
  const { client, calls } = makeStorage({ registry: null });
  const res = await removeStorageObject(client, PUBLIC_DRIVE);
  assertEquals(res.status, "removed");
  assertEquals(calls.removed[0].bucket, "swarm_drive");
  assertEquals(calls.removed[0].paths, ["uploads/2026-09-05_отчёт.pdf"]);
});

Deno.test("removeStorageObject: бакет берётся из реестра, строка реестра снимается", async () => {
  const { client, calls } = makeStorage({
    registry: { bucket: "swarm_private" },
  });
  const res = await removeStorageObject(client, "uploads/x.pdf");
  assertEquals(res.status, "removed");
  assertEquals(calls.removed[0].bucket, "swarm_private");
  assertEquals(calls.registryDeleted, ["uploads/x.pdf"]);
});

Deno.test("removeStorageObject: ошибка удаления → failed, реестр не трогаем", async () => {
  // Файл остался в хранилище — строка реестра должна остаться его следом,
  // иначе объект теряет владельца и становится неудаляемым мусором.
  const { client, calls } = makeStorage({ registry: { bucket: "swarm_private" }, removeError: "boom" });
  const res = await removeStorageObject(client, "uploads/x.pdf");
  assertEquals(res.status, "failed");
  assertEquals(res.error, "boom");
  assertEquals(calls.registryDeleted, []);
});

Deno.test("removeStorageObject: percent-encoded имя удаляется декодированным", async () => {
  const { client, calls } = makeStorage();
  await removeStorageObject(
    client,
    "https://x.supabase.co/storage/v1/object/public/swarm_drive/uploads/a%20b.pdf",
  );
  assertEquals(calls.removed[0].paths, ["uploads/a b.pdf"]);
});
