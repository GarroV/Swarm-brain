// Переезд на swarm-team.app (issue #753). Ошибка здесь молчаливая и бьёт по людям: переадресованный
// /api/* роняет сохранения в открытой вкладке, задетое превью ветки пропадает, а «не боевой» новый
// домен прячет вход через Google и Telegram.
import { assertEquals } from "@std/assert";
import { legacyRedirectTarget } from "../../functions/_middleware.ts";
import { isProdHost } from "./prodHosts.ts";

Deno.test("оба адреса боевые, превью и чужие — нет", () => {
  assertEquals(isProdHost("swarm-team.app"), true);
  assertEquals(isProdHost("SWARM-TEAM.APP"), true);
  assertEquals(isProdHost("swarm-brain.pages.dev"), true);
  assertEquals(isProdHost("a1b2c3.swarm-brain.pages.dev"), false);
  assertEquals(isProdHost("evil-swarm-team.app"), false);
});

Deno.test("выключатель выключен — никакой переадресации", () => {
  assertEquals(legacyRedirectTarget("https://swarm-brain.pages.dev/", false), null);
});

Deno.test("старый адрес → тот же путь и параметры на новом", () => {
  assertEquals(legacyRedirectTarget("https://swarm-brain.pages.dev/", true), "https://swarm-team.app/");
  assertEquals(
    legacyRedirectTarget("https://swarm-brain.pages.dev/login?next=%2Ftask%2F1", true),
    "https://swarm-team.app/login?next=%2Ftask%2F1",
  );
  assertEquals(legacyRedirectTarget("https://swarm-brain.pages.dev/s/k7Fq2a", true), "https://swarm-team.app/s/k7Fq2a");
});

Deno.test("API, превью веток и новый адрес не переадресуются", () => {
  assertEquals(legacyRedirectTarget("https://swarm-brain.pages.dev/api/tasks", true), null);
  assertEquals(legacyRedirectTarget("https://swarm-brain.pages.dev/api", true), null);
  assertEquals(legacyRedirectTarget("https://a1b2c3.swarm-brain.pages.dev/", true), null);
  assertEquals(legacyRedirectTarget("https://swarm-team.app/", true), null);
});

Deno.test("демо-вход переезжает на новый хост целиком, с ключом — иначе кука остаётся на старом (#816)", () => {
  assertEquals(
    legacyRedirectTarget("https://swarm-brain.pages.dev/api/auth/demo?key=k", true),
    "https://swarm-team.app/api/auth/demo?key=k",
  );
  assertEquals(legacyRedirectTarget("https://swarm-brain.pages.dev/api/auth/demo?key=k", false), null);
  assertEquals(legacyRedirectTarget("https://swarm-brain.pages.dev/api/auth/telegram", true), null);
});
