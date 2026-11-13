/**
 * Двойники внешнего мира для смоука пульса (T071): поддельные Telegram и OpenAI на одном порту.
 * Telegram складывает сообщения людям в `inbox`; OpenAI отвечает на обработку выгрузки рекордера.
 */
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";

export interface Message {
  readonly chat_id: number;
  readonly text: string;
}

export async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export function answer(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export function startTelegram(port: number, inbox: Message[]): ReturnType<typeof createServer> {
  const server = createServer((incoming, response) => {
    void readBody(incoming).then((raw) => {
      // Обработка выгрузки рекордера: поддельные Whisper и тезисы (как в scriba-watchdog-smoke.ts).
      if (incoming.url === "/v1/audio/transcriptions") {
        answer(response, 200, {
          text: "smoke takeover",
          language: "english",
          segments: [
            { start: 0, end: 9, text: "smoke takeover", no_speech_prob: 0.01, avg_logprob: -0.2 },
          ],
        });
        return;
      }
      if (incoming.url === "/v1/chat/completions") {
        answer(response, 200, {
          choices: [{ message: { content: "- smoke" }, finish_reason: "stop" }],
        });
        return;
      }
      if (incoming.url?.endsWith("/sendMessage") === true) {
        const body = JSON.parse(raw.toString("utf8") || "{}") as {
          chat_id?: unknown;
          text?: unknown;
        };
        inbox.push({
          chat_id: Number(body.chat_id),
          text: typeof body.text === "string" ? body.text : "",
        });
      }
      answer(response, 200, { ok: true, result: { message_id: inbox.length } });
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}

/**
 * Предзагрузка Deno-функций: api.telegram.org и api.openai.com → двойник на `port`.
 */
export function preloadFor(port: number): string {
  const source = `
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  for (const host of ["https://api.telegram.org", "https://api.openai.com"]) {
    if (url.startsWith(host + "/")) return real(url.replace(host, "http://127.0.0.1:${String(port)}"), init);
  }
  return real(input, init);
};`;
  return "data:application/typescript," + encodeURIComponent(source);
}
