import { afterEach, describe, expect, it } from "vitest";

import { AUDIO_ONLY_ARGS, AUDIO_ONLY_ENV, blockIncomingVideo, isAudioOnly } from "./audio-only.ts";
import { chromiumLaunchOptions } from "./browser.ts";

describe("isAudioOnly", () => {
  it("по умолчанию выключен", () => {
    expect(isAudioOnly({})).toBe(false);
    expect(isAudioOnly({ [AUDIO_ONLY_ENV]: "" })).toBe(false);
  });

  it("включают только «1» и «true»; опечатка режим не включает", () => {
    expect(isAudioOnly({ [AUDIO_ONLY_ENV]: "1" })).toBe(true);
    expect(isAudioOnly({ [AUDIO_ONLY_ENV]: " TRUE " })).toBe(true);
    expect(isAudioOnly({ [AUDIO_ONLY_ENV]: "yes" })).toBe(false);
    expect(isAudioOnly({ [AUDIO_ONLY_ENV]: "0" })).toBe(false);
  });
});

describe("флаги Chromium", () => {
  const off = chromiumLaunchOptions({ environment: {} });
  const on = chromiumLaunchOptions({ environment: { [AUDIO_ONLY_ENV]: "1" } });

  it("выключено: прежний набор, флаги экономии не добавляются", () => {
    for (const flag of AUDIO_ONLY_ARGS) expect(off.args).not.toContain(flag);
    expect(off.args).toContain("--disable-dev-shm-usage");
  });

  it("включено: флаги экономии на месте, --disable-dev-shm-usage снят", () => {
    for (const flag of AUDIO_ONLY_ARGS) expect(on.args).toContain(flag);
    expect(on.args).not.toContain("--disable-dev-shm-usage");
  });

  it("включено: --mute-audio по-прежнему не появляется", () => {
    expect(on.args).not.toContain("--mute-audio");
  });
});

type Direction = "sendrecv" | "recvonly" | "sendonly" | "inactive";

class FakeTransceiver {
  direction: Direction;
  stopped = false;
  readonly receiver: { track: { kind: string } };
  constructor(kind: string, direction: Direction) {
    this.direction = direction;
    this.receiver = { track: { kind } };
  }
}

class FakePeer {
  static readonly seen: Direction[][] = [];
  readonly transceivers: FakeTransceiver[] = [];
  getTransceivers(): FakeTransceiver[] {
    return this.transceivers;
  }
  createOffer(): Promise<string> {
    FakePeer.seen.push(this.transceivers.map((t) => t.direction));
    return Promise.resolve("offer");
  }
  createAnswer(): Promise<string> {
    FakePeer.seen.push(this.transceivers.map((t) => t.direction));
    return Promise.resolve("answer");
  }
  setLocalDescription(): Promise<void> {
    FakePeer.seen.push(this.transceivers.map((t) => t.direction));
    return Promise.resolve();
  }
  setRemoteDescription(): Promise<void> {
    // Площадка добавила m-line: трансивер появляется внутри вызова.
    this.transceivers.push(new FakeTransceiver("video", "sendrecv"));
    return Promise.resolve();
  }
}

function at(peer: FakePeer, index: number): FakeTransceiver {
  const found = peer.transceivers[index];
  if (found === undefined) throw new Error(`нет трансивера ${String(index)}`);
  return found;
}

const scope = globalThis as unknown as { RTCPeerConnection?: unknown };

function peerWithAudioAndVideo(): FakePeer {
  scope.RTCPeerConnection = FakePeer;
  blockIncomingVideo();
  const peer = new FakePeer();
  peer.transceivers.push(
    new FakeTransceiver("audio", "sendrecv"),
    new FakeTransceiver("video", "sendrecv"),
    new FakeTransceiver("video", "sendonly"),
  );
  return peer;
}

describe("blockIncomingVideo", () => {
  afterEach(() => {
    delete scope.RTCPeerConnection;
    FakePeer.seen.length = 0;
  });

  it("видео-трансиверы становятся inactive перед createAnswer, звук не тронут", async () => {
    const peer = peerWithAudioAndVideo();
    await peer.createAnswer();
    expect(FakePeer.seen[0]).toEqual(["sendrecv", "inactive", "inactive"]);
  });

  it("то же перед createOffer и неявным setLocalDescription()", async () => {
    const peer = peerWithAudioAndVideo();
    await peer.createOffer();
    at(peer, 1).direction = "recvonly";
    await peer.setLocalDescription();
    expect(FakePeer.seen).toEqual([
      ["sendrecv", "inactive", "inactive"],
      ["sendrecv", "inactive", "inactive"],
    ]);
  });

  it("m-line, пришедший с удалённым оффером, гасится сразу после setRemoteDescription", async () => {
    scope.RTCPeerConnection = FakePeer;
    blockIncomingVideo();
    const peer = new FakePeer();
    await peer.setRemoteDescription();
    expect(peer.transceivers[0]?.direction).toBe("inactive");
  });

  it("остановленный трансивер пропускается без ошибки", async () => {
    const peer = peerWithAudioAndVideo();
    at(peer, 1).stopped = true;
    await peer.createAnswer();
    expect(peer.transceivers[1]?.direction).toBe("sendrecv");
  });

  it("без RTCPeerConnection на странице ничего не делает и не падает", () => {
    expect(() => {
      blockIncomingVideo();
    }).not.toThrow();
  });
});
