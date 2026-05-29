import { supabase, ADMIN_USER_ID } from "../lib/supabase.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { setSession, clearSession } from "../lib/storage.ts";
import { listWorkspaces, createWorkspace, assignUserToWorkspace } from "../lib/workspace.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayName(
  telegramId: number | null,
  username: string | null,
  profiles: Array<{ telegram_id: number; first_name?: string; last_name?: string; username?: string }>,
): string {
  if (telegramId !== null) {
    const p = profiles.find((pr) => pr.telegram_id === telegramId);
    if (p) {
      const full = [p.first_name, p.last_name].filter(Boolean).join(" ");
      if (full) return full;
    }
  }
  if (username) return `@${username}`;
  return telegramId !== null ? `ID:${telegramId}` : "Неизвестный";
}

/** Parse a callback suffix of the form "<tgId>_<wsId>" by splitting at the first underscore. */
function parseTgIdWsId(rest: string): { tgId: number; wsId: string } {
  const idx = rest.indexOf("_");
  if (idx === -1) return { tgId: Number(rest), wsId: "" };
  return { tgId: Number(rest.slice(0, idx)), wsId: rest.slice(idx + 1) };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function handleSuperadmin(chatId: number, userId: number): Promise<void> {
  if (userId !== ADMIN_USER_ID) {
    await sendMessage(chatId, "Недостаточно прав.");
    return;
  }
  await sendInlineMessage(chatId, "🔧 <b>Суперадмин панель</b>", [[
    { text: "📋 Спейсы", callback_data: "sa_spaces" },
    { text: "➕ Создать спейс", callback_data: "sa_create" },
  ]]);
}

// ── Callback handler ──────────────────────────────────────────────────────────

export async function handleSuperadminCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
): Promise<boolean> {
  const data = cb.data ?? "";
  if (!data.startsWith("sa_")) return false;
  if (userId !== ADMIN_USER_ID) return false;

  try {
    // sa_main — re-show main menu
    if (data === "sa_main") {
      await sendInlineMessage(chatId, "🔧 <b>Суперадмин панель</b>", [[
        { text: "📋 Спейсы", callback_data: "sa_spaces" },
        { text: "➕ Создать спейс", callback_data: "sa_create" },
      ]]);
      return true;
    }

    // sa_spaces — list all workspaces
    if (data === "sa_spaces") {
      const workspaces = await listWorkspaces();
      if (!workspaces.length) {
        await sendInlineMessage(chatId, "📋 Нет ни одного спейса.", [[
          { text: "➕ Создать спейс", callback_data: "sa_create" },
          { text: "🔙 Главная", callback_data: "sa_main" },
        ]]);
        return true;
      }

      // Count users per workspace
      const rows: Array<Array<{ text: string; callback_data: string }>> = [];
      for (const ws of workspaces) {
        const { count } = await supabase
          .from("allowed_users")
          .select("*", { count: "exact", head: true })
          .eq("group_id", ws.id);
        rows.push([{ text: `${ws.name} (${count ?? 0} чел.)`, callback_data: `sa_sp_${ws.id}` }]);
      }
      rows.push([{ text: "🔙 Главная", callback_data: "sa_main" }]);
      await sendInlineMessage(chatId, "📋 <b>Воркспейсы:</b>", rows);
      return true;
    }

    // sa_create — start create workspace flow
    if (data === "sa_create") {
      await setSession(chatId, "sa_create_id");
      await sendMessage(chatId, "Введи ID нового спейса (латиница, цифры, дефис — например: other):");
      return true;
    }

    // sa_sp_<wsId> — workspace detail
    if (data.startsWith("sa_sp_")) {
      const wsId = data.slice("sa_sp_".length);
      const workspaces = await listWorkspaces();
      const ws = workspaces.find((w) => w.id === wsId);
      if (!ws) {
        await sendMessage(chatId, "Спейс не найден.");
        return true;
      }
      const { count } = await supabase
        .from("allowed_users")
        .select("*", { count: "exact", head: true })
        .eq("group_id", wsId);
      const msg =
        `📦 <b>${ws.name}</b>\nID: ${wsId}\nПользователей: ${count ?? 0}`;
      await sendInlineMessage(chatId, msg, [
        [
          { text: "👥 Пользователи", callback_data: `sa_su_${wsId}` },
          { text: "✏️ Переименовать", callback_data: `sa_ren_${wsId}` },
        ],
        [{ text: "➕ Добавить пользователя", callback_data: `sa_add_${wsId}` }],
        [{ text: "🔙 К списку спейсов", callback_data: "sa_spaces" }],
      ]);
      return true;
    }

    // sa_su_<wsId> — list users in workspace
    if (data.startsWith("sa_su_")) {
      const wsId = data.slice("sa_su_".length);
      const workspaces = await listWorkspaces();
      const ws = workspaces.find((w) => w.id === wsId);
      const wsName = ws?.name ?? wsId.toUpperCase();

      const { data: users } = await supabase
        .from("allowed_users")
        .select("telegram_id, username, is_admin")
        .eq("group_id", wsId);

      const telegramIds = (users ?? [])
        .map((u: { telegram_id: number | null }) => u.telegram_id)
        .filter((id: number | null): id is number => id !== null);

      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("telegram_id, first_name, last_name, username")
        .in("telegram_id", telegramIds.length ? telegramIds : [0]);

      const profileList = (profiles ?? []) as Array<{
        telegram_id: number;
        first_name?: string;
        last_name?: string;
        username?: string;
      }>;

      if (!users?.length) {
        await sendInlineMessage(
          chatId,
          `В спейсе ${wsName} нет пользователей.`,
          [
            [
              { text: "➕ Добавить", callback_data: `sa_add_${wsId}` },
              { text: "🔙 К спейсу", callback_data: `sa_sp_${wsId}` },
            ],
          ],
        );
        return true;
      }

      const userRows = (users as Array<{ telegram_id: number | null; username: string | null; is_admin: boolean | null }>).map(
        (u) => {
          const name = displayName(u.telegram_id, u.username, profileList);
          const label = u.is_admin ? `${name} 👑` : name;
          const tgId = u.telegram_id ?? 0;
          return [{ text: label, callback_data: `sa_u_${tgId}_${wsId}` }];
        },
      );
      userRows.push([
        { text: "➕ Добавить", callback_data: `sa_add_${wsId}` },
        { text: "🔙 К спейсу", callback_data: `sa_sp_${wsId}` },
      ]);

      await sendInlineMessage(chatId, `👥 <b>Пользователи ${wsName}:</b>`, userRows);
      return true;
    }

    // sa_u_<tgId>_<wsId> — user detail
    if (data.startsWith("sa_u_")) {
      const rest = data.slice("sa_u_".length);
      const { tgId, wsId } = parseTgIdWsId(rest);

      const { data: userRow } = await supabase
        .from("allowed_users")
        .select("telegram_id, username, is_admin, group_id")
        .eq("telegram_id", tgId)
        .maybeSingle();

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("telegram_id, first_name, last_name, username")
        .eq("telegram_id", tgId)
        .maybeSingle();

      const profileList = profile ? [profile as { telegram_id: number; first_name?: string; last_name?: string; username?: string }] : [];
      const uRow = userRow as { telegram_id: number | null; username: string | null; is_admin: boolean | null; group_id: string | null } | null;

      const name = displayName(tgId, uRow?.username ?? (profile as { username?: string } | null)?.username ?? null, profileList);
      const usernameStr = uRow?.username ?? (profile as { username?: string } | null)?.username ?? null;
      const workspaces = await listWorkspaces();
      const ws = workspaces.find((w) => w.id === wsId);
      const wsName = ws?.name ?? wsId.toUpperCase();
      const roleLabel = uRow?.is_admin ? "👑 Администратор" : "Участник";

      let msg = `👤 <b>${name}</b>`;
      if (usernameStr) msg += `\n@${usernameStr}`;
      msg += `\nID: ${tgId}`;
      msg += `\nСпейс: ${wsName}`;
      msg += `\nРоль: ${roleLabel}`;

      const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
        [{ text: "🔄 Сменить спейс", callback_data: `sa_mv_${tgId}_${wsId}` }],
      ];
      if (tgId !== ADMIN_USER_ID) {
        keyboard.push([{ text: "🚫 Удалить", callback_data: `sa_blk_${tgId}_${wsId}` }]);
      }
      keyboard.push([{ text: "🔙 К пользователям", callback_data: `sa_su_${wsId}` }]);

      await sendInlineMessage(chatId, msg, keyboard);
      return true;
    }

    // sa_mv_<tgId>_<wsId> — select target workspace
    if (data.startsWith("sa_mv_")) {
      const rest = data.slice("sa_mv_".length);
      const { tgId, wsId } = parseTgIdWsId(rest);

      const workspaces = await listWorkspaces();
      const others = workspaces.filter((w) => w.id !== wsId);

      const rows = others.map((w) => [
        { text: w.name, callback_data: `sa_mvto_${tgId}_${w.id}` },
      ]);
      rows.push([{ text: "🔙 Назад", callback_data: `sa_u_${tgId}_${wsId}` }]);

      await sendInlineMessage(chatId, "Переместить пользователя в:", rows);
      return true;
    }

    // sa_mvto_<tgId>_<toWsId> — execute move
    if (data.startsWith("sa_mvto_")) {
      const rest = data.slice("sa_mvto_".length);
      const { tgId, wsId: toWsId } = parseTgIdWsId(rest);

      const result = await assignUserToWorkspace(tgId, null, toWsId);
      if (result === "workspace_not_found") {
        await sendMessage(chatId, "Спейс не найден.");
        return true;
      }

      const workspaces = await listWorkspaces();
      const ws = workspaces.find((w) => w.id === toWsId);
      const wsName = ws?.name ?? toWsId.toUpperCase();

      await sendInlineMessage(
        chatId,
        `✅ Пользователь перемещён в ${wsName}.`,
        [[
          { text: `👥 Пользователи ${wsName}`, callback_data: `sa_su_${toWsId}` },
          { text: "📋 Спейсы", callback_data: "sa_spaces" },
        ]],
      );
      return true;
    }

    // sa_blk_<tgId>_<wsId> — remove user from workspace
    if (data.startsWith("sa_blk_")) {
      const rest = data.slice("sa_blk_".length);
      const { tgId, wsId } = parseTgIdWsId(rest);

      const { error } = await supabase
        .from("allowed_users")
        .delete()
        .eq("telegram_id", tgId);
      if (error) {
        await sendMessage(chatId, `Ошибка: ${error.message}`);
        return true;
      }

      await sendInlineMessage(
        chatId,
        "✅ Пользователь удалён из спейса.",
        [[{ text: "👥 Пользователи", callback_data: `sa_su_${wsId}` }]],
      );
      return true;
    }

    // sa_add_<wsId> — start add user flow
    if (data.startsWith("sa_add_")) {
      const wsId = data.slice("sa_add_".length);
      await setSession(chatId, `sa_adduser_${wsId}`);
      await sendMessage(
        chatId,
        `Введи Telegram ID (цифры) или @username пользователя для добавления в спейс ${wsId}:`,
      );
      return true;
    }

    // sa_ren_<wsId> — start rename flow
    if (data.startsWith("sa_ren_")) {
      const wsId = data.slice("sa_ren_".length);
      await setSession(chatId, `sa_rename_${wsId}`);
      await sendMessage(chatId, `Введи новое название для спейса ${wsId}:`);
      return true;
    }
  } catch (err) {
    await sendMessage(chatId, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  }

  return true;
}

