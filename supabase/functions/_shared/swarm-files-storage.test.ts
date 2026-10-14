// Куда писать и откуда читать: swarm-files (MUSPELHEIM) или Storage; сервис не ответил → ошибка
// и ни одной строки в реестре.
import { assert, assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { externalFileUrl, registerStorageFile, uploadNewPrivateFile } from "./storage-files.ts";
import { removeStorageObject } from "./storage-links.ts";
import { verifyFileToken } from "./files-token.ts";
import {
  bucketForPath,
  FILES_BUCKET,
  filesStorage,
  isFilesPath,
  putFilesObject,
  signedFilesGetUrl,
} from "./swarm-files-storage.ts";

const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
const PKCS8 = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))));
const ENV: Record<string, string> = { FILES_BASE_URL: "https://files.test/swarm-files/", FILES_SIGNING_KEY: PKCS8 };
const env = (n: string) => ENV[n];
const noEnv = (_n: string) => undefined;

const BODY = new Uint8Array([1, 2, 3, 4, 5]);
const PARAMS = {
  folder: "uploads",
  scope: "cee",
  fileName: "отчёт.pdf",
  body: BODY,
  contentType: "application/pdf",
};

function storageClient() {
  const uploads: string[] = [];
  const removed: string[] = [];
  const client = {
    from: () => ({}),
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          uploads.push(`${bucket}/${path}`);
          return Promise.resolve({ error: null });
        },
        remove: (paths: string[]) => {
          removed.push(...paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, uploads, removed };
}

function fakeFetch(status: number | Error) {
  const calls: Array<{ url: string; method?: string; size: number }> = [];
  const fn = ((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, size: (init?.body as Uint8Array).byteLength });
    if (status instanceof Error) return Promise.reject(status);
    return Promise.resolve(new Response(null, { status }));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

Deno.test("filesStorage: без адреса или без ключа — null (остаёмся на Storage)", () => {
  assertEquals(filesStorage(noEnv), null);
  assertEquals(filesStorage((n) => (n === "FILES_BASE_URL" ? "https://x" : undefined)), null);
  assertEquals(filesStorage((n) => (n === "FILES_SIGNING_KEY" ? PKCS8 : undefined)), null);
  assert(filesStorage(env));
});

Deno.test("uploadNewPrivateFile: swarm-files настроен → PUT на сервис, Storage не трогаем", async () => {
  const { client, uploads } = storageClient();
  const { fn, calls } = fakeFetch(201);
  const res = await uploadNewPrivateFile(client, PARAMS, env, fn);
  assertEquals(res.error, null);
  assertEquals(res.file?.bucket, FILES_BUCKET);
  assertMatch(res.file!.path, /^[0-9a-f-]{36}_otchet\.pdf$/);
  assertEquals(uploads, []);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, "PUT");
  assertEquals(calls[0].size, BODY.byteLength);
  const u = new URL(calls[0].url);
  assertEquals(u.pathname, `/swarm-files/f/${res.file!.path.slice(0, 36)}`);
  // ссылка подписана для put этого объекта, лимит = размер файла
  const v = await verifyFileToken(pair.publicKey, u.searchParams.get("t")!, "put", res.file!.path.slice(0, 36));
  assert(v.ok);
  if (v.ok) assertEquals(v.claims.max, BODY.byteLength);
});

Deno.test("uploadNewPrivateFile: env не задан → Storage, как раньше, сервис не вызывается", async () => {
  const { client, uploads } = storageClient();
  const { fn, calls } = fakeFetch(201);
  const res = await uploadNewPrivateFile(client, PARAMS, noEnv, fn);
  assertEquals(res.error, null);
  assertEquals(res.file?.bucket, "swarm_private");
  assertEquals(uploads.length, 1);
  assertStringIncludes(uploads[0], "swarm_private/uploads/cee/");
  assertEquals(calls.length, 0);
});

Deno.test("uploadNewPrivateFile: сервис не ответил → ошибка unavailable, файла нет, в Storage не дублируем", async () => {
  for (const status of [new Error("connect timeout"), 502]) {
    const { client, uploads } = storageClient();
    const res = await uploadNewPrivateFile(client, PARAMS, env, fakeFetch(status).fn);
    assertEquals(res.file, null);
    assertEquals(res.unavailable, true);
    assert(res.error);
    assertEquals(uploads, []);
  }
});

Deno.test("putFilesObject: пустое тело не отправляется", async () => {
  const { fn, calls } = fakeFetch(201);
  const res = await putFilesObject(
    filesStorage(env)!,
    "11111111-2222-4333-8444-555555555555_a.pdf",
    new Uint8Array(0),
    fn,
  );
  assertEquals(res.error, "empty file");
  assertEquals(calls.length, 0);
});

Deno.test("registerStorageFile: путь swarm-files пишется с bucket='swarm-files', ключ Storage — swarm_private", async () => {
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from: () => ({ insert: (r: Record<string, unknown>) => (inserts.push(r), Promise.resolve({ error: null })) }),
  } as unknown as SupabaseClient;
  await registerStorageFile(client, {
    path: "11111111-2222-4333-8444-555555555555_a.pdf",
    owner: { kind: "feedback" },
  });
  await registerStorageFile(client, {
    path: "uploads/cee/2026-10-13_11111111-2222-4333-8444-555555555555_a.pdf",
    owner: { kind: "feedback" },
  });
  assertEquals(inserts.map((r) => r.bucket), ["swarm-files", "swarm_private"]);
});

