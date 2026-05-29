import { ADMIN_USER_ID } from "../lib/supabase.ts";
import { sendMessage } from "../lib/telegram.ts";
import { listWorkspaces, createWorkspace, assignUserToWorkspace } from "../lib/workspace.ts";

export async function handleWorkspace(
  chatId: number,
  userId: number,
  argText: string,
): Promise<void> {
  if (userId !== ADMIN_USER_ID) {
    await sendMessage(chatId, "Недостаточно прав.");
    return;
  }

  const parts = argText.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();

  if (!sub || sub === "list") {
    const workspaces = await listWorkspaces();
    if (!workspaces.length) {
      await sendMessage(chatId, "Воркспейсов нет.");
      return;
    }
    const lines = workspaces.map((w) => `• <code>${w.id}</code> — ${w.name}`).join("\n");
    await sendMessage(chatId, `<b>Воркспейсы:</b>\n\n${lines}`);
    return;
  }

  if (sub === "create") {
    // /workspace create cee CEE
    const id = parts[1];
    const name = parts.slice(2).join(" ");
    if (!id || !name) {
      await sendMessage(chatId, "Использование: <code>/workspace create &lt;id&gt; &lt;название&gt;</code>\nПример: <code>/workspace create other Other Markets</code>");
      return;
    }
    try {
      await createWorkspace(id, name);
      await sendMessage(chatId, `✅ Воркспейс <code>${id}</code> — <b>${name}</b> создан.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sendMessage(chatId, msg.includes("duplicate") ? `Воркспейс <code>${id}</code> уже существует.` : `Ошибка: ${msg}`);
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
        await sendMessage(chatId, `Воркспейс <code>${workspaceId}</code> не найден. Создай через <code>/workspace create</code>.`);
      } else if (result === "not_found") {
        await sendMessage(chatId, "Пользователь не найден.");
      } else {
        const label = sub === "move" ? "Перемещён" : "Добавлен";
        const who = telegramId ? `ID ${telegramId}` : `@${username}`;
        await sendMessage(chatId, `✅ ${label}: ${who} → воркспейс <code>${workspaceId}</code>.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sendMessage(chatId, `Ошибка: ${msg}`);
    }
    return;
  }

  await sendMessage(chatId, "Подкоманды: <code>/workspace list</code> · <code>/workspace create &lt;id&gt; &lt;название&gt;</code> · <code>/workspace add @user &lt;id&gt;</code> · <code>/workspace move @user &lt;id&gt;</code>");
}
