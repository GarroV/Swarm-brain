// Канон добавления пользователя в воркспейс — ЕДИНАЯ логика для всех дверей (бот `/users add`,
// бот-суперадмин, веб-админка). Эталон — поведение бота, проверенное в бою (2026-07-23):
//   • по telegram_id: юзер уже есть → ПЕРЕМЕЩАЕМ (update group_id, upsert по уникальному
//     telegram_id), иначе вставляем; идемпотентно.
//   • по @username: ищем БЕЗ РЕГИСТРА; строка есть (реальный юзер ИЛИ ожидающая) → обновляем
//     group_id; нет → вставляем ОЖИДАЮЩУЮ (telegram_id=NULL) — она привяжется к telegram_id при
//     первом входе пользователя в бота (см. swarm-bot checkAllowed).
//   • переезд в другой воркспейс сбрасывает is_admin: права админа выданы в прежнем
//     воркспейсе и в новый не переходят. Повторное добавление в тот же — флаг не трогает.
//   • username нормализуем (strip `@`, lower) — чтобы `@User` и `@user` были одной записью.
// Раньше было три расходящихся реализации (баг: веб по @username молча не добавлял, `/users add`
// плодил дубли и не умел перемещать по id). Теперь одна.
import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AddUserResult = { status: "ok" | "bad_input" | "workspace_not_found" | "email_taken"; pending: boolean };

/** Значение для ilike как точное имя: `%`, `_` и обратная косая теряют роль подстановки. */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function normalizeUsername(raw: string): string {
  return raw.replace(/^@/, "").trim().toLowerCase();
}

// Уникальное нарушение (email уже за кем-то) — allowed_users.email UNIQUE по lower(email).
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

/** Поля для записи при добавлении: у уже существующего члена другого воркспейса снимаем is_admin. */
export function resetAdminOnMove(
  prev: { group_id: string | null } | null,
  workspaceId: string,
): { is_admin?: false } {
  return prev && prev.group_id !== workspaceId ? { is_admin: false } : {};
}

export async function addUserToWorkspace(
  supabase: SupabaseClient,
  opts: {
    telegramId?: number | null;
    username?: string | null;
    email?: string | null;
    workspaceId: string;
    addedBy: number;
  },
): Promise<AddUserResult> {
  const telegramId = opts.telegramId ?? null;
  const username = opts.username ? normalizeUsername(opts.username) : "";
  // email — КАНОН веб-входа (allowed_users.email, уникальный по lower). Пусто → не трогаем.
  const email = opts.email && opts.email.trim() ? opts.email.trim().toLowerCase() : null;
  // Добавить можно по telegram_id, @username ИЛИ только по email (веб-вход через Google, без Telegram).
  if (telegramId == null && !username && !email) return { status: "bad_input", pending: false };

  // Воркспейс должен существовать (иначе создавали бы висячие allowed_users с чужим group_id).
  const { data: ws, error: wsErr } = await supabase
    .from("workspaces").select("id").eq("id", opts.workspaceId).maybeSingle();
  if (wsErr) throw new Error(wsErr.message);
  if (!ws) return { status: "workspace_not_found", pending: false };

  if (telegramId != null) {
    const { data: prev, error: prevErr } = await supabase
      .from("allowed_users").select("group_id").eq("telegram_id", telegramId).maybeSingle();
    if (prevErr) throw new Error(prevErr.message);
    const { error } = await supabase.from("allowed_users").upsert(
      {
        telegram_id: telegramId,
        group_id: opts.workspaceId,
        added_by: opts.addedBy,
        ...(email ? { email } : {}),
        ...resetAdminOnMove(prev as { group_id: string | null } | null, opts.workspaceId),
      },
      { onConflict: "telegram_id" },
    );
    if (error) {
      if (isUniqueViolation(error)) return { status: "email_taken", pending: false };
      throw new Error(error.message);
    }
    return { status: "ok", pending: false };
  }

  // email-only приглашение (без Telegram): строка с email, telegram_id=NULL, username=NULL —
  // auth-resolve находит её по email при Google-входе. Find-or-move: email уникален по lower(email).
  if (!username && email) {
    const { data: existing, error: selErr } = await supabase
      .from("allowed_users").select("id, telegram_id, group_id").eq("email", email).limit(1).maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (existing) {
      const row = existing as { id: string; telegram_id: number | null; group_id: string | null };
      const { error } = await supabase.from("allowed_users")
        .update({ group_id: opts.workspaceId, ...resetAdminOnMove(row, opts.workspaceId) }).eq("id", row.id);
      if (error) throw new Error(error.message);
      return { status: "ok", pending: row.telegram_id == null };
    }
    const { error } = await supabase.from("allowed_users")
      .insert({ email, group_id: opts.workspaceId, added_by: opts.addedBy });
    if (error) {
      if (isUniqueViolation(error)) return { status: "email_taken", pending: false };
      throw new Error(error.message);
    }
    return { status: "ok", pending: true };
  }

  // username: нет уникального индекса → onConflict нельзя, делаем find-or-insert без регистра.
  // limit(1)+maybeSingle: не падаем, если исторически образовались дубли (берём первую строку).
  const { data: existing, error: selErr } = await supabase
    .from("allowed_users").select("id, telegram_id, group_id").ilike("username", escapeLike(username)).order("id")
    .limit(1)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) {
    const row = existing as { id: string; telegram_id: number | null; group_id: string | null };
    const { error } = await supabase.from("allowed_users").update({
      group_id: opts.workspaceId,
      ...(email ? { email } : {}),
      ...resetAdminOnMove(row, opts.workspaceId),
    }).eq("id", row.id);
    if (error) {
      if (isUniqueViolation(error)) return { status: "email_taken", pending: false };
      throw new Error(error.message);
    }
    return { status: "ok", pending: row.telegram_id == null };
  }
  const { error } = await supabase.from("allowed_users")
    .insert({ username, group_id: opts.workspaceId, added_by: opts.addedBy, ...(email ? { email } : {}) });
  if (error) {
    if (isUniqueViolation(error)) return { status: "email_taken", pending: false };
    throw new Error(error.message);
  }
  return { status: "ok", pending: true };
}
