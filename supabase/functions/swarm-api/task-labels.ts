import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { onlyLive } from "../_shared/tasks/live.ts";
import { createLabel, deleteLabel, type LabelFailure, type LabelRow, updateLabel } from "../_shared/tasks/labels.ts";

function labelFailure(f: LabelFailure, origin: string, where: string): Response {
  if (f.status === 500) return serverError(origin, where, f.cause ?? f.error);
  return json({ error: f.error }, f.status, origin);
}

// Роуты /task-labels и /task-labels/:id — персональные смарт-метки задач.
// Доступ строго свой: все запросы фильтруются owner_id = telegramId (RLS не работает,
// SERVICE_ROLE_KEY). Возвращает null, если путь не про метки (тогда index.ts идёт дальше).

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
    const { data: tasks } = await onlyLive(
      supabase
        .from("tasks")
        .select("label_ids"),
    )
      .eq("owner_id", telegramId)
      .eq("is_private", true);
    const counts = new Map<string, number>();
    for (const t of (tasks ?? []) as Array<{ label_ids: string[] | null }>) {
      for (const id of t.label_ids ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return json(
      rows.map((r) => ({ ...r, count: counts.get(r.id) ?? 0 })),
      200,
      origin,
    );
  }

  // POST /task-labels { name, icon?, color? }
  if (routePath === "/task-labels" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { name?: string; icon?: string; color?: string };
    const res = await createLabel(supabase, telegramId, groupId, body);
    if (!res.ok) return labelFailure(res, origin, "task label create");
    return json({ ...res.value, count: 0 }, 201, origin);
  }

  const m = routePath.match(/^\/task-labels\/([^/]+)$/);
  if (!m) return null;
  const labelId = m[1];

  // PATCH /task-labels/:id — только своя метка (проверка владения в _shared/tasks/labels.ts)
  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const res = await updateLabel(supabase, telegramId, labelId, body);
    if (!res.ok) return labelFailure(res, origin, "task label update");
    return json(res.value, 200, origin);
  }

  // DELETE /task-labels/:id — сначала вычистить id из моих задач, потом удалить метку
  if (req.method === "DELETE") {
    const res = await deleteLabel(supabase, telegramId, labelId);
    if (!res.ok) return labelFailure(res, origin, "task label delete");
    return json({ ok: true }, 200, origin);
  }

  return null;
}
