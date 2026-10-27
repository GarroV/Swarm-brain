import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  canonicalJson,
  CONFIRM_INVALID_MESSAGE,
  CONFIRM_NO_SECRET_MESSAGE,
  CONFIRM_TOKEN_ARGUMENT,
  CONFIRM_TTL_SECONDS,
  confirmationChallenge,
  decideConfirmation,
  issueConfirmationToken,
  verifyConfirmationToken,
  withConfirmationArgument,
} from "./confirm.ts";

const SECRET = "test-secret";
const NOW = 1_800_000_000;
const ARGS = { id: "task-1", requesting_user_id: 111 };

async function firstStep(args = ARGS, user = 111, tool = "delete_task") {
  const d = await decideConfirmation({ secret: SECRET, telegramId: user, tool, args, nowSec: NOW });
  if (d.action != "challenge") throw new Error(`ожидался challenge, пришло ${d.action}`);
  return d.token;
}

Deno.test("первый вызов без токена не исполняется, а выдаёт токен", async () => {
  const d = await decideConfirmation({ secret: SECRET, telegramId: 111, tool: "delete_task", args: ARGS, nowSec: NOW });
  assertEquals(d.action, "challenge");
});

Deno.test("второй вызов с токеном и теми же аргументами исполняется, токен до инструмента не доезжает", async () => {
  const token = await firstStep();
  const d = await decideConfirmation({
    secret: SECRET,
    telegramId: 111,
    tool: "delete_task",
    args: { ...ARGS, [CONFIRM_TOKEN_ARGUMENT]: token },
    nowSec: NOW + 10,
  });
  assertEquals(d, { action: "execute", args: ARGS });
});

Deno.test("порядок ключей аргументов не меняет подпись", async () => {
  const token = await firstStep({ a: 1, b: { y: 2, x: 1 } } as never);
  const d = await decideConfirmation({
    secret: SECRET,
    telegramId: 111,
    tool: "delete_task",
    args: { b: { x: 1, y: 2 }, a: 1, [CONFIRM_TOKEN_ARGUMENT]: token },
    nowSec: NOW,
  });
  assertEquals(d.action, "execute");
});

Deno.test("изменённые аргументы — отказ", async () => {
  const token = await firstStep();
  const d = await decideConfirmation({
    secret: SECRET,
    telegramId: 111,
    tool: "delete_task",
    args: { ...ARGS, id: "task-2", [CONFIRM_TOKEN_ARGUMENT]: token },
    nowSec: NOW,
  });
  assertEquals(d, { action: "refuse", message: CONFIRM_INVALID_MESSAGE });
});

Deno.test("токен от другого инструмента или другого человека — отказ", async () => {
  const token = await firstStep();
  for (const [tool, user] of [["delete_entry", 111], ["delete_task", 222]] as const) {
    const d = await decideConfirmation({
      secret: SECRET,
      telegramId: user,
      tool,
      args: { ...ARGS, [CONFIRM_TOKEN_ARGUMENT]: token },
      nowSec: NOW,
    });
    assertEquals(d.action, "refuse", `${tool}/${user}`);
  }
});

Deno.test("истёкший токен — отказ, в последнюю секунду — ещё годен", async () => {
  const token = await firstStep();
  const at = (nowSec: number) =>
    decideConfirmation({
      secret: SECRET,
      telegramId: 111,
      tool: "delete_task",
      args: { ...ARGS, [CONFIRM_TOKEN_ARGUMENT]: token },
      nowSec,
    });
  assertEquals((await at(NOW + CONFIRM_TTL_SECONDS)).action, "execute");
  assertEquals((await at(NOW + CONFIRM_TTL_SECONDS + 1)).action, "refuse");
});

Deno.test("подпись другим секретом и порванная форма токена — отказ", async () => {
  const forged = await issueConfirmationToken("other-secret", 111, "delete_task", ARGS, NOW);
  assertEquals(await verifyConfirmationToken(SECRET, forged, 111, "delete_task", ARGS, NOW), false);
  const real = await firstStep();
  for (const bad of ["", "abc", "123.", `${real}.x`, 42, null, real.replace(/.$/, (c) => (c == "0" ? "1" : "0"))]) {
    assertEquals(await verifyConfirmationToken(SECRET, bad, 111, "delete_task", ARGS, NOW), false, String(bad));
  }
});

Deno.test("без секрета разрушающий инструмент отказывает, а не выполняется (fail-closed)", async () => {
  for (const secret of [undefined, ""]) {
    const d = await decideConfirmation({ secret, telegramId: 111, tool: "delete_task", args: ARGS, nowSec: NOW });
    assertEquals(d, { action: "refuse", message: CONFIRM_NO_SECRET_MESSAGE });
  }
});

Deno.test("canonicalJson: ключи сортируются на любой глубине", () => {
  assertEquals(canonicalJson({ b: [{ d: 1, c: 2 }], a: null }), '{"a":null,"b":[{"c":2,"d":1}]}');
});

Deno.test("ответ первого шага говорит, что действие НЕ выполнено, и не светит токен подтверждения в аргументах", async () => {
  const token = await firstStep();
  const res = confirmationChallenge("delete_task", { ...ARGS, [CONFIRM_TOKEN_ARGUMENT]: "old" }, token);
  assertEquals(res.structuredContent.status, "confirmation_required");
  assertEquals(res.structuredContent.executed, false);
  assertEquals(res.content[0].text.includes('"old"'), false);
});

Deno.test("в схему разрушающего инструмента добавляется confirmation_token, у остальных — нет", () => {
  const tool = (name: string) => ({ name, description: "", inputSchema: { type: "object", properties: {} } });
  assertEquals(
    CONFIRM_TOKEN_ARGUMENT in (withConfirmationArgument(tool("delete_task")).inputSchema.properties ?? {}),
    true,
  );
  assertEquals(
    CONFIRM_TOKEN_ARGUMENT in (withConfirmationArgument(tool("add_task")).inputSchema.properties ?? {}),
    false,
  );
  assertNotEquals(withConfirmationArgument(tool("delete_task")), tool("delete_task"));
});
