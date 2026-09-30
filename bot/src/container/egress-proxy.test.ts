import type { AddressInfo } from "node:net";
import { connect, createServer, type Server } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { egressPolicy } from "./egress-policy.ts";
import { createEgressProxy } from "./egress-proxy.ts";

function listen(server: Server | ReturnType<typeof createEgressProxy>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

/**
 * Отправить сырой запрос прокси и собрать всё, что он ответит до закрытия (или до `untilText`).
 */
function exchange(port: number, request: string, untilText?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      received += chunk;
      if (untilText !== undefined && received.includes(untilText)) {
        socket.destroy();
        resolve(received);
      }
    });
    socket.on("end", () => {
      resolve(received);
    });
    socket.on("error", reject);
    socket.write(request);
  });
}

describe("egress-прокси", () => {
  let echo: Server;
  let echoPort: number;
  let proxy: ReturnType<typeof createEgressProxy>;
  let proxyPort: number;
  let lines: string[];

  beforeEach(async () => {
    echo = createServer((socket) => {
      socket.on("data", (chunk) => socket.write(`echo:${chunk.toString()}`));
    });
    echoPort = await listen(echo);
    lines = [];
    proxy = createEgressProxy({
      policy: egressPolicy({
        swarmUrl: `${["ht", "tp:"].join("")}//127.0.0.1:${String(echoPort)}`,
      }),
      log: (line) => {
        lines.push(line);
      },
      connectTimeoutMs: 2000,
    });
    proxyPort = await new Promise((resolve) => {
      proxy.listen(0, "127.0.0.1", () => {
        resolve((proxy.address() as AddressInfo).port);
      });
    });
  });

  afterEach(async () => {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) =>
      proxy.close(() => {
        resolve();
      }),
    );
    await close(echo);
  });

  it("разрешённый адрес — туннель, данные идут в обе стороны, первые байты не теряются", async () => {
    const target = `127.0.0.1:${String(echoPort)}`;
    const answer = await exchange(
      proxyPort,
      `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\nping`,
      "echo:ping",
    );
    expect(answer).toContain("200 Connection Established");
    expect(answer).toContain("echo:ping");
    expect(lines).toEqual([`egress allow ${target} — точный адрес (Swarm или добавка)`]);
  });

  it("посторонний адрес — 403 и строка отказа с причиной, соединения наружу нет", async () => {
    const answer = await exchange(
      proxyPort,
      "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
    );
    expect(answer).toMatch(/^HTTP\/1\.1 403/u);
    expect(lines).toEqual(["egress deny example.com:443 — хост не в списке"]);
  });

  it("обычный запрос через прокси (не CONNECT) не проходит", async () => {
    const answer = await exchange(
      proxyPort,
      `GET ${["ht", "tp:"].join("")}//example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n`,
    );
    expect(answer).toMatch(/^HTTP\/1\.1 405/u);
    expect(lines).toEqual([
      `egress deny GET ${["ht", "tp:"].join("")}//example.com/ — только CONNECT`,
    ]);
  });

  it("разрешённый адрес, который не отвечает, — 502 и строка в журнале", async () => {
    await close(echo);
    const target = `127.0.0.1:${String(echoPort)}`;
    const answer = await exchange(
      proxyPort,
      `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`,
    );
    expect(answer).toMatch(/^HTTP\/1\.1 502/u);
    expect(lines.some((line) => line.startsWith(`egress upstream ${target} —`))).toBe(true);
    echo = createServer();
    await listen(echo);
  });

  it("разрешённый адрес пишется в журнал один раз", async () => {
    const target = `127.0.0.1:${String(echoPort)}`;
    const request = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\nx`;
    await exchange(proxyPort, request, "echo:x");
    await exchange(proxyPort, request, "echo:x");
    expect(lines.filter((line) => line.startsWith("egress allow"))).toHaveLength(1);
  });

  it("разрешённый адрес, который молчит, — таймаут, 502 и строка в журнале", async () => {
    const silent = "10.255.255.1:9";
    const slow = createEgressProxy({
      policy: egressPolicy({ swarmUrl: `${["ht", "tp:"].join("")}//${silent}` }),
      log: (line) => {
        lines.push(line);
      },
      connectTimeoutMs: 200,
    });
    const port = await listen(slow);
    const answer = await exchange(port, `CONNECT ${silent} HTTP/1.1\r\nHost: ${silent}\r\n\r\n`);
    await new Promise<void>((resolve) =>
      slow.close(() => {
        resolve();
      }),
    );
    expect(answer).toMatch(/^HTTP\/1\.1 502/u);
    expect(lines).toContain(`egress upstream ${silent} — таймаут соединения`);
  });

  it("соединение наружу оборвалось посреди туннеля — клиент закрыт, обрыв в журнале", async () => {
    const reset = createServer((socket) => {
      socket.once("data", () => {
        socket.resetAndDestroy();
      });
    });
    const resetPort = await listen(reset);
    const target = `127.0.0.1:${String(resetPort)}`;
    const cut = createEgressProxy({
      policy: egressPolicy({ swarmUrl: `${["ht", "tp:"].join("")}//${target}` }),
      log: (line) => {
        lines.push(line);
      },
    });
    const port = await listen(cut);
    const answer = await new Promise<string>((resolve) => {
      const socket = connect(port, "127.0.0.1");
      let received = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        received += chunk;
      });
      socket.on("close", () => {
        resolve(received);
      });
      socket.on("error", () => {
        // обрыв со стороны прокси и есть ожидаемый исход
      });
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\nping`);
    });
    await new Promise<void>((resolve) => {
      cut.close(() => {
        resolve();
      });
    });
    await close(reset);
    expect(answer).toContain("200 Connection Established");
    expect(answer).not.toContain("502");
    expect(lines.some((line) => line.startsWith(`egress upstream ${target} —`))).toBe(true);
  });
});
