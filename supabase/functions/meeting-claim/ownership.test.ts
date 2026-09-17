// deno-lint-ignore-file no-import-prefix -- edge-функции Swarm деплоятся с URL-импортами (так во
// ВСЕХ функциях); перевод на голые спецификаторы из import-map из ветки непроверяем.
//
// Владелец встречи и владелец приватной записи — ЧЕЛОВЕК, даже когда пришёл служебный агент.
//
// Почему тест читает исходник, а не гоняет обработчик: гарантия живёт не в одной ветке, а в том,
// что НИ ОДНО из мест записи владельца не берёт идентификатор откуда-то ещё. Обработчик проверил
// бы тот путь, который додумался вызвать автор теста; исходник проверяет все разом — и краснеет
// на месте, которое допишут через полгода.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const here = new URL(".", import.meta.url).pathname;
const claim = await Deno.readTextFile(`${here}index.ts`);
const ingest = await Deno.readTextFile(`${here}../meeting-ingest/index.ts`);

Deno.test("БЛОКИРУЮЩИЙ: владельцем пишется только identity.telegramId", () => {
  const writes = [
    ...claim.matchAll(/(claim_owner|owner_id|added_by)\s*:\s*([^,\n]+)/g),
  ]
    .filter(([, , value]) => !/^(number|string)/.test(value ?? ""));
  assertEquals(
    writes.length > 0,
    true,
    "места записи владельца должны находиться",
  );
  for (const [whole, field, value] of writes) {
    assertEquals(
      (value ?? "").includes("identity.telegramId"),
      true,
      `${field} пишется не личностью человека: «${whole.trim()}»`,
    );
  }
});

Deno.test("БЛОКИРУЮЩИЙ: идентификатор агента не попадает в данные встречи", () => {
  // agentId нужен только heartbeat'у, чтобы отметиться в своей строке. В meeting-claim и
  // meeting-ingest его появление означало бы, что встреча или запись стала «ботовой».
  for (
    const [name, src] of [["meeting-claim", claim], [
      "meeting-ingest",
      ingest,
    ]] as const
  ) {
    assertEquals(
      src.includes("agentId"),
      false,
      `${name} не должен знать про agentId`,
    );
  }
});

Deno.test("БЛОКИРУЮЩИЙ: право заливать аудио сверяется с личностью человека", () => {
  assertEquals(
    /m\.claim_owner !== identity\.telegramId/.test(ingest),
    true,
    "meeting-ingest обязан сверять claim_owner с identity.telegramId",
  );
});

Deno.test("оба эндпоинта ходят через одну дверь подмены личности", () => {
  for (
    const [name, src] of [["meeting-claim", claim], [
      "meeting-ingest",
      ingest,
    ]] as const
  ) {
    assertEquals(
      src.includes("await resolveActingIdentity(supabase, req)"),
      true,
      `${name} должен пускать через resolveActingIdentity`,
    );
    assertEquals(
      src.includes("verifyAgentToken"),
      false,
      `${name} не должен оставаться на старой двери`,
    );
  }
});
