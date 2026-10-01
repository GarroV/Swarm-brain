// Ключи загрузки: уникальные, внутри воркспейса владельца, без перезаписи; откат убирает только
// объект, созданный тем же запросом.
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildUploadKey,
  discardOwnUpload,
  FEEDBACK_SCOPE,
  isOwnUploadKey,
  PRIVATE_BUCKET,
  uploadNewPrivateFile,
  uploadPrivateFile,
} from "./storage-files.ts";

type Calls = {
  uploads: Array<{ bucket: string; path: string; upsert: boolean }>;
  removed: Array<{ bucket: string; paths: string[] }>;
};

function makeClient(opts: { uploadError?: string } = {}) {
  const calls: Calls = { uploads: [], removed: [] };
  const client = {
    from: () => ({}),
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, _b: unknown, o: { upsert?: boolean }) => {
          calls.uploads.push({ bucket, path, upsert: Boolean(o?.upsert) });
          return Promise.resolve({ error: opts.uploadError ? { message: opts.uploadError } : null });
        },
        remove: (paths: string[]) => {
          calls.removed.push({ bucket, paths });
          return Promise.resolve({ error: null });
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const NOW = new Date("2026-10-01T12:00:00Z");
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// ── buildUploadKey ───────────────────────────────────────────────────────────

Deno.test("buildUploadKey: папка / воркспейс / дата_uuid_имя", () => {
  const key = buildUploadKey({
    folder: "uploads",
    scope: "cee",
    fileName: "отчёт.pdf",
    now: NOW,
    id: "11111111-2222-4333-8444-555555555555",
  });
  assertEquals(key, "uploads/cee/2026-10-01_11111111-2222-4333-8444-555555555555_otchet.pdf");
});

Deno.test("buildUploadKey: одинаковое имя в один день у двух воркспейсов — разные ключи", () => {
  const a = buildUploadKey({ folder: "uploads", scope: "cee", fileName: "a.pdf", now: NOW });
  const b = buildUploadKey({ folder: "uploads", scope: "demo", fileName: "a.pdf", now: NOW });
  assertNotEquals(a, b);
  assert(a.startsWith("uploads/cee/"));
  assert(b.startsWith("uploads/demo/"));
});

Deno.test("buildUploadKey: одинаковое имя в одном воркспейсе — всё равно разные ключи (полный uuid)", () => {
  const a = buildUploadKey({ folder: "uploads", scope: "cee", fileName: "a.pdf", now: NOW });
  const b = buildUploadKey({ folder: "uploads", scope: "cee", fileName: "a.pdf", now: NOW });
  assertNotEquals(a, b);
  assert(UUID_RE.test(a), a);
});

Deno.test("buildUploadKey: воркспейс со слэшем или точками не принимается", () => {
  for (const scope of ["", "../cee", "cee/x", "a.b", " cee"]) {
    let threw = false;
    try {
      buildUploadKey({ folder: "uploads", scope, fileName: "a.pdf", now: NOW });
    } catch {
      threw = true;
    }
    assert(threw, `scope «${scope}» должен быть отвергнут`);
  }
});

Deno.test("buildUploadKey: служебная область фидбека допустима", () => {
  const key = buildUploadKey({ folder: "feedback", scope: FEEDBACK_SCOPE, fileName: "s.png", now: NOW });
  assert(key.startsWith(`feedback/${FEEDBACK_SCOPE}/2026-10-01_`));
});

// ── isOwnUploadKey ───────────────────────────────────────────────────────────

Deno.test("isOwnUploadKey: свой ключ — да", () => {
  const key = buildUploadKey({ folder: "uploads", scope: "cee", fileName: "a.pdf", now: NOW });
  assert(isOwnUploadKey(key, "cee"));
});

Deno.test("isOwnUploadKey: ключ другого воркспейса — нет", () => {
  const key = buildUploadKey({ folder: "uploads", scope: "cee", fileName: "a.pdf", now: NOW });
  assertEquals(isOwnUploadKey(key, "demo"), false);
});

Deno.test("isOwnUploadKey: старый предсказуемый ключ без воркспейса и uuid — нет", () => {
  assertEquals(isOwnUploadKey("uploads/2026-10-01_a.pdf", "cee"), false);
  assertEquals(isOwnUploadKey("uploads/cee/2026-10-01_a.pdf", "cee"), false);
  assertEquals(isOwnUploadKey("uploads/cee/../demo/2026-10-01_x_a.pdf", "cee"), false);
});

// ── uploadPrivateFile / uploadNewPrivateFile ─────────────────────────────────

Deno.test("uploadPrivateFile: перезапись запрещена всегда", async () => {
  const { client, calls } = makeClient();
  // Даже если вызывающий по старой памяти попросит upsert — в хранилище уходит false.
  await uploadPrivateFile(
    client,
    {
      path: "uploads/cee/x",
      body: new Uint8Array(),
      contentType: "text/plain",
      upsert: true,
    } as unknown as Parameters<typeof uploadPrivateFile>[1],
  );
  assertEquals(calls.uploads[0].upsert, false);
});

Deno.test("uploadNewPrivateFile: ключ в воркспейсе владельца, upsert=false", async () => {
  const { client, calls } = makeClient();
  const res = await uploadNewPrivateFile(client, {
    folder: "uploads",
    scope: "cee",
    fileName: "a.pdf",
    body: new Uint8Array([1]),
    contentType: "application/pdf",
  });
  assertEquals(res.error, null);
  assert(res.file);
  assertEquals(res.file.bucket, PRIVATE_BUCKET);
  assertEquals(res.file.scope, "cee");
  assert(res.file.path.startsWith("uploads/cee/"));
  assertEquals(calls.uploads[0], { bucket: PRIVATE_BUCKET, path: res.file.path, upsert: false });
});

Deno.test("uploadNewPrivateFile: ошибка (в т.ч. «уже существует») — файла нет, откатывать нечего", async () => {
  const { client } = makeClient({ uploadError: "The resource already exists" });
  const res = await uploadNewPrivateFile(client, {
    folder: "uploads",
    scope: "cee",
    fileName: "a.pdf",
    body: new Uint8Array([1]),
    contentType: "application/pdf",
  });
  assertEquals(res.file, null);
  assertEquals(res.error, "The resource already exists");
});

Deno.test("uploadNewPrivateFile: недопустимый воркспейс — ошибка без обращения к хранилищу", async () => {
  const { client, calls } = makeClient();
  const res = await uploadNewPrivateFile(client, {
    folder: "uploads",
    scope: "../demo",
    fileName: "a.pdf",
    body: new Uint8Array([1]),
    contentType: "application/pdf",
  });
  assertEquals(res.file, null);
  assert(res.error);
  assertEquals(calls.uploads.length, 0);
});

// ── discardOwnUpload ─────────────────────────────────────────────────────────

Deno.test("discardOwnUpload: убирает объект, созданный этим запросом", async () => {
  const { client, calls } = makeClient();
  const up = await uploadNewPrivateFile(client, {
    folder: "uploads",
    scope: "cee",
    fileName: "a.pdf",
    body: new Uint8Array([1]),
    contentType: "application/pdf",
  });
  assert(up.file);
  const res = await discardOwnUpload(client, up.file);
  assertEquals(res.removed, true);
  assertEquals(calls.removed, [{ bucket: PRIVATE_BUCKET, paths: [up.file.path] }]);
});

Deno.test("discardOwnUpload: чужой или старый путь не удаляется", async () => {
  const { client, calls } = makeClient();
  const foreign = [
    { path: "uploads/2026-10-01_a.pdf", bucket: PRIVATE_BUCKET, scope: "cee" },
    {
      path: "uploads/demo/2026-10-01_11111111-2222-4333-8444-555555555555_a.pdf",
      bucket: PRIVATE_BUCKET,
      scope: "cee",
    },
  ];
  for (const f of foreign) {
    const res = await discardOwnUpload(client, f);
    assertEquals(res.removed, false);
  }
  assertEquals(calls.removed.length, 0);
});
