import { supabase, ADMIN_USER_ID } from "../lib/supabase.ts";
import { sendMessage, sendInlineMessage, buildKeyboard } from "../lib/telegram.ts";
import { setSession, clearSession } from "../lib/storage.ts";
import type { Task, TgCallbackQuery } from "../lib/types.ts";
import { sendTaskCard } from "./tasks.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

export const PROFILE_FIELDS: Record<string, string> = {
  first_name: "Имя",
  last_name:  "Фамилия",
  role:       "Роль",
  markets:    "Рынки (через запятую)",
  email:      "Email",
};

export async function handleUsers(chatId: number, adminId: number, argText: string): Promise<void> {
  const parts = argText.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const targetArg = parts[1];

  if (!sub || sub === "list") {
    const { data, error } = await supabase
      .from("allowed_users")
      .select("telegram_id, username")
      .neq("telegram_id", ADMIN_USER_ID)
      .order("created_at");
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }

    const ids = (data ?? []).map((u: { telegram_id: number }) => u.telegram_id);
    const { data: profiles } = await supabase.from("user_profiles").select("*").in("telegram_id", [ADMIN_USER_ID, ...ids]);
    const profileMap = Object.fromEntries((profiles ?? []).map((p: { telegram_id: number; first_name?: string; last_name?: string }) => [p.telegram_id, p]));

    const allUsers = [
      { telegram_id: ADMIN_USER_ID, username: null },
      ...(data ?? []).map((u: { telegram_id: number; username: string | null }) => u),
    ];

    const lines = allUsers.map((u) => {
      const p = profileMap[u.telegram_id];
      const fullName = [p?.first_name, p?.last_name].filter(Boolean).join(" ");
      const displayName = fullName || (u.username ? `@${u.username}` : `ID ${u.telegram_id}`);
      return `• ${displayName}`;
    });

    const userButtons = allUsers.map((u) => [{
      text: `👤 ${profileMap[u.telegram_id]?.first_name ?? (u.username ? `@${u.username}` : `ID ${u.telegram_id}`)}`,
      callback_data: `pu_${u.telegram_id}`,
    }]);
    userButtons.push([{ text: "➕ Добавить пользователя", callback_data: "ua_add" }]);

    await sendInlineMessage(
      chatId,
      `<b>Пользователи (${allUsers.length}):</b>\n\n${lines.join("\n")}`,
      userButtons,
    );
    return;
  }

  if (sub === "add") {
    if (!targetArg) { await sendMessage(chatId, "Использование: /users add [telegram_id или @username]"); return; }
    if (targetArg.startsWith("@")) {
      const uname = targetArg.slice(1);
      const { error } = await supabase.from("allowed_users").insert({ telegram_id: null, username: uname, added_by: adminId });
      if (error) {
        await sendMessage(chatId, error.code === "23505" ? `@${uname} уже в списке.` : `Ошибка: ${error.message}`);
        return;
      }
      await sendMessage(chatId, `@${uname} добавлен. ID подтянется автоматически когда напишет боту.`);
    } else {
      if (isNaN(Number(targetArg))) { await sendMessage(chatId, "Использование: /users add [telegram_id или @username]"); return; }
      const { error } = await supabase.from("allowed_users").insert({ telegram_id: Number(targetArg), added_by: adminId });
      if (error) {
        await sendMessage(chatId, error.code === "23505" ? `Пользователь ${targetArg} уже в списке.` : `Ошибка: ${error.message}`);
        return;
      }
      await sendMessage(chatId, `Пользователь ${targetArg} добавлен.`);
    }
    return;
  }

  if (sub === "remove") {
    if (!targetArg || isNaN(Number(targetArg))) { await sendMessage(chatId, "Использование: /users remove [telegram_id]"); return; }
    if (Number(targetArg) === ADMIN_USER_ID) { await sendMessage(chatId, "Нельзя удалить администратора."); return; }
    const { error, count } = await supabase.from("allowed_users").delete({ count: "exact" }).eq("telegram_id", Number(targetArg));
    if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }
    await sendMessage(chatId, count === 0 ? `Пользователь ${targetArg} не найден.` : `Пользователь ${targetArg} удалён.`);
    return;
  }

  if (sub === "profile") {
    await handleUsersProfile(chatId, targetArg ?? "");
    return;
  }

  await sendMessage(chatId, "Подкоманды: /users list · /users add [id/@username] · /users remove [id] · /users profile [id]");
}

