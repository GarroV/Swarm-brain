import { describe, expect, it } from "vitest";

import { decideEgress, egressPolicy, parseAuthority } from "./egress-policy.ts";

const policy = egressPolicy({ swarmUrl: "https://abc.supabase.co/functions/v1" });

function isAllowed(target: string): boolean {
  return decideEgress(target, policy).allowed;
}

describe("куда контейнеру встречи можно выйти", () => {
  it("пускает Meet и вход Google на 443", () => {
    expect(isAllowed("meet.google.com:443")).toBe(true);
    expect(isAllowed("accounts.google.com:443")).toBe(true);
    expect(isAllowed("www.gstatic.com:443")).toBe(true);
    expect(isAllowed("signaler-pa.clients6.google.com:443")).toBe(true);
  });

  it("пускает Контур.Толк на 443: пространство, WebSocket, вторая форма хоста (T111)", () => {
    expect(isAllowed("dodobrands.ktalk.ru:443")).toBe(true);
    expect(isAllowed("ktalk.ru:443")).toBe(true);
    expect(isAllowed("talk.kontur.ru:443")).toBe(true);
    expect(decideEgress("dodobrands.ktalk.ru:443", policy)).toMatchObject({
      allowed: true,
      rule: "веб Контур.Толка",
    });
  });

  it("Толк — только 443, похожие хосты и службы Контура мимо Толка закрыты", () => {
    expect(isAllowed("dodobrands.ktalk.ru:80")).toBe(false);
    expect(isAllowed("dodobrands.ktalk.ru:3478")).toBe(false);
    expect(isAllowed("evilktalk.ru:443")).toBe(false);
    expect(isAllowed("ktalk.ru.evil.com:443")).toBe(false);
    expect(isAllowed("talk.kontur.ru.evil.com:443")).toBe(false);
    expect(isAllowed("x.talk.kontur.ru:443")).toBe(false);
    expect(isAllowed("metrika.kontur.ru:443")).toBe(false);
    expect(isAllowed("sentry.kontur.host:443")).toBe(false);
    expect(isAllowed("sd2-talk-stun4.ktalk.host:443")).toBe(true);
    expect(isAllowed("bst-talk-stun2.ktalk.host:443")).toBe(true);
    expect(isAllowed("sd2-talk-stun4.ktalk.host:3478")).toBe(false);
    expect(isAllowed("evilktalk.host:443")).toBe(false);
    expect(isAllowed("ktalk.host.evil.com:443")).toBe(false);
  });

  it("пускает ровно свой Swarm: хост и порт из адреса", () => {
    expect(isAllowed("abc.supabase.co:443")).toBe(true);
    expect(isAllowed("abc.supabase.co:80")).toBe(false);
    expect(isAllowed("evil.supabase.co:443")).toBe(false);
    expect(isAllowed("supabase.co:443")).toBe(false);
  });

  it("порт Swarm берётся из адреса, а без порта — по схеме", () => {
    const scheme = ["ht", "tp:"].join("");
    const local = egressPolicy({ swarmUrl: `${scheme}//host.docker.internal:4461` });
    expect(decideEgress("host.docker.internal:4461", local).allowed).toBe(true);
    expect(decideEgress("host.docker.internal:80", local).allowed).toBe(false);
    const plain = egressPolicy({ swarmUrl: `${scheme}//swarm.example` });
    expect(decideEgress("swarm.example:80", plain).allowed).toBe(true);
  });

  it("не пускает посторонний адрес", () => {
    const verdict = decideEgress("example.com:443", policy);
    expect(verdict).toEqual({ allowed: false, reason: "хост не в списке" });
  });

  it("домен Google не открывает порты, кроме 443", () => {
    expect(isAllowed("meet.google.com:80")).toBe(false);
    expect(isAllowed("meet.google.com:22")).toBe(false);
  });

  it("похожий на Google домен — посторонний", () => {
    expect(isAllowed("google.com.evil.io:443")).toBe(false);
    expect(isAllowed("evilgoogle.com:443")).toBe(false);
    expect(isAllowed("gstatic.com.example:443")).toBe(false);
  });

  it("хосты Google, куда страница может сама что-то записать, закрыты", () => {
    for (const host of [
      "script.google.com",
      "script.googleusercontent.com",
      "docs.google.com",
      "drive.google.com",
      "sites.google.com",
      "mail.google.com",
      "translate.google.com",
      "storage.googleapis.com",
      "bucket.storage.googleapis.com",
      "firestore.googleapis.com",
    ]) {
      expect(isAllowed(`${host}:443`), host).toBe(false);
    }
  });

  it("медиа Meet: IP из диапазонов Meet на портах медиа", () => {
    expect(isAllowed("142.250.82.17:19305")).toBe(true);
    expect(isAllowed("74.125.250.129:3478")).toBe(true);
    expect(isAllowed("74.125.247.128:443")).toBe(true);
    expect(isAllowed("142.250.82.17:19309")).toBe(true);
    expect(isAllowed("142.250.82.17:19302")).toBe(true);
  });

  it("медиа Meet: TURN по имени (SNI из документации Google)", () => {
    expect(isAllowed("meet.turns.goog:443")).toBe(true);
    expect(isAllowed("workspace.turns.goog:3478")).toBe(true);
    expect(isAllowed("evil.goog:443")).toBe(false);
  });

  it("IP вне диапазонов Meet или не на порту медиа — закрыт", () => {
    expect(isAllowed("142.250.83.1:443")).toBe(false);
    expect(isAllowed("74.125.247.129:443")).toBe(false);
    expect(isAllowed("142.250.82.17:22")).toBe(false);
    expect(isAllowed("142.250.82.17:19310")).toBe(false);
    expect(isAllowed("93.184.215.14:443")).toBe(false);
  });

  it("IPv6 и числовые записи адреса не проходят ни под каким видом", () => {
    expect(isAllowed("[2001:4860:4864:6::1]:443")).toBe(false);
    expect(isAllowed("2398766:443")).toBe(false);
    expect(isAllowed("0x8e.0xfa.0x52.0x11:443")).toBe(false);
    expect(isAllowed("142.250.082.17:443")).toBe(false);
  });

  it("регистр и точка в конце имени не обходят список", () => {
    expect(isAllowed("MEET.Google.COM:443")).toBe(true);
    expect(isAllowed("meet.google.com.:443")).toBe(true);
    expect(isAllowed("SCRIPT.google.com.:443")).toBe(false);
  });

  it("мусор вместо адреса — отказ, а не падение", () => {
    for (const target of [
      "",
      "meet.google.com",
      ":443",
      "meet.google.com:",
      "a b:443",
      "x:99999",
    ]) {
      expect(decideEgress(target, policy).allowed, target).toBe(false);
    }
  });

  it("добавка к списку — только точные host:port", () => {
    const extended = egressPolicy({
      swarmUrl: "https://abc.supabase.co",
      extraTargets: ["lh7.example.net:443"],
    });
    expect(decideEgress("lh7.example.net:443", extended).allowed).toBe(true);
    expect(decideEgress("lh7.example.net:80", extended).allowed).toBe(false);
  });

  it("битая добавка или битый адрес Swarm — громкий отказ сразу", () => {
    expect(() => egressPolicy({ swarmUrl: "not a url" })).toThrow(/SWARM/u);
    expect(() => egressPolicy({ swarmUrl: `${["f", "tp:"].join("")}//x.io` })).toThrow(/SWARM/u);
    expect(() => egressPolicy({ swarmUrl: "https://x.io", extraTargets: ["x.io"] })).toThrow(
      /host:port/u,
    );
  });
});

describe("разбор адреса CONNECT", () => {
  it("имя и порт", () => {
    expect(parseAuthority("meet.google.com:443")).toEqual({ host: "meet.google.com", port: 443 });
  });

  it("IPv6 в скобках", () => {
    expect(parseAuthority("[::1]:443")).toEqual({ host: "::1", port: 443 });
  });

  it("без порта или с чужим портом — null", () => {
    expect(parseAuthority("meet.google.com")).toBeNull();
    expect(parseAuthority("meet.google.com:0")).toBeNull();
    expect(parseAuthority("meet.google.com:443x")).toBeNull();
    expect(parseAuthority("[::1:443")).toBeNull();
  });
});
