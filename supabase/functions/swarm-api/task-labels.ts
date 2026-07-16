import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";

// Роуты /task-labels и /task-labels/:id — персональные смарт-метки задач.
// Доступ строго свой: все запросы фильтруются owner_id = telegramId (RLS не работает,
// SERVICE_ROLE_KEY). Возвращает null, если путь не про метки (тогда index.ts идёт дальше).

type LabelRow = { id: string; name: string; icon: string; color: string | null; sort_order: number };

export async function handleTaskLabelRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string | null,
  origin: string,
): Promise<Response | null> {
  // GET /task-labels — мои метки + счётчик задач в каждой
  if (routePath === "/task-labels" && req.method === "GET") {
    const { data: labels } = await supabase
      .from("task_labels")
      .select("id,name,icon,color,sort_order")
      .eq("owner_id", telegramId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    const rows = (labels ?? []) as LabelRow[];
    // Счётчики: тянем label_ids моих личных задач и считаем на месте.
    const { data: tasks } = await supabase
      .from("tasks")
      .select("label_ids")
      .eq("owner_id", telegramId)
      .eq("is_private", true);
    const counts = new Map<string, number>();
    for (const t of (tasks ?? []) as Array<{ label_ids: string[] | null }>) {
      for (const id of t.label_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return json(rows.map((r) => ({ ...r, count: counts.get(r.id) ?? 0 })), 200, origin);
  }

  // POST /task-labels { name, icon?, color? }
  if (routePath === "/task-labels" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { name?: string; icon?: string; color?: string };
    const name = (body.name ?? "").trim();
    if (!name) return json({ error: "Название метки обязательно" }, 400, origin);
    const { data, error } = await supabase
      .from("task_labels")
      .insert({ owner_id: telegramId, group_id: groupId, name, icon: body.icon ?? "tag", color: body.color ?? null })
      .select("id,name,icon,color,sort_order")
      .single();
    if (error) return json({ error: error.message }, 500, origin);
    return json({ ...(data as LabelRow), count: 0 }, 201, origin);
  }

  const m = routePath.match(/^\/task-labels\/([^/]+)$/);
  if (!m) return null;
  const labelId = m[1];

  // Владение: править/удалять можно только свою метку
  const { data: owned } = await supabase
    .from("task_labels").select("id").eq("id", labelId).eq("owner_id", telegramId).maybeSingle();
  if (!owned) return json({ error: "Метка не найдена" }, 404, origin);

  // PATCH /task-labels/:id
  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({})) as Partial<{ name: string; icon: string; color: string | null; sort_order: number }>;
    const fields: Record<string, unknown> = {};
    if (typeof body.name === "string") fields.name = body.name.trim();
    if (typeof body.icon === "string") fields.icon = body.icon;
    if ("color" in body) fields.color = body.color ?? null;
    if (typeof body.sort_order === "number") fields.sort_order = body.sort_order;
    const { data, error } = await supabase
      .from("task_labels").update(fields).eq("id", labelId).eq("owner_id", telegramId)
      .select("id,name,icon,color,sort_order").single();
    if (error) return json({ error: error.message }, 500, origin);
    return json(data, 200, origin);
  }

  // DELETE /task-labels/:id — сначала вычистить id из моих задач, потом удалить метку
  if (req.method === "DELETE") {
    const { data: tasksWith } = await supabase
      .from("tasks").select("id,label_ids").eq("owner_id", telegramId).contains("label_ids", [labelId]);
    for (const t of (tasksWith ?? []) as Array<{ id: string; label_ids: string[] }>) {
      await supabase.from("tasks").update({ label_ids: t.label_ids.filter((x) => x !== labelId) }).eq("id", t.id);
    }
    await supabase.from("task_labels").delete().eq("id", labelId).eq("owner_id", telegramId);
    return json({ ok: true }, 200, origin);
  }

  return null;
}
