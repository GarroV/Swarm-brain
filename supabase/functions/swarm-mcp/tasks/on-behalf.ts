// Создатель «от имени» в add_task — для заливок задач из чужих систем (решение владельца
// 12.10.2026, docs/decisions/2026-10-12-notion-import-creator.md). Заливку делает один человек
// через Claude, а создателем должен стоять тот, кто ведёт проект: создатель — причастный к
// задаче, ему идут уведомления о комментариях (`_shared/tasks/notify.ts`).
//
// Подставить создателя = записать задачу от чужого имени, поэтому:
// - только админ и только на участника своего пространства;
// - след в журнале задачи: кто на самом деле завёл;
// - подставленному создателю по умолчанию ставится явный отказ от уведомлений (muted), если он
//   не исполнитель — заливка не должна будить человека пушами о чужих комментариях.
// Писать людям этот путь не начинает ничего: ни сообщения, ни колокольчика.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export type OnBehalfCaller = { telegramId: number; groupId: string; isAdmin: boolean };
export type OnBehalfTarget = { telegramId: number; groupId: string | null };

/** Причина отказа или null, если подставлять можно. */
export function onBehalfDenial(caller: OnBehalfCaller, target: OnBehalfTarget | null): string | null {
  if (!target) return "Ошибка: создатель не найден среди пользователей.";
  if (target.telegramId === caller.telegramId) return null;
  if (!caller.isAdmin) return "Ошибка: ставить создателем другого человека может только админ.";
  if (!target.groupId || target.groupId !== caller.groupId) {
    return "Ошибка: создатель должен быть участником твоего пространства.";
  }
  return null;
}

/** Глушить ли уведомления подставленному создателю. Исполнителя не глушим: muted сильнее причастности. */
export function shouldMuteCreator(
  a: { creator: number; caller: number; assignees: number[]; mute: boolean },
): boolean {
  return a.mute && a.creator !== a.caller && !a.assignees.includes(a.creator);
}

/** Админство тем же правилом, что в swarm-api и sprints.ts. */
export async function loadCaller(
  telegramId: number,
  groupId: string,
  adminId: number,
  // Мастер-админ по данным (#233), вычислен вызывающим; нет — по константе adminId, как раньше.
  isMaster?: boolean,
): Promise<OnBehalfCaller> {
  const { data, error } = await supabase.from("allowed_users")
    .select("is_admin").eq("telegram_id", telegramId).maybeSingle();
  if (error) throw new Error(`Не удалось проверить права: ${error.message}`);
  const row = data as { is_admin: boolean | null } | null;
  return { telegramId, groupId, isAdmin: (isMaster ?? telegramId === adminId) || row?.is_admin === true };
}

export async function loadTarget(telegramId: number): Promise<OnBehalfTarget | null> {
  const { data, error } = await supabase.from("allowed_users")
    .select("telegram_id, group_id").eq("telegram_id", telegramId).maybeSingle();
  if (error) throw new Error(`Не удалось найти создателя: ${error.message}`);
  const row = data as { telegram_id: number; group_id: string | null } | null;
  return row ? { telegramId: row.telegram_id, groupId: row.group_id } : null;
}

/**
 * След подмены и отказ от уведомлений — после создания задачи. Сбой здесь не откатывает задачу,
 * а возвращается предупреждением: задача уже есть, а молча потерянный след хуже громкого.
 */
export async function recordOnBehalf(a: {
  taskId: string;
  groupId: string;
  caller: number;
  callerName: string;
  creator: number;
  creatorName: string;
  mute: boolean;
}): Promise<string> {
  const warnings: string[] = [];
  const { error: hErr } = await supabase.from("task_history").insert({
    task_id: a.taskId,
    field: "created_by",
    old_value: String(a.caller),
    new_value: String(a.creator),
    changed_by: a.callerName,
    changed_by_telegram_id: a.caller,
    group_id: a.groupId,
    note: `создана ${a.callerName} от имени ${a.creatorName}`,
  });
  if (hErr) warnings.push(`журнал не записан: ${hErr.message}`);

  if (a.mute) {
    const { error: sErr } = await supabase.from("task_subscriptions").upsert(
      { task_id: a.taskId, telegram_id: a.creator, state: "muted", reason: "manual" },
      { onConflict: "task_id,telegram_id", ignoreDuplicates: true },
    );
    if (sErr) warnings.push(`уведомления создателю не выключены: ${sErr.message}`);
  }
  return warnings.length ? ` ⚠️ ${warnings.join("; ")}` : "";
}