// ── Session handler ───────────────────────────────────────────────────────────

export async function handleSuperadminSession(
  chatId: number,
  action: string,
  text: string,
  userId: number,
): Promise<boolean> {
  if (!action.startsWith("sa_")) return false;
  if (userId !== ADMIN_USER_ID) return false;

  await clearSession(chatId);

  try {
    // sa_adduser_<wsId>
    if (action.startsWith("sa_adduser_")) {
      const wsId = action.slice("sa_adduser_".length);
      const input = text.trim();

      let result: "ok" | "not_found" | "workspace_not_found";

      if (/^\d+$/.test(input)) {
        // Pure numeric → telegram ID
        const tgId = Number(input);
        result = await assignUserToWorkspace(tgId, null, wsId);
      } else {
        // Username (strip leading @)
        const username = input.startsWith("@") ? input.slice(1) : input;

        // Try to find existing user_profile by username
        const { data: profileRow } = await supabase
          .from("user_profiles")
          .select("telegram_id")
          .ilike("username", username)
          .maybeSingle();

        if (profileRow && (profileRow as { telegram_id: number }).telegram_id) {
          const tgId = (profileRow as { telegram_id: number }).telegram_id;
          result = await assignUserToWorkspace(tgId, null, wsId);
        } else {
          result = await assignUserToWorkspace(null, username, wsId);
        }
      }

      if (result === "workspace_not_found") {
        await sendMessage(chatId, "Спейс не найден.");
        return true;
      }

      await sendInlineMessage(
        chatId,
        `✅ Пользователь добавлен в спейс ${wsId}.`,
        [[{ text: "👥 Пользователи", callback_data: `sa_su_${wsId}` }]],
      );
      return true;
    }

    // sa_create_id — received workspace ID input
    if (action === "sa_create_id") {
      const wsId = text.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (!wsId) {
        await sendMessage(chatId, "ID не может быть пустым. Используй только латиницу, цифры и дефис.");
        return true;
      }
      await setSession(chatId, `sa_create_name_${wsId}`);
      await sendMessage(chatId, `ID: <code>${wsId}</code>\nТеперь введи отображаемое название спейса:`);
      return true;
    }

    // sa_create_name_<wsId> — received workspace display name
    if (action.startsWith("sa_create_name_")) {
      const wsId = action.slice("sa_create_name_".length);
      const name = text.trim();
      if (!name) {
        await sendMessage(chatId, "Название не может быть пустым.");
        return true;
      }
      try {
        await createWorkspace(wsId, name);
        await sendInlineMessage(
          chatId,
          `✅ Спейс <b>${name}</b> (ID: ${wsId}) создан.`,
          [[{ text: "📋 Все спейсы", callback_data: "sa_spaces" }]],
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("23505") || /duplicate|unique/i.test(msg)) {
          await sendMessage(chatId, "Спейс с таким ID уже существует.");
        } else {
          await sendMessage(chatId, `Ошибка: ${msg}`);
        }
      }
      return true;
    }

    // sa_rename_<wsId> — received new workspace name
    if (action.startsWith("sa_rename_")) {
      const wsId = action.slice("sa_rename_".length);
      const name = text.trim();
      if (!name) {
        await sendMessage(chatId, "Название не может быть пустым.");
        return true;
      }
      const { error } = await supabase
        .from("workspaces")
        .update({ name })
        .eq("id", wsId);
      if (error) {
        await sendMessage(chatId, `Ошибка: ${error.message}`);
        return true;
      }
      await sendInlineMessage(
        chatId,
        `✅ Переименовано в <b>${name}</b>.`,
        [[{ text: "📦 К спейсу", callback_data: `sa_sp_${wsId}` }]],
      );
      return true;
    }
  } catch (err) {
    await sendMessage(chatId, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  }

  return true;
}
