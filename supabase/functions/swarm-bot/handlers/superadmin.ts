import { ADMIN_USER_ID, supabase } from "../lib/supabase.ts";
import { editInlineMessage, sendInlineMessage, sendMessage } from "../lib/telegram.ts";
import { clearSession, setSession } from "../lib/storage.ts";
import { assignUserToWorkspace, createWorkspace, listWorkspaces } from "../lib/workspace.ts";
import type { TgCallbackQuery } from "../lib/types.ts";
import type { AdminActor, MemberRow } from "../../_shared/users/admin-scope.ts";
import { personName } from "../../_shared/users/display-name.ts";
import {
  actionTarget,
  type BotAdminAction,
  botAdminAllowed,
  NO_ACCESS_TEXT,
  parseSaCallback,
  parseSaSession,
  visibleWorkspaces,
} from "./superadmin-scope.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Имя → @username → e-mail (вошедшие через Google и приглашённые по почте, #537) → ID.
function displayName(
  telegramId: number | null,
  username: string | null,
  profiles: Array<{ telegram_id: number; first_name?: string; last_name?: string; username?: string }>,
  email: string | null = null,
): string {
  const p = telegramId !== null ? profiles.find((pr) => pr.telegram_id === telegramId) : undefined;
  const name = personName({ first_name: p?.first_name, last_name: p?.last_name, username, email });
  if (name) return name;
  return telegramId !== null ? `ID:${telegramId}` : "Неизвестный";
}

/** Parse a callback suffix of the form "<tgId>_<wsId>" by splitting at the first underscore. */
function parseTgIdWsId(rest: string): { tgId: number; wsId: string } {
  const idx = rest.indexOf("_");
  if (idx === -1) return { tgId: Number(rest), wsId: "" };
  return { tgId: Number(rest.slice(0, idx)), wsId: rest.slice(idx + 1) };
}

// ── Границы (правила — superadmin-scope.ts, общий канон _shared/users/admin-scope.ts) ──

/** Админ и его воркспейс; null — не админ. Тот же признак, что isAdminUser (ADMIN_USER_ID ЛИБО is_admin). */
async function loadAdminActor(userId: number): Promise<AdminActor | null> {
  const { data } = await supabase
    .from("allowed_users")
    .select("is_admin, group_id")
    .eq("telegram_id", userId)
    .maybeSingle();
  const row = data as { is_admin?: boolean; group_id?: string | null } | null;
  if (userId !== ADMIN_USER_ID && row?.is_admin !== true) return null;
  return { telegramId: userId, groupId: row?.group_id ?? "" };
}

/** Строка allowed_users, которую адресует действие (null — такой нет или действие без цели). */
async function loadTarget(act: BotAdminAction): Promise<MemberRow | null> {
  const t = actionTarget(act);
  if (!t) return null;
  const q = supabase.from("allowed_users").select("telegram_id, group_id");
  const { data, error } = "telegramId" in t
    ? await q.eq("telegram_id", t.telegramId).limit(1).maybeSingle()
    : await q.ilike("username", t.username).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberRow | null) ?? null;
}

/** Действие в объёме админа? Отказ — сообщение и true (колбэк обработан). */
async function gate(chatId: number, actor: AdminActor, act: BotAdminAction): Promise<boolean> {
  if (botAdminAllowed(actor, act, await loadTarget(act))) return true;
  await sendMessage(chatId, NO_ACCESS_TEXT);
  return false;
}

