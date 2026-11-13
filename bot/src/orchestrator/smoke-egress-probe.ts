/**
 * Проба выхода из контейнера встречи наружу — сценарий egress смоука оркестратора (T178).
 */
// Адреса — 1.1.1.1: достижим из обычной сети Docker (проверено), поэтому отказ здесь значит
// «нет маршрута», а не «адрес умер». Ждём именно ENETUNREACH, а не любой сбой.
export const PROBE = `
const net = require("node:net");
const dgram = require("node:dgram");
const dns = require("node:dns/promises");
const t = (ms) => AbortSignal.timeout(ms);
const tryIt = async (name, fn) => { try { console.log(name, "OK", await fn()); } catch (e) { console.log(name, "FAIL", e.cause?.code ?? e.code ?? e.message); } };
(async () => {
  await tryIt("fetch-example", async () => (await fetch("https://example.com/", { signal: t(10000) })).status);
  await tryIt("fetch-meet", async () => (await fetch("https://meet.google.com/", { signal: t(15000), redirect: "manual" })).status);
  await tryIt("tcp-direct", () => new Promise((ok, no) => { const s = net.connect(443, "1.1.1.1"); s.setTimeout(5000, () => no(new Error("timeout"))); s.on("connect", () => { s.destroy(); ok("connected"); }); s.on("error", no); }));
  await tryIt("dns-example", async () => (await dns.lookup("example.com")).address);
  await tryIt("udp-direct", () => new Promise((ok, no) => { const u = dgram.createSocket("udp4"); u.send(Buffer.from("x"), 53, "1.1.1.1", (e) => { u.close(); e ? no(e) : ok("sent"); }); }));
})();
`;
