import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyInitData } from "./auth.ts";
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
} from "../_shared/tasks/db.ts";
import type { TaskInput } from "../_shared/tasks/types.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const MINIAPP_ORIGIN = Deno.env.get("MINIAPP_ORIGIN") ?? "*";
const MAX_AGE = parseInt(Deno.env.get("INITDATA_MAX_AGE") ?? "86400", 10);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders(origin: string): Record<string, string> {
  const allowOrigin =
    MINIAPP_ORIGIN === "*" ? "*"
    : origin === MINIAPP_ORIGIN ? origin
    : MINIAPP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data: unknown, status = 200, origin = ""): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function apiErr(status: number, message: string, origin = ""): Response {
  return json({ error: message }, status, origin);
}

// Resolve telegram_id → { telegram_id, name } via user_profiles
async function resolveAssignee(
  telegramId: number,
): Promise<{ telegram_id: number; name: string } | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return null;
  const p = data as {
    telegram_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  const name =
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    p.username ||
    String(p.telegram_id);
  return { telegram_id: p.telegram_id, name };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // ── Auth: Authorization: tma <initData> ──────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("tma ")) {
    return apiErr(401, "Unauthorized", origin);
  }
  const initData = authHeader.slice(4).trim();

  const verified = await verifyInitData(initData, BOT_TOKEN, MAX_AGE);
  if (!verified) {
    return apiErr(401, "Unauthorized", origin);
  }
  const { telegram_id, language_code } = verified;

  // ── Resolve workspace ────────────────────────────────────────────────────
  const { data: userRow } = await supabase
    .from("allowed_users")
    .select("group_id")
    .eq("telegram_id", telegram_id)
    .maybeSingle();

  if (!userRow) {
    return apiErr(401, "User not in allowed list", origin);
  }
  const groupId = (userRow as { group_id: string | null }).group_id;
  if (!groupId) {
    return apiErr(403, "No workspace assigned", origin);
  }

  // ── Routing ──────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  // Strip /functions/v1/swarm-api prefix to get the route path
  const routePath = url.pathname.split("/swarm-api").pop() || "/";

  // GET /me
  if (req.method === "GET" && routePath === "/me") {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("first_name, last_name, username")
      .eq("telegram_id", telegram_id)
      .maybeSingle();
    const p = profile as {
      first_name?: string;
      last_name?: string;
      username?: string;
    } | null;
    const name =
      (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username : null) ||
      String(telegram_id);
    return json({ telegram_id, name, group_id: groupId, language: language_code }, 200, origin);
  }

  // GET /users
  if (req.method === "GET" && routePath === "/users") {
    const { data: users } = await supabase
      .from("allowed_users")
      .select("telegram_id, username")
      .eq("group_id", groupId);

    if (!users?.length) return json([], 200, origin);

    const ids = (users as Array<{ telegram_id: number }>).map(u => u.telegram_id);
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("telegram_id, first_name, last_name, username, role, markets")
      .in("telegram_id", ids);

    const profileMap = Object.fromEntries(
      (
        profiles as Array<{
          telegram_id: number;
          first_name?: string;
          last_name?: string;
          username?: string;
          role?: string;
          markets?: string[];
        }> ?? []
      ).map(p => [p.telegram_id, p]),
    );

    const result = (
      users as Array<{ telegram_id: number; username: string | null }>
    ).map(u => {
      const p = profileMap[u.telegram_id];
      return {
        telegram_id: u.telegram_id,
        name:
          (p
            ? [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username
            : null) || String(u.telegram_id),
        username: u.username ?? null,
        role: p?.role ?? null,
        markets: p?.markets ?? [],
      };
    });

    return json(result, 200, origin);
  }

  // GET /tasks or POST /tasks
  if (routePath === "/tasks") {
    if (req.method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      const country = url.searchParams.get("country") ?? undefined;
      const assigneeText = url.searchParams.get("assignee") ?? undefined;
      const mine = url.searchParams.get("mine") === "true";
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;

      const tasks = await listTasks(
        {
          status,
          country,
          assigneeText,
          telegramId: mine ? telegram_id : undefined,
          limit,
        },
        groupId,
      );
      return json(tasks, 200, origin);
    }

    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return apiErr(400, "Invalid JSON", origin);
      }
      if (!body.title || typeof body.title !== "string") {
        return apiErr(400, "title is required", origin);
      }

      let assignees: string[] = [];
      let assignee_telegram_ids: number[] = [];
      if (typeof body.assignee_telegram_id === "number") {
        const resolved = await resolveAssignee(body.assignee_telegram_id);
        if (resolved) {
          assignees = [resolved.name];
          assignee_telegram_ids = [resolved.telegram_id];
        }
      }

      const input: TaskInput = {
        title: body.title as string,
        description: (body.description as string | null) ?? null,
        country: (body.country as string | null) ?? null,
        task_role: (body.task_role as string | null) ?? null,
        due_date: (body.due_date as string | null) ?? null,
        status: (body.status as string) ?? "open",
        source: "mini_app",
        assignees,
        assignee_telegram_ids,
      };

      try {
        const task = await createTask(input, groupId);
        return json(task, 201, origin);
      } catch (e) {
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }
  }

  // GET /tasks/:id, PATCH /tasks/:id, DELETE /tasks/:id
  const taskMatch = routePath.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const taskId = taskMatch[1];

    if (req.method === "GET") {
      const task = await getTask(taskId);
      if (!task || task.group_id !== groupId) return apiErr(404, "Not found", origin);
      return json(task, 200, origin);
    }

    if (req.method === "PATCH") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return apiErr(400, "Invalid JSON", origin);
      }

      const task = await getTask(taskId);
      if (!task || task.group_id !== groupId) return apiErr(404, "Not found", origin);

      const fields: Partial<TaskInput> & { status?: string; due_date?: string | null } = {};
      if (body.title !== undefined) fields.title = body.title as string;
      if (body.description !== undefined) fields.description = body.description as string | null;
      if (body.country !== undefined) fields.country = body.country as string | null;
      if (body.task_role !== undefined) fields.task_role = body.task_role as string | null;
      if ("due_date" in body) fields.due_date = body.due_date as string | null;
      if (body.status !== undefined) fields.status = body.status as string;

      if ("assignee_telegram_id" in body) {
        if (!body.assignee_telegram_id) {
          fields.assignees = [];
          fields.assignee_telegram_ids = [];
        } else if (typeof body.assignee_telegram_id === "number") {
          const resolved = await resolveAssignee(body.assignee_telegram_id);
          if (resolved) {
            fields.assignees = [resolved.name];
            fields.assignee_telegram_ids = [resolved.telegram_id];
          }
        }
      }

      try {
        await updateTask(taskId, fields);
        const updated = await getTask(taskId);
        return json(updated, 200, origin);
      } catch (e) {
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }

    if (req.method === "DELETE") {
      const task = await getTask(taskId);
      if (!task || task.group_id !== groupId) return apiErr(404, "Not found", origin);
      try {
        await deleteTask(taskId);
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      } catch (e) {
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }
  }

  return apiErr(404, "Not found", origin);
});
