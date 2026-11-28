import { createHash, timingSafeEqual } from "node:crypto";

interface WorkSignal {
  readonly kind: "invite" | "calendar";
  readonly id: string;
}

export interface SignalHandlerOptions {
  readonly secret: string;
  readonly dispatch: (signal: WorkSignal) => Promise<void>;
  readonly log: (line: string) => void;
  readonly maxInFlight?: number;
  readonly bodyTimeoutMs?: number;
}

const BODY_LIMIT = 1024;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

class BodyError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("invalid signal body");
    this.status = status;
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

async function readSignal(request: Request, timeoutMs: number): Promise<WorkSignal> {
  const body = request.body as ReadableStream<Uint8Array> | null;
  const reader = body?.getReader();
  if (reader === undefined) throw new BodyError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new BodyError(408));
      void reader.cancel().catch(() => {
        // Cancellation can race a disconnected sender.
      });
    }, timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) throw new BodyError(413);
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new BodyError(400);
    const fields = parsed as Record<string, unknown>;
    if (
      Object.keys(fields).length !== 2 ||
      (fields.kind !== "invite" && fields.kind !== "calendar") ||
      typeof fields.id !== "string" ||
      !UUID.test(fields.id)
    )
      throw new BodyError(400);
    return { kind: fields.kind, id: fields.id.toLowerCase() };
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {
      // Cancellation can race a disconnected sender.
    });
  }
}

function reply(status: number): Response {
  return Response.json(
    { ok: status === 200 },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function dispatchWork(
  signal: WorkSignal,
  dispatch: SignalHandlerOptions["dispatch"],
): Promise<void> {
  await dispatch(signal);
}

/**
 * Acknowledges only a completed conditional take/start; failures remain eligible for redelivery.
 */
export function signalHandler(
  options: SignalHandlerOptions,
): (request: Request) => Promise<Response> {
  if (options.secret.length < 32)
    throw new Error("SCRIBA_SIGNAL_SECRET must contain at least 32 characters");
  const expected = digest(options.secret);
  const pending = new Map<string, Promise<void>>();
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== "/signal" || url.search !== "") return reply(404);
    if (request.method !== "POST") return reply(405);
    if (!timingSafeEqual(expected, digest(request.headers.get("X-Scriba-Signal-Secret") ?? "")))
      return reply(401);
    if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !== "application/json")
      return reply(415);
    let signal: WorkSignal;
    try {
      signal = await readSignal(request, options.bodyTimeoutMs ?? 5000);
    } catch (error) {
      return reply(error instanceof BodyError ? error.status : 400);
    }
    const key = `${signal.kind}:${signal.id}`;
    let work = pending.get(key);
    if (work === undefined) {
      if (pending.size >= (options.maxInFlight ?? 32)) return reply(503);
      work = dispatchWork(signal, options.dispatch);
      pending.set(key, work);
      void work
        .finally(() => {
          if (pending.get(key) === work) pending.delete(key);
        })
        .catch(() => {
          // Cancellation can race a disconnected sender.
        });
    }
    try {
      await work;
      return reply(200);
    } catch {
      options.log(`signal ${signal.kind} ${signal.id}: processing failed; delivery must retry`);
      return reply(503);
    }
  };
}
