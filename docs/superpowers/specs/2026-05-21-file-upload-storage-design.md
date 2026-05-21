# Swarm Brain — File Upload & Storage Management

**Date:** 2026-05-21  
**Status:** Approved

## Problem

Claude Desktop cannot upload files to Swarm Brain. `add_knowledge` only accepts text strings. The `swarm_drive` Supabase Storage bucket already exists and `file_url` metadata is already tracked in `entries`, but there is no MCP tool to upload files.

## Solution

Add 2 new MCP tools and extend 2 existing ones. All changes in `supabase/functions/swarm-mcp/index.ts`.

## Tools

### New: `upload_file`

Upload a binary file to `swarm_drive` storage and create a knowledge entry.

**Input:**
- `file_name` (string, required) — original filename with extension
- `file_content_base64` (string, required) — base64-encoded file content
- `mime_type` (string, required) — e.g. `application/pdf`, `image/jpeg`
- `summary` (string, required) — Claude's description/tezisy of the file
- `source` (string, optional, default: `"file"`)

**Logic:**
1. Decode base64 → `Uint8Array`
2. Upload to `swarm_drive` at path `uploads/YYYY/MM/{uuid}-{file_name}`
3. Get public URL via `supabase.storage.from("swarm_drive").getPublicUrl(path)`
4. Extract metadata (entry_type, countries, entry_date) from summary via `extractEntryMeta`
5. Create `entries` row:
   - `content` = summary
   - `summary` = summary
   - `embedding` = `getEmbedding(summary)`
   - `source` = source
   - `metadata` = `{ file_url, file_name, mime_type, file_size_bytes }`
   - `entry_type`, `countries`, `entry_date` from extracted meta
6. Return: `✅ Файл загружен: {file_name} ({size}KB). Запись создана.`

**Limits:** ~4MB per file (Supabase Edge Function request payload limit).

---

### New: `get_storage_stats`

Overview of knowledge base and storage usage.

**Input:** none

**Logic:** Single query against `entries` table aggregating:
- Total entry count
- Count of entries with `metadata->file_url` set
- Breakdown by `entry_type`
- Breakdown by `source`
- Date of most recent entry

**Output example:**
```
📊 База знаний Swarm Brain:
  Всего записей: 142 (из них с файлами: 17)

  По типу: meeting: 58 · document: 31 · note: 40 · transcript: 13
  По источнику: claude_desktop: 89 · read_ai: 41 · file: 17

  Последняя запись: 21 мая 2026
```

---

### Extended: `list_entries` — add `has_file` filter

Add optional `has_file: boolean` parameter.

When `has_file: true`: filter `.not("metadata->>file_url", "is", null)`.  
When `has_file: false`: filter `.is("metadata->>file_url", null)`.  
When omitted: no change to existing behavior.

---

### Extended: `update_entry` — add file replacement

Add optional `file_content_base64: string` and `file_name: string` parameters.

**Logic when `file_content_base64` provided:**
1. Check if entry has existing `metadata.file_url`; if so, delete old file from `swarm_drive`
2. Upload new file at `uploads/YYYY/MM/{uuid}-{file_name}`
3. Update `metadata.file_url`, `metadata.file_name`, `metadata.mime_type` (inferred from extension or passed separately)

`mime_type` inferred from `file_name` extension if not explicitly passed.

---

## Architecture

No new files. All changes in `index.ts`:
- 2 new tool functions: `toolUploadFile`, `toolGetStorageStats`
- 2 updated functions: `toolListEntries` (has_file param), `toolUpdateEntry` (file replacement)
- 4 updated entries in `TOOLS` array (definitions)
- 4 new dispatch branches in the `tools/call` handler

## Storage Layout

```
swarm_drive/
  uploads/
    2026/
      05/
        {uuid}-contract.pdf
        {uuid}-screenshot.png
```

## Error Handling

- Invalid base64: return error message, do not create entry
- Storage upload failure: return error, do not create entry (atomic)
- File >4MB: Supabase Edge Function returns 413 before reaching handler — document in tool description

## TOOLS array additions

`upload_file` and `get_storage_stats` added to `TOOLS` constant.  
`list_entries` schema updated with `has_file` property.  
`update_entry` schema updated with `file_content_base64` and `file_name` properties.
