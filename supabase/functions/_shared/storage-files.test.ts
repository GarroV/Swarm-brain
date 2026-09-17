import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  uploadPrivateFile,
  registerStorageFile,
  externalFileUrl,
  PRIVATE_BUCKET,
} from "./storage-files.ts";

type MockOpts = {
  uploadError?: string;
  insertError?: string;
  registry?: unknown;
  signError?: string;
};

function makeClient(opts: MockOpts = {}) {
  const calls: {
    uploads: Array<{ bucket: string; path: string; upsert: boolean; contentType: string }>;
    inserts: Array<Record<string, unknown>>;
    signed: Array<{ bucket: string; path: string; ttl: number }>;
  } = { uploads: [], inserts: [], signed: [] };

  const table: Record<string, unknown> = {};
  table.select = () => table;
  table.eq = () => table;
  table.maybeSingle = () => Promise.resolve({ data: opts.registry ?? null });
  table.insert = (row: Record<string, unknown>) => {
    calls.inserts.push(row);
    return Promise.resolve({ error: opts.insertError ? { message: opts.insertError } : null });
  };

  const client = {
    from: () => table,
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, _body: unknown, o: { upsert?: boolean; contentType?: string }) => {
          calls.uploads.push({
            bucket,
            path,
            upsert: Boolean(o?.upsert),
            contentType: o?.contentType ?? "",
          });
          return Promise.resolve({ error: opts.uploadError ? { message: opts.uploadError } : null });
        },
        createSignedUrl: (path: string, ttl: number) => {
          calls.signed.push({ bucket, path, ttl });
          return Promise.resolve({
            data: opts.signError ? null : { signedUrl: `https://x.supabase.co/sign/${bucket}/${path}?token=t` },
            error: opts.signError ? { message: opts.signError } : null,
          });
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test("uploadPrivateFile: кладёт в приватный бакет, не в публичный", async () => {
  const { client, calls } = makeClient();
  const res = await uploadPrivateFile(client, {
    path: "uploads/x.pdf",
    body: new Uint8Array([1, 2]),
    contentType: "application/pdf",
  });
  assertEquals(calls.uploads[0].bucket, PRIVATE_BUCKET);
  assertEquals(res.file, { path: "uploads/x.pdf", bucket: PRIVATE_BUCKET });
  assertEquals(res.error, null);
});

Deno.test("uploadPrivateFile: пустой тип не уходит в хранилище пустым", async () => {
  const { client, calls } = makeClient();
  await uploadPrivateFile(client, { path: "p", body: new Uint8Array(), contentType: "" });
  assertEquals(calls.uploads[0].contentType, "application/octet-stream");
});

Deno.test("uploadPrivateFile: ошибка возвращается, файл не считается загруженным", async () => {
  const { client } = makeClient({ uploadError: "quota" });
  const res = await uploadPrivateFile(client, { path: "p", body: new Uint8Array(), contentType: "text/plain" });
  assertEquals(res.file, null);
  assertEquals(res.error, "quota");
});

Deno.test("registerStorageFile: вложение записи пишется с entry_id", async () => {
  const { client, calls } = makeClient();
  const res = await registerStorageFile(client, {
    path: "uploads/x.pdf",
    owner: { kind: "entry", entryId: "e1" },
  });
  assertEquals(res.error, null);
  assertEquals(calls.inserts[0], {
    path: "uploads/x.pdf",
    bucket: PRIVATE_BUCKET,
    owner_kind: "entry",
    entry_id: "e1",
  });
});

Deno.test("registerStorageFile: скрин фидбека — без записи-владельца", async () => {
  const { client, calls } = makeClient();
  await registerStorageFile(client, { path: "feedback/s.png", owner: { kind: "feedback" } });
  assertEquals(calls.inserts[0].owner_kind, "feedback");
  assertEquals(calls.inserts[0].entry_id, null);
});

Deno.test("registerStorageFile: ошибка не проглатывается", async () => {
  const { client } = makeClient({ insertError: "fk violation" });
  const res = await registerStorageFile(client, { path: "p", owner: { kind: "feedback" } });
  assertEquals(res.error, "fk violation");
});

Deno.test("externalFileUrl: наш путь → подписанная ссылка из бакета реестра", async () => {
  const { client, calls } = makeClient({ registry: { bucket: PRIVATE_BUCKET } });
  const url = await externalFileUrl(client, "uploads/x.pdf");
  assertEquals(calls.signed[0], { bucket: PRIVATE_BUCKET, path: "uploads/x.pdf", ttl: 60 });
  assertEquals(url, "https://x.supabase.co/sign/swarm_private/uploads/x.pdf?token=t");
});

Deno.test("externalFileUrl: старый публичный URL тоже подписывается (бакет по умолчанию)", async () => {
  const { client, calls } = makeClient({ registry: null });
  await externalFileUrl(
    client,
    "https://x.supabase.co/storage/v1/object/public/swarm_drive/uploads/a%20b.pdf",
  );
  assertEquals(calls.signed[0].bucket, "swarm_drive");
  assertEquals(calls.signed[0].path, "uploads/a b.pdf");
});

Deno.test("externalFileUrl: внешняя ссылка отдаётся как есть", async () => {
  const { client, calls } = makeClient();
  const url = await externalFileUrl(client, "https://drive.google.com/file/d/1/view");
  assertEquals(url, "https://drive.google.com/file/d/1/view");
  assertEquals(calls.signed.length, 0);
});

Deno.test("externalFileUrl: не удалось подписать → null (отправлять нечего)", async () => {
  const { client } = makeClient({ registry: { bucket: PRIVATE_BUCKET }, signError: "gone" });
  assertEquals(await externalFileUrl(client, "uploads/x.pdf"), null);
});

Deno.test("externalFileUrl: пустое значение → null", async () => {
  const { client } = makeClient();
  assertEquals(await externalFileUrl(client, ""), null);
  assertEquals(await externalFileUrl(client, undefined), null);
});
