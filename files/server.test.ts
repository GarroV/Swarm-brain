import { assertEquals } from "@std/assert";
import { type FilesConfig, handle } from "./server.ts";
import {
  type FileClaims,
  signFileToken,
} from "../supabase/functions/_shared/files-token.ts";

const K = "0b8e7c4e-2f1a-4c3d-9e8f-123456789abc";
const ORIGIN = "https://swarm-brain.pages.dev";

async function setup() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const cfg: FilesConfig = {
    dataDir: await Deno.makeTempDir(),
    verifyKey: kp.publicKey,
    allowedOrigins: [ORIGIN],
  };
  const exp = Math.floor(Date.now() / 1000) + 300;
  const tok = (c: Partial<FileClaims> & Pick<FileClaims, "op">) =>
    signFileToken(kp.privateKey, { k: K, exp, ...c });
  return { cfg, tok };
}

const at = (path: string, t: string) =>
  `http://x${path}?t=${encodeURIComponent(t)}`;

Deno.test("swarm-files: загрузка и скачивание — байты, имя и заголовки безопасности", async () => {
  const { cfg, tok } = await setup();
  const body = new TextEncoder().encode("%PDF-1.4 hello");
  const put = await handle(
    new Request(at(`/f/${K}`, await tok({ op: "put", max: 100 })), {
      method: "PUT",
      body,
      headers: { origin: ORIGIN },
    }),
    cfg,
  );
  assertEquals([put.status, await put.json()], [201, {
    size: body.byteLength,
  }]);
  assertEquals(put.headers.get("access-control-allow-origin"), ORIGIN);

  const get = await handle(
    new Request(
      at(
        `/swarm-files/f/${K}`,
        await tok({ op: "get", n: "План.pdf", m: "application/pdf" }),
      ),
    ),
    cfg,
  );
  assertEquals(get.status, 200);
  assertEquals(new Uint8Array(await get.arrayBuffer()), body);
  assertEquals(get.headers.get("content-type"), "application/pdf");
  assertEquals(
    get.headers.get("content-disposition")?.startsWith("inline;"),
    true,
  );
  assertEquals(get.headers.get("x-content-type-options"), "nosniff");
  assertEquals(
    get.headers.get("content-security-policy")?.startsWith("sandbox"),
    true,
  );

  const head = await handle(
    new Request(at(`/f/${K}`, await tok({ op: "get" })), { method: "HEAD" }),
    cfg,
  );
  assertEquals([head.status, head.headers.get("content-length")], [
    200,
    String(body.byteLength),
  ]);
});

Deno.test("swarm-files: больше лимита из ссылки — 413, на диске ничего не остаётся", async () => {
  const { cfg, tok } = await setup();
  const token = await tok({ op: "put", max: 10 });
  // Без Content-Length: лимит должен сработать по потоку, а не по заявленному размеру.
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(8));
      c.enqueue(new Uint8Array(8));
      c.close();
    },
  });
  const res = await handle(
    new Request(at(`/f/${K}`, token), { method: "PUT", body: stream }),
    cfg,
  );
  assertEquals(res.status, 413);
  assertEquals([...Deno.readDirSync(cfg.dataDir)].length, 0);
});

Deno.test("swarm-files: объект пишется один раз — повторная загрузка 409", async () => {
  const { cfg, tok } = await setup();
  const token = await tok({ op: "put", max: 10 });
  const send = () =>
    handle(
      new Request(at(`/f/${K}`, token), { method: "PUT", body: "abc" }),
      cfg,
    );
  assertEquals((await send()).status, 201);
  assertEquals((await send()).status, 409);
});

Deno.test("swarm-files: без ссылки, со ссылкой на чтение или на чужой объект — 403", async () => {
  const { cfg, tok } = await setup();
  const put = (t: string) =>
    handle(new Request(at(`/f/${K}`, t), { method: "PUT", body: "abc" }), cfg);
  assertEquals((await put("")).status, 403);
  assertEquals((await put(await tok({ op: "get" }))).status, 403);
  const other = await signFileToken(
    (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ]) as CryptoKeyPair).privateKey,
    { k: K, op: "put", exp: Math.floor(Date.now() / 1000) + 60, max: 10 },
  );
  assertEquals((await put(other)).status, 403);
  const get = await handle(
    new Request(
      at(
        `/f/${K}`,
        await tok({ op: "get", k: "11111111-2222-4333-8444-555555555555" }),
      ),
    ),
    cfg,
  );
  assertEquals(get.status, 403);
});

Deno.test("swarm-files: путь не из uuid (обход каталога) не доходит до диска", async () => {
  const { cfg, tok } = await setup();
  const res = await handle(
    new Request(at("/f/..%2F..%2Fetc%2Fpasswd", await tok({ op: "get" }))),
    cfg,
  );
  assertEquals(res.status, 404);
});

Deno.test("swarm-files: чужой origin не получает CORS-разрешения", async () => {
  const { cfg } = await setup();
  const res = await handle(
    new Request("http://x/f/" + K, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    }),
    cfg,
  );
  assertEquals(res.headers.get("access-control-allow-origin"), null);
});
