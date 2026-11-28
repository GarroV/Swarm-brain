import { createServer } from "node:http";
import { Readable } from "node:stream";
import { signalHandler, type SignalHandlerOptions } from "./signal-handler.ts";

export async function signalServer(
  options: SignalHandlerOptions & {
    readonly host: string;
    readonly port: number;
  },
): Promise<{ close: () => Promise<void> }> {
  const handle = signalHandler(options);
  const server = createServer(
    { requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 8192 },
    (incoming, outgoing) => {
      let request: Request;
      try {
        const target = incoming.url ?? "/";
        if (!target.startsWith("/")) throw new TypeError("invalid request target");
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(",") : value);
        }
        const method = incoming.method ?? "GET";
        request = new Request(`https://scriba.internal${target}`, {
          method,
          headers,
          ...(method !== "GET" &&
            method !== "HEAD" && {
              body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
              duplex: "half",
            }),
        });
      } catch {
        outgoing.writeHead(400);
        outgoing.end();
        return;
      }
      void handle(request)
        .then(async (response) => {
          const body = await response.text();
          if (outgoing.destroyed) return;
          outgoing.writeHead(response.status, Object.fromEntries(response.headers));
          outgoing.end(body);
        })
        .catch(() => {
          if (outgoing.destroyed || outgoing.headersSent) outgoing.destroy();
          else {
            outgoing.writeHead(500);
            outgoing.end();
          }
        });
    },
  );
  server.maxHeadersCount = 20;
  server.timeout = 60_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeIdleConnections();
      }),
  };
}
