import { ADMIN_USER_ID, isAdminUser, supabase } from "../lib/supabase.ts";
import { buildKeyboard, editInlineMessage, sendInlineMessage, sendMessage } from "../lib/telegram.ts";
import { clearSession, setSession } from "../lib/storage.ts";
import type { Task, TgCallbackQuery } from "../lib/types.ts";
import { sendTaskCard } from "../tasks/index.ts";
import { generateNameAliases } from "../lib/name-aliases.ts";
import { assignUserToWorkspace } from "../lib/workspace.ts";
import { onlyLive } from "../../_shared/tasks/live.ts";
import { externalFetch, VIA_TELEGRAM } from "../../_shared/external-fetch.ts";
import { isSuperadmin, type MemberRow } from "../../_shared/users/admin-scope.ts";
import { canActOnUser, canAddUsers, isEditableProfileField, type UserAction, type UsersActor } from "./users-scope.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

export const PROFILE_FIELDS: Record<string, string> = {
  first_name: "Имя",
  last_name: "Фамилия",
  role: "Роль",
  markets: "Рынки (через запятую)",
  email: "Email",
};

const NO_RIGHTS = "Недостаточно прав для этого действия.";

async function loadUsersActor(telegramId: number, groupId: string): Promise<UsersActor> {
  return { telegramId, groupId, isAdmin: await isAdminUser(telegramId) };
}

/** Строка человека в воркспейсе действующего (суперадмину — любая). Ошибка чтения = нет прав. */
async function loadTargetRow(actor: UsersActor, targetId: number): Promise<MemberRow | null> {
  if (!Number.isFinite(targetId)) return null;
  let q = supabase.from("allowed_users").select("telegram_id, group_id").eq("telegram_id", targetId);
  if (!isSuperadmin(actor)) q = q.eq("group_id", actor.groupId);
  const { data, error } = await q.limit(1);
  if (error) {
    console.error("[users] target row:", error.message);
    return null;
  }
  return ((data ?? [])[0] as MemberRow | undefined) ?? null;
}

/** Проверка прав с ответом человеку; true — можно продолжать. */
async function allowUserAction(
  chatId: number,
  actor: UsersActor,
  targetId: number,
  action: UserAction,
): Promise<boolean> {
  if (canActOnUser(actor, await loadTargetRow(actor, targetId), action)) return true;
  await sendMessage(chatId, NO_RIGHTS);
  return false;
}

