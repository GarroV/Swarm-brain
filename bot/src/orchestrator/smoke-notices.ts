/**
 * Двойник `POST /meeting-notice` для живого смоука оркестратора.
 *
 * `fake-swarm` (блок swarm-client) этого эндпоинта не знает, а трогать чужой файл блок
 * orchestrator не вправе. Поэтому смоук ставит перед ним прокси: `/meeting-notice` отвечает
 * сам по правилам контракта notices (docs/furca/blocks/notices.md), всё остальное пересылает
 * в `fake-swarm` байт в байт.
 *
 * Правила, которые двойник держит, — ровно те, на которые опирается бот:
 *  - `attempt` в теле → 400 (номер считает сервер);
 *  - нужен ровно один из `meeting_id` / `meeting_key`;
 *  - номер отправки считается на пару (привязка, вид); `door_waiting` — потолок 2:
 *    вторая отправка отвечает `should_leave:true`, третья — 409.
 */
import { type IncomingMessage, type ServerResponse, createServer, request } from "node:http";

const DOOR_CEILING = 2;

interface RecordedNotice {
  readonly onBehalfOf: string;
  readonly body: Record<string, unknown>;
}

export interface NoticeProxy {
  readonly notices: RecordedNotice[];
  close(): Promise<void>;
}

async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function answer(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function forward(
  incoming: IncomingMessage,
  raw: Buffer,
  response: ServerResponse,
  upstreamPort: number,
): void {
  const upstream = request(
    {
      host: "127.0.0.1",
      port: upstreamPort,
      method: incoming.method,
      path: incoming.url,
      headers: incoming.headers,
    },
    (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    answer(response, 502, { ok: false, error: `прокси смоука: ${error.message}` });
  });
  upstream.end(raw);
}

function handleNotice(
  body: Record<string, unknown>,
  onBehalfOf: string,
  counts: Map<string, number>,
  recorded: RecordedNotice[],
): { status: number; body: unknown } {
  if ("attempt" in body)
    return { status: 400, body: { ok: false, error: "attempt is server-side" } };
  const target = body.meeting_id ?? body.meeting_key;
  if (typeof target !== "string" || ("meeting_id" in body && "meeting_key" in body)) {
    return { status: 400, body: { ok: false, error: "exactly one of meeting_id / meeting_key" } };
  }
  const key = `${target}:${String(body.kind)}`;
  const attempt = (counts.get(key) ?? 0) + 1;
  counts.set(key, attempt);
  const isDoor = body.kind === "door_waiting";
  if (isDoor && attempt > DOOR_CEILING) {
    return {
      status: 409,
      body: { ok: false, delivered: false, error: "ceiling", should_leave: true },
    };
  }
  recorded.push({ onBehalfOf, body });
  return {
    status: 200,
    body: { ok: true, delivered: true, attempt, should_leave: isDoor && attempt >= DOOR_CEILING },
  };
}

export async function startNoticeProxy(port: number, upstreamPort: number): Promise<NoticeProxy> {
  const notices: RecordedNotice[] = [];
  const counts = new Map<string, number>();
  const server = createServer((incoming, response) => {
    void readBody(incoming).then((raw) => {
      if (incoming.method !== "POST" || incoming.url !== "/meeting-notice") {
        forward(incoming, raw, response, upstreamPort);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        answer(response, 400, { ok: false, error: "body is not JSON" });
        return;
      }
      const onBehalfOf = incoming.headers["x-on-behalf-of"];
      const result = handleNotice(
        parsed as Record<string, unknown>,
        typeof onBehalfOf === "string" ? onBehalfOf : "",
        counts,
        notices,
      );
      answer(response, result.status, result.body);
    });
  });
  // Как и fake-swarm — только loopback: Docker Desktop доводит host.docker.internal до него.
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    notices,
    close: async (): Promise<void> =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
