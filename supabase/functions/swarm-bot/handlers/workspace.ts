import { isMasterUser } from "../lib/supabase.ts";
import { canUseWorkspaceCommand } from "./users-scope.ts";
import { sendMessage } from "../lib/telegram.ts";
import { assignUserToWorkspace, createWorkspace, listWorkspaces, workspaceName } from "../lib/workspace.ts";
import { validateWorkspaceName } from "../../_shared/workspaces.ts";
import { escapeHtml } from "../../_shared/telegram-html.ts";

export async function handleWorkspace(
  chatId: number,
  userId: number,
  argText: string,
): Promise<void> {
  // Все воркспейсы, создание и перенос между ними — только суперадмин (admin-scope.ts); админ
  // воркспейса управляет людьми своего воркспейса через /users.
  if (!canUseWorkspaceCommand({ telegramId: userId, groupId: "", isMaster: await isMasterUser(userId) })) {
    await sendMessage(
      chatId,
      "Only the master admin can manage spaces.\nУправлять пространствами может только мастер-админ.",
    );
    return;
  }

  const parts = argText.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();

  if (!sub || sub === "list") {
    const workspaces = await listWorkspaces();
    if (!workspaces.length) {
      await sendMessage(chatId, "Пространств нет.");
      return;
    }
    const lines = workspaces.map((w) => `• <b>${escapeHtml(w.name)}</b> (<code>${escapeHtml(w.id)}</code>)`).join("\n");
    await sendMessage(
      chatId,
      `<b>Пространства:</b>\n\n${lines}\n\n<i>Код в скобках нужен только командам add и move.</i>`,
    );
    return;
  }

  if (sub === "create") {
    // /workspace create World — слаг рождается сам и наружу не выходит
    const checked = validateWorkspaceName(parts.slice(1).join(" "));
    if (!checked.ok) {
      await sendMessage(
        chatId,
        "Использование: <code>/workspace create &lt;название&gt;</code> (до 60 символов)\nПример: <code>/workspace create World</code>",
      );
      return;
    }
    try {
      await createWorkspace(checked.name);
      await sendMessage(chatId, `✅ Пространство <b>${escapeHtml(checked.name)}</b> создано.`);
    } catch (e) {
      console.error("workspace create", e);
      await sendMessage(chatId, "Не удалось создать пространство. Попробуйте ещё раз.");
    }
    return;
  }

  if (sub === "add" || sub === "move") {
    // /workspace add @username cee
    // /workspace move @username other
    const target = parts[1];
    const workspaceId = parts[2];
    if (!target || !workspaceId) {
      await sendMessage(chatId, `Использование: <code>/workspace ${sub} @username &lt;workspace_id&gt;</code>`);
      return;
    }

    let telegramId: number | null = null;
    let username: string | null = null;
    if (/^\d+$/.test(target)) {
      telegramId = Number(target);
    } else {
      username = target.replace(/^@/, "");
    }

    try {
      const result = await assignUserToWorkspace(telegramId, username, workspaceId);
      if (result === "workspace_not_found") {
        await sendMessage(
          chatId,
          `Пространство <code>${escapeHtml(workspaceId)}</code> не найдено. Список — <code>/workspace list</code>.`,
        );
      } else if (result === "not_found") {
        await sendMessage(chatId, "Пользователь не найден.");
      } else {
        const label = sub === "move" ? "Перемещён" : "Добавлен";
        const who = telegramId ? `ID ${telegramId}` : `@${username}`;
        await sendMessage(
          chatId,
          `✅ ${label}: ${escapeHtml(who)} → пространство «${escapeHtml(await workspaceName(workspaceId))}».`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sendMessage(chatId, `Ошибка: ${msg}`);
    }
    return;
  }

  await sendMessage(
    chatId,
    "Подкоманды: <code>/workspace list</code> · <code>/workspace create &lt;название&gt;</code> · <code>/workspace add @user &lt;id&gt;</code> · <code>/workspace move @user &lt;id&gt;</code>",
  );
}
