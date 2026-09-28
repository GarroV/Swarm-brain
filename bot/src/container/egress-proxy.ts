/**
 * Egress-прокси стенда: единственная дверь наружу для контейнеров встреч.
 *
 * Только CONNECT: браузер и node-клиент Swarm ходят через туннель, прокси видит лишь
 * `host:port` и спрашивает `decideEgress`. Обычный запрос через прокси (absolute-form) не
 * пропускается вовсе — туннеля хватает всем потребителям, а второй путь пришлось бы
 * проверять вторым правилом.
 *
 * Каждый отказ пишется строкой `egress deny <host:port> — <причина>`: если живой встрече не
 * хватило хоста, это видно в журнале, а не угадывается по тишине записи. Разрешённый адрес
 * пишется один раз, чтобы медиа-туннели не заливали журнал.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";

import { decideEgress, type EgressPolicy } from "./egress-policy.ts";

const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;

export interface EgressProxyOptions {
  readonly policy: EgressPolicy;
  readonly log: (line: string) => void;
  readonly connectTimeoutMs?: number;
}

function refuse(client: Duplex, status: string): void {
  client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function tunnel(
  client: Duplex,
  head: Buffer,
  host: string,
  port: number,
  options: EgressProxyOptions,
  target: string,
): void {
  const upstream: Socket = connect({ host, port });
  upstream.setTimeout(options.connectTimeoutMs ?? UPSTREAM_CONNECT_TIMEOUT_MS, () => {
    upstream.destroy(new Error("таймаут соединения"));
  });
  upstream.once("connect", () => {
    upstream.setTimeout(0);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", (error) => {
    options.log(`egress upstream ${target} — ${error.message}`);
    if (client.writable && upstream.bytesRead === 0 && upstream.bytesWritten === 0) {
      refuse(client, "502 Bad Gateway");
    } else {
      client.destroy();
    }
  });
  client.on("error", () => upstream.destroy());
  client.on("close", () => upstream.destroy());
}

export function createEgressProxy(options: EgressProxyOptions): Server {
  const seen = new Set<string>();
  const server = createServer((request, response) => {
    options.log(`egress deny ${request.method ?? "?"} ${request.url ?? ""} — только CONNECT`);
    response.writeHead(405, { Connection: "close" }).end();
  });
  server.on("connect", (request: IncomingMessage, client: Duplex, head: Buffer) => {
    const target = request.url ?? "";
    const verdict = decideEgress(target, options.policy);
    if (!verdict.allowed) {
      options.log(`egress deny ${target} — ${verdict.reason}`);
      refuse(client, "403 Forbidden");
      return;
    }
    if (!seen.has(target)) {
      seen.add(target);
      options.log(`egress allow ${target} — ${verdict.rule}`);
    }
    tunnel(client, head, verdict.host, verdict.port, options, target);
  });
  return server;
}