export async function handleUsers(
  chatId: number,
  adminId: number,
  argText: string,
  groupId: string,
  messageId?: number,
): Promise<void> {
  const parts = argText.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const targetArg = parts[1];

  if (!sub || sub === "list") {
    const { data, error } = await supabase
      .from("allowed_users")
      .select("telegram_id, username")
      .eq("group_id", groupId)
      .order("created_at");
    if (error) {
      await sendMessage(chatId, `Ошибка: ${error.message}`);
      return;
    }

    // Строка без telegram_id — приглашение, по которому человек ещё не вошёл: ни кнопки
    // «pu_null», ни «ID null». Показываем их отдельно, по @username.
    type Row = { telegram_id: number | null; username: string | null };
    const rows = (data ?? []) as Row[];
    const allUsers = rows.filter((u): u is { telegram_id: number; username: string | null } =>
      typeof u.telegram_id === "number"
    );
    const pending = rows.filter((u) => u.telegram_id === null && u.username);
    const ids = allUsers.map((u) => u.telegram_id);
    const { data: profiles, error: profErr } = ids.length
      ? await supabase.from("user_profiles").select("*").in("telegram_id", ids)
      : { data: [], error: null };
    if (profErr) console.error("[/users list] profiles", profErr.message);
    const profileMap = Object.fromEntries(
      (profiles ?? []).map((p: { telegram_id: number; first_name?: string; last_name?: string }) => [p.telegram_id, p]),
    );

    const lines = allUsers.map((u) => {
      const p = profileMap[u.telegram_id];
      const fullName = [p?.first_name, p?.last_name].filter(Boolean).join(" ");
      const displayName = fullName || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
      return `• ${displayName}`;
    });
    if (pending.length) {
      lines.push("", `<i>Приглашены, ещё не вошли (${pending.length}):</i>`);
      pending.forEach((u) => lines.push(`⏳ @${u.username}`));
    }

    const userButtons = allUsers.map((u) => [{
      text: `👤 ${profileMap[u.telegram_id]?.first_name || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`)}`,
      callback_data: `pu_${u.telegram_id}`,
    }]);
    userButtons.push([{ text: "➕ Добавить пользователя", callback_data: "ua_add" }]);

    messageId
      ? await editInlineMessage(
        chatId,
        messageId,
        `<b>Пользователи (${allUsers.length}):</b>\n\n${lines.join("\n")}`,
        userButtons,
      )
      : await sendInlineMessage(
        chatId,
        `<b>Пользователи (${allUsers.length}):</b>\n\n${lines.join("\n")}`,
        userButtons,
      );
    return;
  }

  const actor = await loadUsersActor(adminId, groupId);

  if (sub === "add") {
    if (!canAddUsers(actor)) {
      await sendMessage(chatId, NO_RIGHTS);
      return;
    }
    if (!targetArg) {
      await sendMessage(chatId, "Использование: /users add [telegram_id или @username]");
      return;
    }
    // Единый путь для бота и веба — _shared/users/membership.ts (по id: move/insert; по @username:
    // регистронезависимый find-or-insert ожидающей строки). added_by = ADMIN_USER_ID (как в superadmin/web).
    const numeric = /^\d+$/.test(targetArg);
    const result = await assignUserToWorkspace(numeric ? Number(targetArg) : null, numeric ? null : targetArg, groupId);
    if (result !== "ok") {
      await sendMessage(
        chatId,
        result === "workspace_not_found" ? "Спейс не найден." : "Использование: /users add [telegram_id или @username]",
      );
      return;
    }
    await sendMessage(
      chatId,
      numeric
        ? `Пользователь ${targetArg} добавлен.`
        : `@${targetArg.replace(/^@/, "")} добавлен. ID подтянется автоматически, когда напишет боту.`,
    );
    return;
  }

  if (sub === "remove") {
    if (!canAddUsers(actor)) {
      await sendMessage(chatId, NO_RIGHTS);
      return;
    }
    if (!targetArg) {
      await sendMessage(chatId, "Использование: /users remove [telegram_id или @username]");
      return;
    }
    if (targetArg.startsWith("@")) {
      const uname = targetArg.slice(1);
      let del = supabase.from("allowed_users").delete({ count: "exact" }).eq("username", uname).is(
        "telegram_id",
        null,
      );
      if (!isSuperadmin(actor)) del = del.eq("group_id", groupId);
      const { error, count } = await del;
      if (error) {
        await sendMessage(chatId, `Ошибка: ${error.message}`);
        return;
      }
      await sendMessage(chatId, count === 0 ? `@${uname} не найден (без ID).` : `@${uname} удалён (${count} записей).`);
    } else {
      if (isNaN(Number(targetArg))) {
        await sendMessage(chatId, "Использование: /users remove [telegram_id или @username]");
        return;
      }
      if (Number(targetArg) === ADMIN_USER_ID) {
        await sendMessage(chatId, "Нельзя удалить администратора.");
        return;
      }
      if (!(await allowUserAction(chatId, actor, Number(targetArg), "remove"))) return;
      // Только из этого воркспейса: у человека могут быть строки и в других (#674).
      let del = supabase.from("allowed_users").delete({ count: "exact" }).eq(
        "telegram_id",
        Number(targetArg),
      );
      if (!isSuperadmin(actor)) del = del.eq("group_id", groupId);
      const { error, count } = await del;
      if (error) {
        await sendMessage(chatId, `Ошибка: ${error.message}`);
        return;
      }
      await sendMessage(
        chatId,
        count === 0 ? `Пользователь ${targetArg} не найден.` : `Пользователь ${targetArg} удалён.`,
      );
    }
    return;
  }

  if (sub === "profile") {
    const id = Number(targetArg);
    if (targetArg && !isNaN(id) && !(await allowUserAction(chatId, actor, id, "view"))) return;
    await handleUsersProfile(chatId, targetArg ?? "");
    return;
  }

  await sendMessage(
    chatId,
    "Подкоманды: /users list · /users add [id/@username] · /users remove [id] · /users profile [id]",
  );
}

export async function startOnboarding(chatId: number): Promise<void> {
  await setSession(chatId, "onboard_role");
  await externalFetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text:
        "Давай познакомимся! Заполним твой профиль — это займёт минуту.\n\n<b>Шаг 1/4.</b> Какая у тебя роль в команде?\n\n<i>Например: Девелопер, Маркетинг, BD, Операции</i>",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_role" }]] },
    }),
  }, VIA_TELEGRAM);
}

export async function showProfile(chatId: number, targetId: number, messageId?: number): Promise<void> {
  const { data: user } = await supabase
    .from("allowed_users").select("telegram_id, username").eq("telegram_id", targetId).maybeSingle();
  if (!user) {
    await sendMessage(chatId, "Пользователь не найден.");
    return;
  }

  const { data: profile } = await supabase
    .from("user_profiles").select("*").eq("telegram_id", targetId).maybeSingle();

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "—";
  const markets = profile?.markets?.join(", ") || "—";

  const lines = [
    `<b>👤 ${name}</b>`,
    `🔖 @${profile?.username ?? user?.username ?? "—"} (${targetId})`,
    `💼 ${profile?.role || "—"}`,
    `🌍 ${markets}`,
    profile?.email ? `📧 ${profile.email}` : "",
  ].filter(Boolean).join("\n");

  const keyboard = [
    [{ text: "✏️ Редактировать", callback_data: `pe_menu_${targetId}` }, {
      text: "📋 Задачи",
      callback_data: `ptasks_${targetId}`,
    }],
    ...(targetId !== ADMIN_USER_ID ? [[{ text: "🗑 Удалить", callback_data: `udel_${targetId}` }]] : []),
    [{ text: "← Список", callback_data: "ua_list" }],
  ];

  messageId
    ? await editInlineMessage(chatId, messageId, lines, keyboard)
    : await sendInlineMessage(chatId, lines, keyboard);
}

export async function handleProfileTasks(chatId: number, targetId: number): Promise<void> {
  const { data: profile } = await supabase
    .from("user_profiles").select("first_name, last_name").eq("telegram_id", targetId).maybeSingle();
  const { data: user } = await supabase
    .from("allowed_users").select("username").eq("telegram_id", targetId).maybeSingle();

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const searchName = fullName || user?.username || String(targetId);

  const { data: allTasks, error } = await onlyLive(
    supabase
      .from("tasks")
      .select("*"),
  )
    .not("status", "in", '("done","cancelled")')
    .order("due_date", { ascending: true });

  if (error) {
    await sendMessage(chatId, `Ошибка: ${error.message}`);
    return;
  }

  const nameLower = searchName.toLowerCase();
  const tasks = (allTasks ?? [])
    .filter((t: Task) => t.assignees?.some((a: string) => a.toLowerCase().includes(nameLower)))
    .slice(0, 15);

  if (!tasks.length) {
    await sendMessage(chatId, `У <b>${searchName}</b> нет активных задач.`);
    return;
  }

  await sendMessage(chatId, `<b>Задачи · ${searchName}:</b> ${tasks.length} шт.`);
  for (const task of tasks) {
    await sendTaskCard(chatId, task);
  }
}

export async function showProfileEditMenu(chatId: number, targetId: number, messageId?: number): Promise<void> {
  const keyboard = Object.entries(PROFILE_FIELDS).map(([field, label]) => [
    { text: `✏️ ${label}`, callback_data: `pe_${targetId}_${field}` },
  ]);
  keyboard.push([{ text: "← Назад", callback_data: `pu_${targetId}` }]);
  messageId
    ? await editInlineMessage(chatId, messageId, "Что хочешь изменить?", keyboard)
    : await sendInlineMessage(chatId, "Что хочешь изменить?", keyboard);
}

export async function handleBroadcast(chatId: number, adminId: number, text: string, groupId: string): Promise<void> {
  if (!(await isAdminUser(adminId))) {
    await sendMessage(chatId, "Недостаточно прав.");
    return;
  }
  if (!text.trim()) {
    await sendMessage(chatId, "Использование: <code>/broadcast Текст сообщения</code>");
    return;
  }

  const { data: users } = await supabase
    .from("allowed_users")
    .select("telegram_id")
    .eq("group_id", groupId)
    .not("telegram_id", "is", null)
    .neq("telegram_id", ADMIN_USER_ID);

  const ids = (users ?? []).map((u: { telegram_id: number }) => u.telegram_id);
  if (!ids.length) {
    await sendMessage(chatId, "Нет пользователей для рассылки.");
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await sendMessage(id, text.trim());
      sent++;
    } catch {
      failed++;
    }
  }

  await sendMessage(chatId, `✅ Отправлено: <b>${sent}</b>${failed ? `, не доставлено: <b>${failed}</b>` : ""}`);
}

export async function handleUsersProfile(chatId: number, argText: string): Promise<void> {
  const targetArg = argText.trim();
  if (!targetArg || isNaN(Number(targetArg))) {
    await sendMessage(chatId, "Использование: /users profile [telegram_id]");
    return;
  }
  await showProfile(chatId, Number(targetArg));
}

export async function handleProfileEdit(
  chatId: number,
  targetId: number,
  field: string,
  value: string,
): Promise<void> {
  const label = PROFILE_FIELDS[field] ?? field;
  const updateData: Record<string, unknown> = {
    telegram_id: targetId,
    updated_at: new Date().toISOString(),
  };

  if (field === "markets") {
    updateData[field] = value.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    updateData[field] = value.trim();
  }

  await supabase.from("user_profiles").upsert(updateData);

  // Regenerate aliases when name changes
  if (field === "first_name" || field === "last_name") {
    const { data: current } = await supabase
      .from("user_profiles")
      .select("first_name, last_name")
      .eq("telegram_id", targetId)
      .maybeSingle();
    if (current) {
      const aliases = generateNameAliases(
        current.first_name ?? undefined,
        current.last_name ?? undefined,
      );
      await supabase.from("user_profiles")
        .update({ name_aliases: aliases })
        .eq("telegram_id", targetId);
    }
  }

  await sendInlineMessage(chatId, `✅ <b>${label}</b> сохранено.`, [
    [{ text: "✏️ Ещё поля", callback_data: `pe_menu_${targetId}` }, {
      text: "← Профиль",
      callback_data: `pu_${targetId}`,
    }],
  ]);
}

export async function handleUserCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number,
  groupId: string = "",
): Promise<boolean> {
  const data = cb.data;
  const msgId = cb.message.message_id;
  // Права — один раз на любой колбэк этого обработчика (#674).
  const isOurs = data === "ua_list" || data === "ua_add" ||
    /^(udel_|udelc_|ptasks_|pu_|pe_)/.test(data);
  const actor = isOurs ? await loadUsersActor(userId, groupId) : null;

  if (data === "ua_list") {
    await handleUsers(chatId, userId, "list", groupId, msgId);
    return true;
  }
  if (data === "ua_add") {
    if (!actor || !canAddUsers(actor)) {
      await sendMessage(chatId, NO_RIGHTS);
      return true;
    }
    await sendMessage(
      chatId,
      "Для добавления пользователя отправь команду:\n\n<code>/users add @username</code>\n\nили\n\n<code>/users add 123456789</code>",
    );
    return true;
  }
  if (data.startsWith("udel_")) {
    const targetId = Number(data.replace("udel_", ""));
    if (!actor || !(await allowUserAction(chatId, actor, targetId, "remove"))) return true;
    const { data: profile } = await supabase.from("user_profiles").select("first_name, last_name").eq(
      "telegram_id",
      targetId,
    ).maybeSingle();
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || `ID ${targetId}`;
    await editInlineMessage(chatId, msgId, `Удалить <b>${name}</b> из базы?\n\nПользователь потеряет доступ к боту.`, [[
      { text: "✅ Да, удалить", callback_data: `udelc_${targetId}` },
      { text: "Отмена", callback_data: `pu_${targetId}` },
    ]]);
    return true;
  }
  if (data.startsWith("udelc_")) {
    const targetId = Number(data.replace("udelc_", ""));
    if (!actor || !(await allowUserAction(chatId, actor, targetId, "remove"))) return true;
    const { data: profile } = await supabase.from("user_profiles").select("first_name, last_name").eq(
      "telegram_id",
      targetId,
    ).maybeSingle();
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || `ID ${targetId}`;
    // Только из этого воркспейса: у человека могут быть строки и в других (#674).
    let del = supabase.from("allowed_users").delete().eq("telegram_id", targetId);
    if (!isSuperadmin(actor)) del = del.eq("group_id", groupId);
    const { error: delErr } = await del;
    if (delErr) {
      console.error("[users] remove:", delErr.message);
      await sendMessage(chatId, "Не удалось удалить. Попробуй ещё раз.");
      return true;
    }
    await sendMessage(chatId, `✅ ${name} удалён.`);
    await handleUsers(chatId, userId, "list", groupId, msgId);
    return true;
  }
  if (data.startsWith("ptasks_")) {
    const targetId = Number(data.replace("ptasks_", ""));
    if (!actor || !(await allowUserAction(chatId, actor, targetId, "view"))) return true;
    await handleProfileTasks(chatId, targetId);
    return true;
  }
  if (data.startsWith("pu_")) {
    const targetId = Number(data.replace("pu_", ""));
    if (!actor || !(await allowUserAction(chatId, actor, targetId, "view"))) return true;
    await showProfile(chatId, targetId, msgId);
    return true;
  }
  if (data.startsWith("pe_menu_")) {
    const targetId = Number(data.replace("pe_menu_", ""));
    if (!actor || !(await allowUserAction(chatId, actor, targetId, "edit"))) return true;
    await showProfileEditMenu(chatId, targetId, msgId);
    return true;
  }
  if (data.startsWith("pe_")) {
    const parts = data.split("_");
    const targetId = Number(parts[1]);
    const field = parts.slice(2).join("_");
    if (!isEditableProfileField(PROFILE_FIELDS, field)) return true;
    if (!actor || !(await allowUserAction(chatId, actor, targetId, "edit"))) return true;
    const label = PROFILE_FIELDS[field];
    const { data: currentProfile } = await supabase.from("user_profiles").select(field).eq("telegram_id", targetId)
      .maybeSingle();
    const currentValue = (currentProfile as Record<string, unknown> | null)?.[field];
    const currentStr = Array.isArray(currentValue)
      ? (currentValue as string[]).join(", ")
      : (currentValue as string ?? "");
    await setSession(chatId, `profile_${targetId}_${field}`, undefined);
    const hint = currentStr ? `\n\nСейчас: <i>${currentStr}</i>` : "";
    await sendMessage(chatId, `Введи новое значение для <b>${label}</b>:${hint}`);
    return true;
  }
  if (data === "start_onboard") {
    await startOnboarding(chatId);
    return true;
  }
  if (data.startsWith("onboard_skip_")) {
    const step = data.replace("onboard_skip_", "");
    const nextStep: Record<string, string> = {
      role: "onboard_markets",
      markets: "onboard_email",
      email: "onboard_phone",
    };
    const nextMsg: Record<string, string> = {
      role: "<b>Шаг 2/4.</b> За какие рынки/страны отвечаешь?\n\n<i>Перечисли через запятую: Словения, Болгария</i>",
      markets: "<b>Шаг 3/4.</b> Рабочий email?",
      email: "<b>Шаг 4/4.</b> Номер телефона? (необязательно)",
    };
    const nextSkip: Record<string, string> = { role: "markets", markets: "email", email: "phone" };
    if (step === "phone" || !nextStep[step]) {
      await clearSession(chatId);
      await sendMessage(chatId, "Профиль можно дополнить позже через 👥 Пользователи.", buildKeyboard());
    } else {
      await setSession(chatId, nextStep[step]);
      await externalFetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: nextMsg[step],
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "Пропустить →", callback_data: `onboard_skip_${nextSkip[step]}` }]],
          },
        }),
      }, VIA_TELEGRAM);
    }
    return true;
  }
  return false;
}

/* === DISABLED: onboarding and profile session text input — re-enable by calling from index.ts === */
export async function handleUserSessionInput(
  chatId: number,
  userId: number,
  action: string,
  text: string,
  groupId = "",
): Promise<boolean> {
  if (action === "onboard_role") {
    await clearSession(chatId);
    await supabase.from("user_profiles").upsert({
      telegram_id: userId,
      role: text.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "telegram_id" });
    await setSession(chatId, "onboard_markets");
    await externalFetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          "✅ Роль сохранена!\n\n<b>Шаг 2/4.</b> За какие рынки/страны отвечаешь?\n\n<i>Перечисли через запятую: Словения, Болгария, Румыния</i>",
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_markets" }]] },
      }),
    }, VIA_TELEGRAM);
    return true;
  }
  if (action === "onboard_markets") {
    await clearSession(chatId);
    const markets = text.split(",").map((s) => s.trim()).filter(Boolean);
    await supabase.from("user_profiles").upsert(
      { telegram_id: userId, markets, updated_at: new Date().toISOString() },
      { onConflict: "telegram_id" },
    );
    await setSession(chatId, "onboard_email");
    await externalFetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "✅ Рынки сохранены!\n\n<b>Шаг 3/4.</b> Рабочий email?",
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_email" }]] },
      }),
    }, VIA_TELEGRAM);
    return true;
  }
  if (action === "onboard_email") {
    await clearSession(chatId);
    await supabase.from("user_profiles").upsert({
      telegram_id: userId,
      email: text.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "telegram_id" });
    await setSession(chatId, "onboard_phone");
    await externalFetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "✅ Email сохранён!\n\n<b>Шаг 4/4.</b> Номер телефона? (необязательно)",
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_phone" }]] },
      }),
    }, VIA_TELEGRAM);
    return true;
  }
  if (action === "onboard_phone") {
    await clearSession(chatId);
    await supabase.from("user_profiles").upsert({
      telegram_id: userId,
      phone: text.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "telegram_id" });
    await sendMessage(chatId, "✅ Готово! Профиль заполнен.", buildKeyboard());
    await showProfile(chatId, userId);
    return true;
  }
  if (action?.startsWith("profile_")) {
    await clearSession(chatId);
    const parts = action.split("_");
    const targetId = Number(parts[1]);
    const field = parts.slice(2).join("_");
    // Сессию ставит кнопка pe_, но права проверяем заново: между кнопкой и вводом их могли снять (#674).
    if (!isEditableProfileField(PROFILE_FIELDS, field)) return true;
    const actor = await loadUsersActor(userId, groupId);
    if (!(await allowUserAction(chatId, actor, targetId, "edit"))) return true;
    await handleProfileEdit(chatId, targetId, field, text);
    return true;
  }
  return false;
}
