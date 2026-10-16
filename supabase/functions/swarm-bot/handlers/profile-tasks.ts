// Задачи человека из его профиля в боте (кнопка «📋 Задачи», callback `ptasks_<id>`).
//
// Только текущее пространство: человек может состоять в нескольких, а выборка задач без
// `group_id` отдала бы задачи чужого пространства, где у исполнителя похожее имя. Цель тоже
// обязана состоять в этом пространстве — иначе ответ null, и бот говорит «нет прав».
import { supabase } from "../lib/supabase.ts";
import { onlyLive } from "../../_shared/tasks/live.ts";
import type { Task } from "../../_shared/tasks/types.ts";

const PROFILE_TASKS_LIMIT = 15;

export type ProfileTasks = { name: string; tasks: Task[] };

export async function loadProfileTasks(targetId: number, groupId: string): Promise<ProfileTasks | null> {
  const { data: member, error: memberErr } = await supabase
    .from("allowed_users").select("username")
    .eq("telegram_id", targetId).eq("group_id", groupId)
    .limit(1).maybeSingle();
  if (memberErr) throw new Error(`profile tasks member: ${memberErr.message}`);
  if (!member) return null;

  const { data: profile } = await supabase
    .from("user_profiles").select("first_name, last_name").eq("telegram_id", targetId).maybeSingle();
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const name = fullName || (member as { username: string | null }).username || String(targetId);

  const { data, error } = await onlyLive(supabase.from("tasks").select("*"))
    .eq("group_id", groupId)
    .not("status", "in", '("done","cancelled")')
    .order("due_date", { ascending: true });
  if (error) throw new Error(`profile tasks: ${error.message}`);

  const nameLower = name.toLowerCase();
  const tasks = ((data ?? []) as Task[])
    .filter((t) => t.assignees?.some((a) => a.toLowerCase().includes(nameLower)))
    .slice(0, PROFILE_TASKS_LIMIT);
  return { name, tasks };
}