Deno.test("isFilesPath/bucketForPath: различают ключи swarm-files и Storage", () => {
  assert(isFilesPath("11111111-2222-4333-8444-555555555555_a.pdf"));
  assert(!isFilesPath("uploads/cee/2026-10-13_11111111-2222-4333-8444-555555555555_a.pdf"));
  assert(!isFilesPath("a.pdf"));
  assertEquals(bucketForPath("a.pdf", "swarm_private"), "swarm_private");
});

Deno.test("signedFilesGetUrl: get-ссылка с именем и типом из хвоста пути", async () => {
  const path = "11111111-2222-4333-8444-555555555555_otchet.pdf";
  const url = new URL(await signedFilesGetUrl(filesStorage(env)!, path, 60));
  assertEquals(url.pathname, "/swarm-files/f/11111111-2222-4333-8444-555555555555");
  const v = await verifyFileToken(pair.publicKey, url.searchParams.get("t")!, "get", path.slice(0, 36));
  assert(v.ok);
  if (v.ok) {
    assertEquals(v.claims.n, "otchet.pdf");
    assertEquals(v.claims.m, "application/pdf");
  }
});

Deno.test("externalFileUrl: файл swarm-files → get-ссылка сервиса; без ключа подписи — null", async () => {
  const path = "11111111-2222-4333-8444-555555555555_a.png";
  const client = {
    from: () => {
      const t: Record<string, unknown> = {};
      t.select = () => t;
      t.eq = () => t;
      t.maybeSingle = () => Promise.resolve({ data: { bucket: FILES_BUCKET } });
      return t;
    },
    storage: { from: () => ({ createSignedUrl: () => Promise.reject(new Error("Storage не должен вызываться")) }) },
  } as unknown as SupabaseClient;
  const saved = { b: Deno.env.get("FILES_BASE_URL"), k: Deno.env.get("FILES_SIGNING_KEY") };
  try {
    Deno.env.set("FILES_BASE_URL", ENV.FILES_BASE_URL);
    Deno.env.set("FILES_SIGNING_KEY", PKCS8);
    const url = await externalFileUrl(client, path);
    assertStringIncludes(url!, "https://files.test/swarm-files/f/11111111-2222-4333-8444-555555555555?t=");
    Deno.env.delete("FILES_SIGNING_KEY");
    assertEquals(await externalFileUrl(client, path), null);
  } finally {
    for (const [n, v] of [["FILES_BASE_URL", saved.b], ["FILES_SIGNING_KEY", saved.k]] as const) {
      if (v === undefined) Deno.env.delete(n);
      else Deno.env.set(n, v);
    }
  }
});

Deno.test("removeStorageObject: файл swarm-files — снимаем строку реестра, Storage.remove не вызываем", async () => {
  const path = "11111111-2222-4333-8444-555555555555_a.pdf";
  let registryDeleted = false;
  let storageRemoved = false;
  const client = {
    from: () => {
      const t: Record<string, unknown> = {};
      t.select = () => t;
      t.eq = () => t;
      t.maybeSingle = () => Promise.resolve({ data: { bucket: FILES_BUCKET, owner_kind: "feedback" } });
      t.delete = () => ({ eq: () => (registryDeleted = true, Promise.resolve({ error: null })) });
      return t;
    },
    storage: { from: () => ({ remove: () => (storageRemoved = true, Promise.resolve({ error: null })) }) },
  } as unknown as SupabaseClient;
  const res = await removeStorageObject(client, path);
  assertEquals(res.status, "removed");
  assert(registryDeleted);
  assert(!storageRemoved);
});
