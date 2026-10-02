// Личные метки задач — одно место для веба (swarm-api/task-labels.ts) и MCP (issue #520).
// Доступ строго свой: каждый запрос фильтруется owner_id (RLS не авторизация, всё ходит
// service_role). Метку не своего человека не видно и не тронуть — ответ «не найдена».
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Db = Pick<SupabaseClient, "from">;

export type LabelRow = {
  id: string;
  name: string;
  icon: string;
  color: string | null;
  sort_order: number;
};

const LABEL_COLUMNS = "id,name,icon,color,sort_order";

export type LabelFailure = { ok: false; status: 400 | 404 | 500; error: string; cause?: unknown };
export type LabelResult<T> = { ok: true; value: T } | LabelFailure;

/** Название метки: обрезанное и непустое. */
export function labelNameError(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return "Название метки обязательно";
  return null;
}

export async function createLabel(
  db: Db,
  ownerId: number,
  groupId: string | null,
  input: { name?: unknown; icon?: string; color?: string | null },
): Promise<LabelResult<LabelRow>> {
  const nameErr = labelNameError(input.name);
  if (nameErr) return { ok: false, status: 400, error: nameErr };
  const { data, error } = await db
    .from("task_labels")
    .insert({
      owner_id: ownerId,
      group_id: groupId,
      name: (input.name as string).trim(),
      icon: input.icon ?? "tag",
      color: input.color ?? null,
    })
    .select(LABEL_COLUMNS)
    .single();
  if (error) return { ok: false, status: 500, error: "label create failed", cause: error };
  return { ok: true, value: data as LabelRow };
}

/** Своя ли метка. Ошибка чтения — тоже «не найдена» для человека, но с причиной для лога. */
async function ownsLabel(db: Db, ownerId: number, labelId: string): Promise<LabelFailure | null> {
  const { data, error } = await db
    .from("task_labels").select("id").eq("id", labelId).eq("owner_id", ownerId).maybeSingle();
  if (error) return { ok: false, status: 500, error: "label read failed", cause: error };
  if (!data) return { ok: false, status: 404, error: "Метка не найдена" };
  return null;
}

export async function updateLabel(
  db: Db,
  ownerId: number,
  labelId: string,
  patch: Partial<{ name: unknown; icon: unknown; color: unknown; sort_order: unknown }>,
): Promise<LabelResult<LabelRow>> {
  const denied = await ownsLabel(db, ownerId, labelId);
  if (denied) return denied;
  const fields: Record<string, unknown> = {};
  if ("name" in patch) {
    const nameErr = labelNameError(patch.name);
    if (nameErr) return { ok: false, status: 400, error: nameErr };
    fields.name = (patch.name as string).trim();
  }
  if (typeof patch.icon === "string") fields.icon = patch.icon;
  if ("color" in patch) fields.color = patch.color ?? null;
  if (typeof patch.sort_order === "number") fields.sort_order = patch.sort_order;
  const { data, error } = await db
    .from("task_labels").update(fields).eq("id", labelId).eq("owner_id", ownerId)
    .select(LABEL_COLUMNS).single();
  if (error) return { ok: false, status: 500, error: "label update failed", cause: error };
  return { ok: true, value: data as LabelRow };
}

/** Удаление: сначала метка вычищается из задач владельца (и архивных тоже), потом удаляется. */
export async function deleteLabel(db: Db, ownerId: number, labelId: string): Promise<LabelResult<null>> {
  const denied = await ownsLabel(db, ownerId, labelId);
  if (denied) return denied;
  // archive-ok: удаление метки вычищает её из ВСЕХ задач владельца, архив тоже — иначе вернувшаяся задача несла бы метку-призрак
  const { data: tasksWith, error: readErr } = await db
    .from("tasks").select("id,label_ids").eq("owner_id", ownerId).contains("label_ids", [labelId]);
  if (readErr) return { ok: false, status: 500, error: "label tasks read failed", cause: readErr };
  for (const t of (tasksWith ?? []) as Array<{ id: string; label_ids: string[] }>) {
    const { error } = await db.from("tasks")
      .update({ label_ids: t.label_ids.filter((x) => x !== labelId) }).eq("id", t.id);
    if (error) return { ok: false, status: 500, error: "label untag failed", cause: error };
  }
  const { error } = await db.from("task_labels").delete().eq("id", labelId).eq("owner_id", ownerId);
  if (error) return { ok: false, status: 500, error: "label delete failed", cause: error };
  return { ok: true, value: null };
}