/** Главное меню: «Создать спейс» — только суперадмину. */
function mainMenu(actor: AdminActor): Array<Array<{ text: string; callback_data: string }>> {
  const row = [{ text: "📋 Спейсы", callback_data: "sa_spaces" }];
  if (actor.telegramId === ADMIN_USER_ID) row.push({ text: "➕ Создать спейс", callback_data: "sa_create" });
  return [row];
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function handleSuperadmin(chatId: number, userId: number): Promise<void> {
  const actor = await loadAdminActor(userId);
  if (!actor) {
    await sendMessage(chatId, "Недостаточно прав.");
    return;
  }
  await sendInlineMessage(chatId, "🔧 <b>Суперадмин панель</b>", mainMenu(actor));
}

// ── Callback handler ──────────────────────────────────────────────────────────

export async function handleSuperadminCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
): Promise<boolean> {
  const data = cb.data ?? "";
  if (!data.startsWith("sa_")) return false;
  const actor = await loadAdminActor(userId);
  if (!actor) return false;

  try {
    // Единая точка проверки: каждое действие — в объёме админа ДО любой записи.
    if (!(await gate(chatId, actor, parseSaCallback(data)))) return true;

    // sa_main — re-show main menu
    if (data === "sa_main") {
      await editInlineMessage(chatId, cb.message.message_id, "🔧 <b>Суперадмин панель</b>", mainMenu(actor));
      return true;
    }

    // sa_spaces — list all workspaces
    if (data === "sa_spaces") {
      const workspaces = visibleWorkspaces(actor, await listWorkspaces());
      if (!workspaces.length) {
        await editInlineMessage(chatId, cb.message.message_id, "📋 Нет ни одного спейса.", [[
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
      await editInlineMessage(chatId, cb.message.message_id, "📋 <b>Воркспейсы:</b>", rows);
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
      const msg = `📦 <b>${ws.name}</b>\nID: ${wsId}\nПользователей: ${count ?? 0}`;
      await editInlineMessage(chatId, cb.message.message_id, msg, [
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
        .select("telegram_id, username, email, is_admin")
        .eq("group_id", wsId);

      const telegramIds = (users ?? [])
        .map((u: { telegram_id: number | null }) => u.telegram_id)
        .filter((id: number | null): id is number => id !== null);

      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("telegram_id, first_name, last_name")
        .in("telegram_id", telegramIds.length ? telegramIds : [0]);

      const profileList = (profiles ?? []) as Array<{
        telegram_id: number;
        first_name?: string;
        last_name?: string;
        username?: string;
      }>;

      if (!users?.length) {
        await editInlineMessage(
          chatId,
          cb.message.message_id,
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

      const userRows = (users as Array<
        { telegram_id: number | null; username: string | null; email: string | null; is_admin: boolean | null }
      >).map(
        (u) => {
          const name = displayName(u.telegram_id, u.username, profileList, u.email);
          // Приглашён, но ещё не входил: telegram_id нет, карточку по id не открыть — раньше
          // кнопка вела в карточку «ID: 0» (#537). Нажатие просто обновляет список.
          if (u.telegram_id === null) {
            return [{ text: `⏳ ${name} — приглашён`, callback_data: `sa_su_${wsId}` }];
          }
          const label = u.is_admin ? `${name} 👑` : name;
          return [{ text: label, callback_data: `sa_u_${u.telegram_id}_${wsId}` }];
        },
      );
      userRows.push([
        { text: "➕ Добавить", callback_data: `sa_add_${wsId}` },
        { text: "🔙 К спейсу", callback_data: `sa_sp_${wsId}` },
      ]);

      await editInlineMessage(chatId, cb.message.message_id, `👥 <b>Пользователи ${wsName}:</b>`, userRows);
      return true;
    }

    // sa_u_<tgId>_<wsId> — user detail
    if (data.startsWith("sa_u_")) {
      const rest = data.slice("sa_u_".length);
      const { tgId, wsId } = parseTgIdWsId(rest);
      // Старые кнопки приглашённых вели сюда с id 0 — карточки у такого человека нет (#537).
      if (!Number.isFinite(tgId) || tgId === 0) {
        await editInlineMessage(chatId, cb.message.message_id, "Человек приглашён, но ещё не входил.", [
          [{ text: "🔙 К пользователям", callback_data: `sa_su_${wsId}` }],
        ]);
        return true;
      }

      const { data: userRow } = await supabase
        .from("allowed_users")
        .select("telegram_id, username, email, is_admin, group_id")
        .eq("telegram_id", tgId)
        .maybeSingle();

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("telegram_id, first_name, last_name")
        .eq("telegram_id", tgId)
        .maybeSingle();

      const profileList = profile
        ? [profile as { telegram_id: number; first_name?: string; last_name?: string; username?: string }]
        : [];
      const uRow = userRow as {
        telegram_id: number | null;
        username: string | null;
        email: string | null;
        is_admin: boolean | null;
        group_id: string | null;
      } | null;

      const name = displayName(
        tgId,
        uRow?.username ?? (profile as { username?: string } | null)?.username ?? null,
        profileList,
        uRow?.email ?? null,
      );
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

      // Перенос между спейсами — только суперадмину.
      const keyboard: Array<Array<{ text: string; callback_data: string }>> = actor.telegramId === ADMIN_USER_ID
        ? [[{ text: "🔄 Сменить спейс", callback_data: `sa_mv_${tgId}_${wsId}` }]]
        : [];
      if (tgId !== ADMIN_USER_ID) {
        keyboard.push([{ text: "🚫 Удалить", callback_data: `sa_blk_${tgId}_${wsId}` }]);
      }
      keyboard.push([{ text: "🔙 К пользователям", callback_data: `sa_su_${wsId}` }]);

      await editInlineMessage(chatId, cb.message.message_id, msg, keyboard);
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

      await editInlineMessage(chatId, cb.message.message_id, "Переместить пользователя в:", rows);
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

      await editInlineMessage(
        chatId,
        cb.message.message_id,
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

      if (tgId === ADMIN_USER_ID) {
        await sendMessage(chatId, "Нельзя удалить суперадмина.");
        return true;
      }

      const { error } = await supabase
        .from("allowed_users")
        .delete()
        .eq("telegram_id", tgId)
        .eq("group_id", wsId);
      if (error) {
        await sendMessage(chatId, `Ошибка: ${error.message}`);
        return true;
      }

      await editInlineMessage(
        chatId,
        cb.message.message_id,
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
  const actor = await loadAdminActor(userId);
  if (!actor) return false;

  await clearSession(chatId);

  try {
    if (!(await gate(chatId, actor, parseSaSession(action, text)))) return true;
    // sa_adduser_<wsId>
    if (action.startsWith("sa_adduser_")) {
      const wsId = action.slice("sa_adduser_".length);
      const input = text.trim();

      let result: "ok" | "not_found" | "workspace_not_found";

      // Единый путь: по числу — telegram_id, иначе — @username (канон _shared/users/membership.ts
      // сам нормализует @/регистр и резолвит существующего юзера или заводит ожидающую строку).
      if (/^\d+$/.test(input)) {
        result = await assignUserToWorkspace(Number(input), null, wsId);
      } else {
        result = await assignUserToWorkspace(null, input, wsId);
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
