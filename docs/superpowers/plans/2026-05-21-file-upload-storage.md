# File Upload & Storage Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `upload_file` and `get_storage_stats` MCP tools, extend `list_entries` with `has_file` filter, and extend `update_entry` with file replacement — all in `swarm-mcp/index.ts`.

**Architecture:** All changes are in a single Deno Edge Function file. Files are stored in the existing `swarm_drive` Supabase Storage bucket at path `uploads/YYYY/MM/{uuid}-{filename}`. Binary content is passed as base64 strings through MCP JSON-RPC, decoded on the server, and uploaded via the Supabase JS client.

**Tech Stack:** Deno, Supabase JS client v2, Supabase Storage (swarm_drive bucket), TypeScript

---

## File Map

- **Modify:** `supabase/functions/swarm-mcp/index.ts`
  - Add helper `mimeFromExtension`
  - Add helper `uploadToStorage` (shared by `upload_file` and `update_entry` file replacement)
  - Add `toolUploadFile`
  - Add `toolGetStorageStats`
  - Extend `toolListEntries` with `has_file` param
  - Extend `toolUpdateEntry` with `file_content_base64` + `file_name` params
  - Update `TOOLS` array: 2 new definitions + 2 updated schemas
  - Update dispatch handler: 2 new branches + 2 updated casts

---

### Task 1: Add `mimeFromExtension` helper and `uploadToStorage` helper

**Files:**
- Modify: `supabase/functions/swarm-mcp/index.ts` (after `extractEntryMeta`, before `// ── Tool definitions`)

- [ ] **Step 1: Add the two helpers**

Insert after line 63 (after the `extractEntryMeta` function closing brace), before `// ── Tool definitions`:

```typescript
function mimeFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", gif: "image/gif", webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain", md: "text/markdown", csv: "text/csv",
    mp3: "audio/mpeg", mp4: "video/mp4",
  };
  return map[ext] ?? "application/octet-stream";
}

async function uploadToStorage(
  fileContentBase64: string,
  fileName: string,
  mimeType: string
): Promise<{ path: string; publicUrl: string; fileSizeBytes: number }> {
  const bytes = Uint8Array.from(atob(fileContentBase64), c => c.charCodeAt(0));
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `uploads/${yyyy}/${mm}/${uuid}-${safeName}`;

  const { error } = await supabase.storage
    .from("swarm_drive")
    .upload(path, bytes, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage
    .from("swarm_drive")
    .getPublicUrl(path);

  return { path, publicUrl, fileSizeBytes: bytes.length };
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/garva/swarm && deno check supabase/functions/swarm-mcp/index.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-mcp/index.ts
git commit -m "feat(swarm-mcp): add mimeFromExtension and uploadToStorage helpers"
```

---

### Task 2: Add `toolUploadFile` function

**Files:**
- Modify: `supabase/functions/swarm-mcp/index.ts` (after `toolAddKnowledge`, before `toolListEntries`)

- [ ] **Step 1: Add `toolUploadFile` function**

Insert after `toolAddKnowledge` closes (after line 317), before `toolListEntries`:

```typescript
async function toolUploadFile(args: {
  file_name: string;
  file_content_base64: string;
  mime_type?: string;
  summary: string;
  source?: string;
}): Promise<string> {
  const source = args.source ?? "file";
  const mimeType = args.mime_type ?? mimeFromExtension(args.file_name);

  let uploadResult: { path: string; publicUrl: string; fileSizeBytes: number };
  try {
    uploadResult = await uploadToStorage(args.file_content_base64, args.file_name, mimeType);
  } catch (e) {
    return `Ошибка загрузки файла: ${e instanceof Error ? e.message : String(e)}`;
  }

  const [embedding, entryMeta] = await Promise.all([
    getEmbedding(args.summary.slice(0, 8000)),
    extractEntryMeta(args.summary),
  ]);

  const { error } = await supabase.from("entries").insert({
    content: args.summary,
    summary: args.summary,
    embedding,
    added_by: "claude_desktop",
    source,
    metadata: {
      file_url: uploadResult.publicUrl,
      file_name: args.file_name,
      mime_type: mimeType,
      file_size_bytes: uploadResult.fileSizeBytes,
    },
    countries: entryMeta.countries,
    entry_type: entryMeta.entry_type,
    entry_date: entryMeta.entry_date,
  });

  if (error) {
    await supabase.storage.from("swarm_drive").remove([uploadResult.path]);
    return `Ошибка создания записи: ${error.message}`;
  }

  const sizeKb = Math.round(uploadResult.fileSizeBytes / 1024);
  return `✅ Файл загружен: ${args.file_name} (${sizeKb} KB)\n📎 ${uploadResult.publicUrl}`;
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
deno check supabase/functions/swarm-mcp/index.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-mcp/index.ts
git commit -m "feat(swarm-mcp): add toolUploadFile"
```

---

### Task 3: Add `toolGetStorageStats` function

**Files:**
- Modify: `supabase/functions/swarm-mcp/index.ts` (after `toolUploadFile`)

- [ ] **Step 1: Add `toolGetStorageStats` function**

Insert after `toolUploadFile` closes, before `toolListEntries`:

```typescript
async function toolGetStorageStats(): Promise<string> {
  const { data, error } = await supabase
    .from("entries")
    .select("entry_type, source, created_at, metadata")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) return `Ошибка: ${error.message}`;
  if (!data?.length) return "База знаний пуста.";

  type Row = { entry_type: string; source: string; created_at: string; metadata: Record<string, unknown> | null };
  const rows = data as Row[];

  const total = rows.length;
  const withFiles = rows.filter(r => !!(r.metadata?.file_url)).length;

  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    byType[r.entry_type] = (byType[r.entry_type] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  }

  const fmtMap = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");

  const lastDate = new Date(rows[0].created_at).toLocaleDateString("ru-RU");

  return [
    `📊 База знаний Swarm Brain:`,
    `  Всего записей: ${total} (из них с файлами: ${withFiles})`,
    ``,
    `  По типу: ${fmtMap(byType)}`,
    `  По источнику: ${fmtMap(bySource)}`,
    ``,
    `  Последняя запись: ${lastDate}`,
  ].join("\n");
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
deno check supabase/functions/swarm-mcp/index.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-mcp/index.ts
git commit -m "feat(swarm-mcp): add toolGetStorageStats"
```

---

### Task 4: Extend `toolListEntries` with `has_file` filter

**Files:**
- Modify: `supabase/functions/swarm-mcp/index.ts` — `toolListEntries` function signature and body

- [ ] **Step 1: Update `toolListEntries` signature and add filter**

Replace the `toolListEntries` function signature and filter block:

```typescript
// OLD signature:
async function toolListEntries(args: { source?: string; entry_type?: string; date_from?: string; date_to?: string; limit?: number }): Promise<string> {

// NEW signature:
async function toolListEntries(args: { source?: string; entry_type?: string; date_from?: string; date_to?: string; limit?: number; has_file?: boolean }): Promise<string> {
```

After the existing `if (args.date_to)` line, add:

```typescript
  if (args.has_file === true) query = query.not("metadata->>file_url", "is", null);
  if (args.has_file === false) query = query.is("metadata->>file_url" as never, null);
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
deno check supabase/functions/swarm-mcp/index.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-mcp/index.ts
git commit -m "feat(swarm-mcp): add has_file filter to toolListEntries"
```

---

### Task 5: Extend `toolUpdateEntry` with file replacement

**Files:**
- Modify: `supabase/functions/swarm-mcp/index.ts` — `toolUpdateEntry` function

- [ ] **Step 1: Update `toolUpdateEntry` signature and add file replacement block**

Replace the `toolUpdateEntry` function signature:

