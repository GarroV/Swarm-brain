import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { relyingPartyFor } from "./rp.ts";
import { LEGACY_HOST, PRIMARY_HOST } from "./rp.ts";

Deno.test("боевые адреса принимаются, RP ID — хост адреса", () => {
  assertEquals(relyingPartyFor(`https://${PRIMARY_HOST}`)?.rpID, "swarm-team.app");
  assertEquals(relyingPartyFor(`https://${LEGACY_HOST}`)?.rpID, "swarm-brain.pages.dev");
});

Deno.test("превью ветки допустимо, чужие и кривые адреса — нет", () => {
  assertEquals(relyingPartyFor("https://feat-x.swarm-brain.pages.dev")?.rpID, "feat-x.swarm-brain.pages.dev");
  for (
    const bad of [
      "http://swarm-team.app",
      "https://evil.example",
      "https://swarm-team.app.evil.example",
      "https://evil-swarm-team.app",
      "https://swarm-brain.pages.dev.evil.example",
      "https://a.b.swarm-brain.pages.dev",
      "https://swarm-team.app/",
      "https://swarm-team.app:8443",
      "evil https://a.swarm-brain.pages.dev",
      "https://evil.example/?https://a.swarm-brain.pages.dev",
      "",
      null,
      42,
    ]
  ) assertEquals(relyingPartyFor(bad), null, String(bad));
});
