import { assertEquals } from "@std/assert";
import { COMMENT_MAX, commentDeleteDenial } from "../../_shared/tasks/comments.ts";
import { commentEditDeps, type EditCommentArgs, editOwnTaskComment } from "./comment-edit.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideConfirmation } from "../confirm.ts";
import { withCallerIdentity } from "../auth.ts";

const args: EditCommentArgs = {
  task_id: "task",
  comment_id: "comment",
  content: " corrected ",
  requesting_user_id: 42,
};

Deno.test("actual query builder scopes writes to both task and author", async () => {
  let content = "original";
  const db = createClient("http://example.invalid", "test-only-api-key", {
    global: {
      fetch: (input, init) => {
        const url = new URL(String(input));
        const matches = (key: string, value: string) =>
          !url.searchParams.has(key) || url.searchParams.get(key) === `eq.${value}`;
        const owns = matches("id", "comment") && matches("task_id", "task") && matches("added_by_telegram_id", "42");
        if (owns) content = JSON.parse(String(init?.body)).content;
        return Promise.resolve(Response.json(owns ? { id: "comment" } : null));
      },
    },
  });
  const deps = commentEditDeps(db, () => Promise.resolve({ ok: true }));
  await editOwnTaskComment({ ...args, requesting_user_id: 99 }, deps);
  assertEquals(content, "original");
  await editOwnTaskComment({ ...args, task_id: "other-task" }, deps);
  assertEquals(content, "original");
  assertEquals(await editOwnTaskComment(args, deps), "✅ Комментарий изменён.");
  assertEquals(content, "corrected");
});

Deno.test("edit uses token-derived identity and cannot change another author's comment", async () => {
  const row = { author: 42, content: "original" };
  const deps = {
    guard: () => Promise.resolve({ ok: true as const }),
    updateOwn: (_task: string, _comment: string, author: number, content: string) => {
      if (row.author !== author) return Promise.resolve(false);
      row.content = content;
      return Promise.resolve(true);
    },
  };
  const spoofed = withCallerIdentity({ ...args, requesting_user_id: 42 }, 99);
  assertEquals(spoofed.ok, false);
  const caller = withCallerIdentity({ ...args, requesting_user_id: undefined }, 99);
  if (!caller.ok) throw new Error("token identity is required");
  assertEquals(
    await editOwnTaskComment(caller.args as unknown as EditCommentArgs, deps),
    "Комментарий не найден или принадлежит другому автору.",
  );
  assertEquals(row.content, "original");
  assertEquals(await editOwnTaskComment(args, deps), "✅ Комментарий изменён.");
  assertEquals(row.content, "corrected");
  assertEquals(commentDeleteDenial(42, 99, false), "Нельзя удалить чужой комментарий");
});

Deno.test("unavailable task or invalid content cannot reach the comment write", async () => {
  let writes = 0;
  const updateOwn = () => {
    writes++;
    return Promise.resolve(true);
  };
  assertEquals(
    await editOwnTaskComment(args, {
      guard: () => Promise.resolve({ ok: false, msg: "Задача не найдена." }),
      updateOwn,
    }),
    "Задача не найдена.",
  );
  for (const content of [" ", "x".repeat(COMMENT_MAX + 1)]) {
    await editOwnTaskComment({ ...args, content }, { guard: () => Promise.resolve({ ok: true }), updateOwn });
  }
  assertEquals(writes, 0);
});

Deno.test("comment deletion cannot execute before confirmation for the same actor and ids", async () => {
  const request = {
    secret: "test-only-confirmation-secret",
    telegramId: 42,
    tool: "delete_task_comment",
    args: { task_id: "task", comment_id: "comment" },
    nowSec: 1000,
  };
  const challenge = await decideConfirmation(request);
  assertEquals(challenge.action, "challenge");
  if (challenge.action !== "challenge") throw new Error("confirmation required");
  assertEquals(
    (await decideConfirmation({ ...request, args: { ...request.args, confirmation_token: challenge.token } })).action,
    "execute",
  );
  assertEquals(
    (await decideConfirmation({
      ...request,
      telegramId: 99,
      args: { ...request.args, confirmation_token: challenge.token },
    })).action,
    "refuse",
  );
});