```typescript
// OLD:
async function toolUpdateEntry(args: { id: string; content?: string; summary?: string; title?: string; entry_date?: string }): Promise<string> {

// NEW:
async function toolUpdateEntry(args: { id: string; content?: string; summary?: string; title?: string; entry_date?: string; file_content_base64?: string; file_name?: string }): Promise<string> {
```

Update the `select` at the top of the function to also fetch `source`:

```typescript
// OLD:
  const { data: existing, error: fetchErr } = await supabase
    .from("entries")
    .select("metadata")
    .eq("id", args.id)
    .maybeSingle();

// NEW:
  const { data: existing, error: fetchErr } = await supabase
    .from("entries")
    .select("metadata, source")
    .eq("id", args.id)
    .maybeSingle();
```

Add file replacement block after the `if (!existing)` guard, before `const updates`:

```typescript
  // File replacement
  if (args.file_content_base64 && args.file_name) {
    const oldMeta = (existing.metadata as Record<string, unknown>) ?? {};
    const oldFileUrl = oldMeta.file_url as string | undefined;

    // Delete old file from storage if present
    if (oldFileUrl) {
      try {
        const url = new URL(oldFileUrl);
        const pathParts = url.pathname.split("/object/public/swarm_drive/");
        if (pathParts.length > 1) {
          await supabase.storage.from("swarm_drive").remove([decodeURIComponent(pathParts[1])]);
        }
      } catch { /* ignore */ }
    }

    const mimeType = mimeFromExtension(args.file_name);
    let uploadResult: { path: string; publicUrl: string; fileSizeBytes: number };
    try {
      uploadResult = await uploadToStorage(args.file_content_base64, args.file_name, mimeType);
    } catch (e) {
      return `Ошибка загрузки файла: ${e instanceof Error ? e.message : String(e)}`;
    }

    const newMeta = {
      ...oldMeta,
      file_url: uploadResult.publicUrl,
      file_name: args.file_name,
      mime_type: mimeType,
      file_size_bytes: uploadResult.fileSizeBytes,
    };
    const { error: updErr } = await supabase.from("entries").update({ metadata: newMeta }).eq("id", args.id);
    if (updErr) return `Ошибка обновления метаданных файла: ${updErr.message}`;

    const sizeKb = Math.round(uploadResult.fileSizeBytes / 1024);
    return `✅ Файл заменён: ${args.file_name} (${sizeKb} KB)\n📎 ${uploadResult.publicUrl}`;
  }
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
deno check supabase/functions/swarm-mcp/index.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/swarm-mcp/index.ts
git commit -m "feat(swarm-mcp): add file replacement to toolUpdateEntry"
```

---

### Task 6: Update `TOOLS` array and dispatch handler

**Files:**
- Modify: `supabase/functions/swarm-mcp/index.ts` — `TOOLS` constant and `tools/call` handler

- [ ] **Step 1: Add `upload_file` and `get_storage_stats` to TOOLS**

Add after the `update_entry` tool definition (before the closing `]` of `TOOLS`):

```typescript
  {
    name: "upload_file",
    description: "Загрузить файл в хранилище Swarm Brain. Передай содержимое файла в base64. Максимальный размер ~4 MB. После загрузки создаётся запись в базе знаний с публичной ссылкой на файл.",
    inputSchema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Имя файла с расширением, например contract.pdf" },
        file_content_base64: { type: "string", description: "Содержимое файла, закодированное в base64" },
        mime_type: { type: "string", description: "MIME-тип файла (опционально, определяется по расширению автоматически)" },
        summary: { type: "string", description: "Описание файла / тезисы содержимого для индексации" },
        source: { type: "string", description: "Источник (по умолчанию: file)" },
      },
      required: ["file_name", "file_content_base64", "summary"],
    },
  },
  {
    name: "get_storage_stats",
    description: "Статистика базы знаний: общее количество записей, количество файлов, разбивка по типам и источникам.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
```

