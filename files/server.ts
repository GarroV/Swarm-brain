// swarm-files — хранилище байтов файлов к задачам на MUSPELHEIM (решение владельца 2026-09-30,
// docs/decisions/2026-09-30-task-files-on-muspelheim.md).
//
// Сервис глупый нарочно: базы не знает, прав не проверяет. Он принимает и отдаёт объект только
// по ссылке, подписанной swarm-api (`_shared/files-token.ts`): подпись сверяется открытым ключом
// FILES_PUBLIC_KEY. Закрытого ключа здесь нет — взлом сервера не даёт выпустить ни одной ссылки.
//
//   PUT  /f/<uuid>?t=<ссылка>   — принять байты (не больше `max` из ссылки), объект пишется один раз
//   GET  /f/<uuid>?t=<ссылка>   — отдать (имя и тип — из ссылки); HEAD — только размер
//   GET  /health                — жив ли сервис и сколько места на диске

import {
  type FileOp,
  importVerifyKey,
  verifyFileToken,
} from "../supabase/functions/_shared/files-token.ts";
import {
  contentDisposition,
  isInline,
} from "../supabase/functions/_shared/task-files.ts";

export type FilesConfig = {
  dataDir: string;
  verifyKey: CryptoKey;
  allowedOrigins: string[];
};

// Funnel монтирует сервис под путём (/swarm-files) — принимаем адрес и с ним, и без него.
const OBJECT_RE = /^(?:\/swarm-files)?\/f\/([0-9a-f-]{36})$/;
const HEALTH_RE = /^(?:\/swarm-files)?\/health$/;

function cors(req: Request, cfg: FilesConfig): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!cfg.allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function reply(
  req: Request,
  cfg: FilesConfig,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...cors(req, cfg),
      ...extra,
    },
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

export async function handle(
  req: Request,
  cfg: FilesConfig,
): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(req, cfg) });
  }
  if (HEALTH_RE.test(url.pathname) && req.method === "GET") {
    return reply(req, cfg, 200, { ok: true });
  }

  const m = url.pathname.match(OBJECT_RE);
  if (!m) return reply(req, cfg, 404, { error: "not found" });
  const key = m[1];
  const op: FileOp = req.method === "PUT" ? "put" : "get";
  if (!["PUT", "GET", "HEAD"].includes(req.method)) {
    return reply(req, cfg, 405, { error: "method" });
  }

  const check = await verifyFileToken(
    cfg.verifyKey,
    url.searchParams.get("t") ?? "",
    op,
    key,
  );
  if (!check.ok) return reply(req, cfg, 403, { error: check.reason });
  const path = `${cfg.dataDir}/${key}`;

  if (op === "put") return await receive(req, cfg, path, check.claims.max!);

  let size: number;
  try {
    size = (await Deno.stat(path)).size;
  } catch {
    return reply(req, cfg, 404, { error: "not found" });
  }
  const name = check.claims.n;
  const headers: Record<string, string> = {
    "Content-Length": String(size),
    "Content-Type": check.claims.m ?? "application/octet-stream",
    "Cache-Control": "private, max-age=600",
    "X-Content-Type-Options": "nosniff",
    // Даже открытый в браузере файл не может выполнить скрипт от имени сервиса.
    "Content-Security-Policy":
      "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    ...cors(req, cfg),
  };
  if (name) {
    headers["Content-Disposition"] = contentDisposition(name, isInline(name));
  }
  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  const file = await Deno.open(path, { read: true });
  return new Response(file.readable, { status: 200, headers });
}

/** Принять тело во временный файл, считая байты; больше `max` — оборвать и ничего не оставить. */
async function receive(
  req: Request,
  cfg: FilesConfig,
  path: string,
  max: number,
): Promise<Response> {
  if (await exists(path)) {
    return reply(req, cfg, 409, { error: "already stored" });
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    return reply(req, cfg, 413, { error: "too large" });
  }
  if (!req.body) return reply(req, cfg, 400, { error: "empty body" });

  const tmp = `${path}.part-${crypto.randomUUID()}`;
  const out = await Deno.open(tmp, { write: true, createNew: true });
  let written = 0;
  try {
    for await (const chunk of req.body) {
      written += chunk.byteLength;
      if (written > max) throw new RangeError("too large");
      let off = 0;
      while (off < chunk.byteLength) {
        off += await out.write(chunk.subarray(off));
      }
    }
    out.close();
  } catch (e) {
    try {
      out.close();
    } catch { /* уже закрыт */ }
    await Deno.remove(tmp).catch(() => {});
    if (e instanceof RangeError) {
      return reply(req, cfg, 413, { error: "too large" });
    }
    console.error("swarm-files: приём оборвался", e);
    return reply(req, cfg, 400, { error: "upload interrupted" });
  }
  if (written === 0) {
    await Deno.remove(tmp).catch(() => {});
    return reply(req, cfg, 400, { error: "empty body" });
  }
  await Deno.rename(tmp, path);
  return reply(req, cfg, 201, { size: written });
}

if (import.meta.main) {
  const publicKey = Deno.env.get("FILES_PUBLIC_KEY");
  if (!publicKey) {
    throw new Error(
      "FILES_PUBLIC_KEY не задан — без него сервис не проверит ни одной ссылки",
    );
  }
  const cfg: FilesConfig = {
    dataDir: Deno.env.get("FILES_DATA_DIR") ?? "/data",
    verifyKey: await importVerifyKey(publicKey),
    allowedOrigins: (Deno.env.get("FILES_ALLOWED_ORIGINS") ?? "").split(",")
      .map((s) => s.trim()).filter(Boolean),
  };
  await Deno.mkdir(cfg.dataDir, { recursive: true });
  Deno.serve({
    port: Number(Deno.env.get("PORT") ?? 8031),
    hostname: "0.0.0.0",
  }, (req) => handle(req, cfg));
}
