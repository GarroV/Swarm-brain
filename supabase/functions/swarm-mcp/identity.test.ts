import { assertEquals } from "jsr:@std/assert@1";
import { TOKEN_IDENTITY_DESCRIPTION, withTokenIdentity } from "./identity.ts";

const commentTool = {
  name: "add_task_comment",
  description: "Добавить комментарий",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID задачи" },
      requesting_user_id: { type: "number", description: "Твой Telegram user ID — обязателен" },
    },
    required: ["task_id", "requesting_user_id"],
  },
};

Deno.test("identity field is no longer required, other required fields stay", () => {
  const tool = withTokenIdentity(commentTool);
  assertEquals(tool.inputSchema.required, ["task_id"]);
});

Deno.test("identity field description says it comes from the token", () => {
  const tool = withTokenIdentity(commentTool);
  assertEquals((tool.inputSchema.properties?.requesting_user_id as { description?: string }).description, TOKEN_IDENTITY_DESCRIPTION);
  assertEquals((tool.inputSchema.properties?.task_id as { description?: string }).description, "ID задачи");
});

Deno.test("owner_telegram_id is treated the same way", () => {
  const tool = withTokenIdentity({
    name: "add_knowledge",
    description: "",
    inputSchema: { properties: { owner_telegram_id: { type: "number" } }, required: ["owner_telegram_id"] },
  });
  assertEquals(tool.inputSchema.required, []);
  assertEquals((tool.inputSchema.properties?.owner_telegram_id as { description?: string }).description, TOKEN_IDENTITY_DESCRIPTION);
});

Deno.test("source definition is not mutated", () => {
  withTokenIdentity(commentTool);
  assertEquals(commentTool.inputSchema.required, ["task_id", "requesting_user_id"]);
});

Deno.test("schema without required list stays without it", () => {
  const tool = withTokenIdentity({ name: "x", description: "", inputSchema: { properties: {} } });
  assertEquals("required" in tool.inputSchema, false);
});
