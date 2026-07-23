// Канон добавления пользователя в воркспейс — ЕДИНАЯ логика для всех дверей (бот `/users add`,
// бот-суперадмин, веб-админка). Эталон — поведение бота, проверенное в бою (2026-07-23):
//   • по telegram_id: юзер уже есть → ПЕРЕМЕЩАЕМ (update group_id, upsert по уникальному
//     telegram_id), иначе вставляем; идемпотентно.
//   • по @username: ищем БЕЗ РЕГИСТРА; строка есть (реальный юзер ИЛИ ожидающая) → обновляем
//     group_id; нет → вставляем ОЖИДАЮЩУЮ (telegram_id=NULL) — она привяжется к telegram_id при
//     первом входе пользователя в бота (см. swarm-bot checkAllowed).
//   • username нормализуем (strip `@`, lower) — чтобы `@User` и `@user` были одной записью.
// Раньше было три расходящихся реализации (баг: веб по @username молча не добавлял, `/users add`
// плодил дубли и не умел перемещать по id). Теперь одна.
import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AddUserResult = { status: "ok" | "bad_input" | "workspace_not_found"; pending: boolean };

export function normalizeUsername(raw: string): string {
  return raw.replace(/^@/, "").trim().toLowerCase();
}

export async function addUserToWorkspace(
  supabase: SupabaseClient,
  opts: { telegramId?: number | null; username?: string | null; workspaceId: string; addedBy: number },
): Promise<AddUserResult> {
  const telegramId = opts.telegramId ?? null;
  const username = opts.username ? normalizeUsername(opts.username) : "";
  if (telegramId == null && !username) return { status: "bad_input", pending: false };

  // Воркспейс должен существовать (иначе создавали бы висячие allowed_users с чужим group_id).
  const { data: ws, error: wsErr } = await supabase
    .from("workspaces").select("id").eq("id", opts.workspaceId).maybeSingle();
  if (wsErr) throw new Error(wsErr.message);
  if (!ws) return { status: "workspace_not_found", pending: false };

  if (telegramId != null) {
    const { error } = await supabase.from("allowed_users").upsert(
      { telegram_id: telegramId, group_id: opts.workspaceId, added_by: opts.addedBy },
      { onConflict: "telegram_id" },
    );
    if (error) throw new Error(error.message);
    return { status: "ok", pending: false };
  }

  // username: нет уникального индекса → onConflict нельзя, делаем find-or-insert без регистра.
  // limit(1)+maybeSingle: не падаем, если исторически образовались дубли (берём первую строку).
  const { data: existing, error: selErr } = await supabase
    .from("allowed_users").select("id, telegram_id").ilike("username", username).limit(1).maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) {
    const row = existing as { id: string; telegram_id: number | null };
    const { error } = await supabase.from("allowed_users").update({ group_id: opts.workspaceId }).eq("id", row.id);
    if (error) throw new Error(error.message);
    return { status: "ok", pending: row.telegram_id == null };
  }
  const { error } = await supabase.from("allowed_users")
    .insert({ username, group_id: opts.workspaceId, added_by: opts.addedBy });
  if (error) throw new Error(error.message);
  return { status: "ok", pending: true };
}
