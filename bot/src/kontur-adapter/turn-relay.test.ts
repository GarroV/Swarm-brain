import { afterEach, describe, expect, it } from "vitest";

import { KONTUR_TURN_RELAYS, collectAudioHealth, pinTurnRelays } from "./turn-relay.ts";

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

function fakePeer(stats: readonly Record<string, unknown>[]): object {
  return {
    getStats: () =>
      Promise.resolve({
        forEach: (callback: (stat: Record<string, unknown>) => void) => {
          for (const stat of stats) callback(stat);
        },
      }),
  };
}

describe("collectAudioHealth", () => {
  it("складывает входящие аудиопакеты и называет выбранный TURN", async () => {
    scope.__test_peers = [
      fakePeer([
        { id: "a", type: "inbound-rtp", kind: "audio", packetsReceived: 120 },
        { id: "v", type: "inbound-rtp", kind: "video", packetsReceived: 999 },
        { id: "t", type: "transport", selectedCandidatePairId: "p" },
        { id: "p", type: "candidate-pair", localCandidateId: "l" },
        {
          id: "l",
          type: "local-candidate",
          candidateType: "relay",
          url: "turns:dtl-talk-stun5.ktalk.host:443",
        },
      ]),
      fakePeer([{ id: "b", type: "inbound-rtp", kind: "audio", packetsReceived: 5 }]),
    ];

    const health = await collectAudioHealth("__test_peers");

    expect(health).toEqual({
      peers: 2,
      packets: 125,
      path: "relay turns:dtl-talk-stun5.ktalk.host:443",
    });
  });

  it("без соединений — ноль и пути нет", async () => {
    const health = await collectAudioHealth("__test_peers");

    expect(health).toEqual({ peers: 0, packets: 0, path: null });
  });

  it("пара без локального кандидата пути не даёт", async () => {
    scope.__test_peers = [
      fakePeer([
        { id: "t", type: "transport", selectedCandidatePairId: "p" },
        { id: "p", type: "candidate-pair" },
        { id: "a", type: "inbound-rtp", kind: "audio" },
      ]),
    ];

    const health = await collectAudioHealth("__test_peers");

    expect(health).toEqual({ peers: 1, packets: 0, path: null });
  });
});

describe("pinTurnRelays без WebRTC", () => {
  it("на странице без RTCPeerConnection ничего не делает", () => {
    delete scope.RTCPeerConnection;

    pinTurnRelays({ relays: KONTUR_TURN_RELAYS, peersGlobal: "__test_peers" });

    expect(scope.RTCPeerConnection).toBeUndefined();
    expect(scope.__test_peers).toBeUndefined();
  });

  it("конфиг без iceServers и сервер без urls проходят как есть", () => {
    const created = install();
    const Peer = scope.RTCPeerConnection as new (config?: unknown) => object;

    const bare = new Peer();
    const odd = new Peer({
      iceServers: [{ username: "u" }, { url: "turns:sd2-talk-stun4.ktalk.host:443" }],
    });

    expect([bare, odd]).toEqual(created);
    expect(created[0]?.config).toBeUndefined();
    expect(urlsOf(created[1]?.config)).toEqual([undefined, "turns:dtl-talk-stun5.ktalk.host:443"]);
  });
});
