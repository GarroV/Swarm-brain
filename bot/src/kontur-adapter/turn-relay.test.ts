import { afterEach, describe, expect, it } from "vitest";

import { KONTUR_TURN_RELAYS, pinTurnRelays } from "./turn-relay.ts";

interface Captured {
  readonly config: { readonly iceServers?: readonly { readonly urls: unknown }[] } | undefined;
}

const scope = globalThis as unknown as Record<string, unknown>;
const saved = scope.RTCPeerConnection;

function install(): Captured[] {
  const created: Captured[] = [];
  class FakePeer {
    readonly config: Captured["config"];
    constructor(config?: Captured["config"]) {
      this.config = config;
      created.push(this);
    }
  }
  scope.RTCPeerConnection = FakePeer;
  pinTurnRelays({ relays: KONTUR_TURN_RELAYS, peersGlobal: "__test_peers" });
  return created;
}

function urlsOf(config: Captured["config"]): unknown[] {
  return (config?.iceServers ?? []).map((server) => server.urls);
}

afterEach(() => {
  scope.RTCPeerConnection = saved;
  delete scope.__test_peers;
});

describe("pinTurnRelays", () => {
  it("меняет немые TURN Толка на проверенные и не трогает UDP-серверы", () => {
    const created = install();
    const Peer = scope.RTCPeerConnection as new (config: unknown) => object;

    const peer = new Peer({
      iceServers: [
        { urls: "turn:sts-talk-stun3.ktalk.host:34788", username: "u", credential: "c" },
        {
          urls: "turns:sd2-talk-stun4.ktalk.host:443?transport=tcp",
          username: "u",
          credential: "c",
        },
        {
          urls: "turns:bst-talk-stun2.ktalk.host:443?transport=tcp",
          username: "u",
          credential: "c",
        },
      ],
    });

    expect(urlsOf(created[0]?.config)).toEqual([
      "turn:sts-talk-stun3.ktalk.host:34788",
      "turns:dtl-talk-stun5.ktalk.host:443?transport=tcp",
      "turns:bst-talk-stun7.ktalk.host:443?transport=tcp",
    ]);
    expect(peer).toBe(created[0]);
  });

  it("оставляет уже проверенный сервер и сохраняет учётные данные", () => {
    const created = install();
    const Peer = scope.RTCPeerConnection as new (config: unknown) => object;

    const peer = new Peer({
      iceServers: [
        { urls: ["turns:bst-talk-stun7.ktalk.host:443?transport=tcp"], credential: "c" },
      ],
    });

    expect(peer).toBe(created[0]);
    expect(created[0]?.config).toEqual({
      iceServers: [
        { urls: ["turns:bst-talk-stun7.ktalk.host:443?transport=tcp"], credential: "c" },
      ],
    });
  });

  it("не трогает чужие хосты и складывает соединения для статистики", () => {
    const created = install();
    const Peer = scope.RTCPeerConnection as new (config: unknown) => object;

    const peer = new Peer({ iceServers: [{ urls: "turns:relay.example.com:443" }] });

    expect(urlsOf(created[0]?.config)).toEqual(["turns:relay.example.com:443"]);
    expect(scope.__test_peers).toEqual([peer]);
  });
});