- [ ] **Step 2: Update `list_entries` schema in TOOLS**

In the `list_entries` tool definition, add `has_file` to `properties`:

```typescript
        has_file: { type: "boolean", description: "true — только записи с прикреплённым файлом, false — только без файла" },
```

- [ ] **Step 3: Update `update_entry` schema in TOOLS**

In the `update_entry` tool definition, add to `properties`:

```typescript
        file_content_base64: { type: "string", description: "Новый файл в base64 — заменяет текущий файл (требует file_name)" },
        file_name: { type: "string", description: "Имя нового файла с расширением" },
```

- [ ] **Step 4: Add dispatch branches in the `tools/call` handler**

After the `update_entry` branch (before `} else {`), add:

```typescript
      } else if (name === "upload_file") {
        result = await toolUploadFile(args as { file_name: string; file_content_base64: string; mime_type?: string; summary: string; source?: string });
      } else if (name === "get_storage_stats") {
        result = await toolGetStorageStats();
```

Update the `list_entries` dispatch cast:

```typescript
// OLD:
        result = await toolListEntries(args as { source?: string; entry_type?: string; date_from?: string; date_to?: string; limit?: number });
// NEW:
        result = await toolListEntries(args as { source?: string; entry_type?: string; date_from?: string; date_to?: string; limit?: number; has_file?: boolean });
```

Update the `update_entry` dispatch cast:

```typescript
// OLD:
        result = await toolUpdateEntry(args as { id: string; content?: string; summary?: string; title?: string; entry_date?: string });
// NEW:
        result = await toolUpdateEntry(args as { id: string; content?: string; summary?: string; title?: string; entry_date?: string; file_content_base64?: string; file_name?: string });
```

- [ ] **Step 5: Verify no TypeScript errors**

```bash
deno check supabase/functions/swarm-mcp/index.ts
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-mcp/index.ts
git commit -m "feat(swarm-mcp): wire upload_file, get_storage_stats into TOOLS and dispatch"
```

---

### Task 7: Deploy and smoke-test

- [ ] **Step 1: Deploy**

```bash
supabase functions deploy swarm-mcp --no-verify-jwt
```

Expected: `Deployed Functions swarm-mcp`

- [ ] **Step 2: Smoke-test `get_storage_stats`**

```bash
curl -s -X POST \
  https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_storage_stats","arguments":{}}}' \
  | jq .
```

Expected: JSON with `result.content[0].text` containing `📊 База знаний Swarm Brain:`

- [ ] **Step 3: Smoke-test `list_entries` with `has_file`**

```bash
curl -s -X POST \
  https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_entries","arguments":{"has_file":true,"limit":5}}}' \
  | jq .
```

Expected: list of entries with 📎 markers (or "Записей не найдено" if none yet)

- [ ] **Step 4: Smoke-test `upload_file` with a small test file**

```bash
CONTENT=$(echo -n "Тестовый документ для проверки загрузки файлов в Swarm Brain." | base64)
curl -s -X POST \
  https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-mcp \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"upload_file\",\"arguments\":{\"file_name\":\"test.txt\",\"file_content_base64\":\"$CONTENT\",\"summary\":\"Тестовый файл для проверки upload_file инструмента.\"}}}" \
  | jq .
```

Expected: `✅ Файл загружен: test.txt` with public URL

- [ ] **Step 5: Update CHANGELOG.md**

Add to CHANGELOG.md under a new entry:

```markdown
## [unreleased]

### Added
- `upload_file` MCP tool — upload binary files (base64) to swarm_drive Storage, creates knowledge entry with public URL
- `get_storage_stats` MCP tool — knowledge base statistics: total entries, files count, breakdown by type and source
- `has_file` filter for `list_entries` — filter entries with or without attached files
- File replacement in `update_entry` — pass `file_content_base64` + `file_name` to replace the file in Storage
```

- [ ] **Step 6: Final commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for file upload and storage management tools"
```