export async function startOnboarding(chatId: number): Promise<void> {
  await setSession(chatId, "onboard_role");
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Давай познакомимся! Заполним твой профиль — это займёт минуту.\n\n<b>Шаг 1/4.</b> Какая у тебя роль в команде?\n\n<i>Например: Девелопер, Маркетинг, BD, Операции</i>",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_role" }]] },
    }),
  });
}

export async function showProfile(chatId: number, targetId: number): Promise<void> {
  const { data: user } = await supabase
    .from("allowed_users").select("telegram_id, username").eq("telegram_id", targetId).maybeSingle();
  if (!user) { await sendMessage(chatId, "Пользователь не найден."); return; }

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
    [{ text: "✏️ Редактировать", callback_data: `pe_menu_${targetId}` }, { text: "📋 Задачи", callback_data: `ptasks_${targetId}` }],
    ...(targetId !== ADMIN_USER_ID ? [[{ text: "🗑 Удалить", callback_data: `udel_${targetId}` }]] : []),
    [{ text: "← Список", callback_data: "ua_list" }],
  ];

  await sendInlineMessage(chatId, lines, keyboard);
}

export async function handleProfileTasks(chatId: number, targetId: number): Promise<void> {
  const { data: profile } = await supabase
    .from("user_profiles").select("first_name, last_name").eq("telegram_id", targetId).maybeSingle();
  const { data: user } = await supabase
    .from("allowed_users").select("username").eq("telegram_id", targetId).maybeSingle();

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const searchName = fullName || user?.username || String(targetId);

  const { data: allTasks, error } = await supabase
    .from("tasks")
    .select("*")
    .not("status", "in", '("done","cancelled")')
    .order("due_date", { ascending: true });

  if (error) { await sendMessage(chatId, `Ошибка: ${error.message}`); return; }

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

export async function showProfileEditMenu(chatId: number, targetId: number): Promise<void> {
  const keyboard = Object.entries(PROFILE_FIELDS).map(([field, label]) => [
    { text: `✏️ ${label}`, callback_data: `pe_${targetId}_${field}` },
  ]);
  keyboard.push([{ text: "← Назад", callback_data: `pu_${targetId}` }]);
  await sendInlineMessage(chatId, "Что хочешь изменить?", keyboard);
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
  value: string
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
  await sendMessage(chatId, `✅ ${label} обновлено.`);
  await showProfile(chatId, targetId);
}

export async function handleUserCallbacks(
  cb: TgCallbackQuery,
  chatId: number,
  userId: number
): Promise<boolean> {
  const data = cb.data;

  if (data === "ua_list") {
    await handleUsers(chatId, userId, "list");
    return true;
  }
  if (data === "ua_add") {
    await setSession(chatId, "user_add");
    await sendMessage(chatId, "Введи Telegram username или ID нового пользователя:\n\n<i>Например: @username или 123456789</i>");
    return true;
  }
  if (data.startsWith("udel_")) {
    const targetId = Number(data.replace("udel_", ""));
    const { data: profile } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", targetId).maybeSingle();
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || `ID ${targetId}`;
    await sendInlineMessage(chatId, `Удалить <b>${name}</b> из базы?\n\nПользователь потеряет доступ к боту.`, [[
      { text: "✅ Да, удалить", callback_data: `udelc_${targetId}` },
      { text: "Отмена", callback_data: `pu_${targetId}` },
    ]]);
    return true;
  }
  if (data.startsWith("udelc_")) {
    const targetId = Number(data.replace("udelc_", ""));
    const { data: profile } = await supabase.from("user_profiles").select("first_name, last_name").eq("telegram_id", targetId).maybeSingle();
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || `ID ${targetId}`;
    await supabase.from("allowed_users").delete().eq("telegram_id", targetId);
    await sendMessage(chatId, `✅ ${name} удалён.`);
    await handleUsers(chatId, userId, "list");
    return true;
  }
  if (data.startsWith("ptasks_")) {
    await handleProfileTasks(chatId, Number(data.replace("ptasks_", "")));
    return true;
  }
  if (data.startsWith("pu_")) {
    await showProfile(chatId, Number(data.replace("pu_", "")));
    return true;
  }
  if (data.startsWith("pe_menu_")) {
    await showProfileEditMenu(chatId, Number(data.replace("pe_menu_", "")));
    return true;
  }
  if (data.startsWith("pe_")) {
    const parts = data.split("_");
    const targetId = Number(parts[1]);
    const field = parts.slice(2).join("_");
    const label = PROFILE_FIELDS[field] ?? field;
    const { data: currentProfile } = await supabase.from("user_profiles").select(field).eq("telegram_id", targetId).maybeSingle();
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
    const nextStep: Record<string, string> = { role: "onboard_markets", markets: "onboard_email", email: "onboard_phone" };
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
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: nextMsg[step], parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: `onboard_skip_${nextSkip[step]}` }]] } }),
      });
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
  text: string
): Promise<boolean> {
  if (action === "user_add") {
    await clearSession(chatId);
    const input = text.trim();
    if (input.startsWith("@")) {
      const uname = input.slice(1);
      const { error } = await supabase.from("allowed_users").insert({ telegram_id: null, username: uname, added_by: userId });
      if (error) {
        await sendMessage(chatId, error.code === "23505" ? `@${uname} уже в списке.` : `Ошибка: ${error.message}`);
      } else {
        await sendMessage(chatId, `✅ @${uname} добавлен. ID подтянется автоматически когда напишет боту.`);
        await handleUsers(chatId, userId, "list");
      }
    } else if (!isNaN(Number(input))) {
      const { error } = await supabase.from("allowed_users").insert({ telegram_id: Number(input), added_by: userId });
      if (error) {
        await sendMessage(chatId, error.code === "23505" ? `Пользователь ${input} уже в списке.` : `Ошибка: ${error.message}`);
      } else {
        await sendMessage(chatId, `✅ Пользователь ${input} добавлен.`);
        await handleUsers(chatId, userId, "list");
      }
    } else {
      await sendMessage(chatId, "Не понял. Введи @username или числовой Telegram ID.");
    }
    return true;
  }
  if (action === "onboard_role") {
    await clearSession(chatId);
    await supabase.from("user_profiles").upsert({ telegram_id: userId, role: text.trim(), updated_at: new Date().toISOString() }, { onConflict: "telegram_id" });
    await setSession(chatId, "onboard_markets");
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "✅ Роль сохранена!\n\n<b>Шаг 2/4.</b> За какие рынки/страны отвечаешь?\n\n<i>Перечисли через запятую: Словения, Болгария, Румыния</i>", parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_markets" }]] } }),
    });
    return true;
  }
  if (action === "onboard_markets") {
    await clearSession(chatId);
    const markets = text.split(",").map(s => s.trim()).filter(Boolean);
    await supabase.from("user_profiles").upsert({ telegram_id: userId, markets, updated_at: new Date().toISOString() }, { onConflict: "telegram_id" });
    await setSession(chatId, "onboard_email");
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "✅ Рынки сохранены!\n\n<b>Шаг 3/4.</b> Рабочий email?", parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_email" }]] } }),
    });
    return true;
  }
  if (action === "onboard_email") {
    await clearSession(chatId);
    await supabase.from("user_profiles").upsert({ telegram_id: userId, email: text.trim(), updated_at: new Date().toISOString() }, { onConflict: "telegram_id" });
    await setSession(chatId, "onboard_phone");
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "✅ Email сохранён!\n\n<b>Шаг 4/4.</b> Номер телефона? (необязательно)", parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Пропустить →", callback_data: "onboard_skip_phone" }]] } }),
    });
    return true;
  }
  if (action === "onboard_phone") {
    await clearSession(chatId);
    await supabase.from("user_profiles").upsert({ telegram_id: userId, phone: text.trim(), updated_at: new Date().toISOString() }, { onConflict: "telegram_id" });
    await sendMessage(chatId, "✅ Готово! Профиль заполнен.", buildKeyboard());
    await showProfile(chatId, userId);
    return true;
  }
  if (action?.startsWith("profile_")) {
    await clearSession(chatId);
    const parts = action.split("_");
    const targetId = Number(parts[1]);
    const field = parts.slice(2).join("_");
    await handleProfileEdit(chatId, targetId, field, text);
    return true;
  }
  return false;
}
