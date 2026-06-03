import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeCountries } from "../_shared/countries.ts";

const ADMIN_TELEGRAM_ID = 744230399;

function json(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

function apiErr(status: number, msg: string, origin: string) {
  return json({ error: msg }, status, origin);
}

export async function handleAdminRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  origin: string,
): Promise<Response | null> {
  if (!routePath.startsWith("/admin")) return null;

  if (telegramId !== ADMIN_TELEGRAM_ID) {
    return apiErr(403, "Forbidden", origin);
  }

  // GET /admin/workspaces
  if (req.method === "GET" && routePath === "/admin/workspaces") {
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id, name, allowed_markets");

    const { data: userCounts } = await supabase
      .from("allowed_users")
      .select("group_id");

    const countMap: Record<string, number> = {};
    for (const row of (userCounts ?? []) as Array<{ group_id: string }>) {
      if (row.group_id) countMap[row.group_id] = (countMap[row.group_id] ?? 0) + 1;
    }

    const result = (workspaces ?? []).map((ws: Record<string, unknown>) => ({
      ...ws,
      user_count: countMap[ws.id as string] ?? 0,
    }));
    return json(result, 200, origin);
  }

  // GET/POST /admin/workspaces/:id/users
  const wsUsersMatch = routePath.match(/^\/admin\/workspaces\/([^/]+)\/users$/);
  if (wsUsersMatch) {
    const wsId = wsUsersMatch[1];

    if (req.method === "GET") {
      const { data: users } = await supabase
        .from("allowed_users")
        .select("telegram_id, username, is_admin, created_at")
        .eq("group_id", wsId);

      const ids = (users ?? [])
        .filter((u: Record<string, unknown>) => u.telegram_id != null)
        .map((u: Record<string, unknown>) => u.telegram_id as number);

      const { data: profiles } = ids.length
        ? await supabase.from("user_profiles").select("telegram_id, first_name, last_name, role, markets").in("telegram_id", ids)
        : { data: [] };

      const profileMap = Object.fromEntries(
        (profiles ?? []).map((p: Record<string, unknown>) => [p.telegram_id, p])
      );

      const result = (users ?? [])
        .filter((u: Record<string, unknown>) => u.telegram_id != null)
        .map((u: Record<string, unknown>) => {
          const p = profileMap[u.telegram_id as number] as Record<string, unknown> | undefined;
          const fullName = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : null;
          return {
            telegram_id: u.telegram_id,
            name: fullName || u.username || String(u.telegram_id),
            username: u.username ?? null,
            is_admin: u.is_admin ?? false,
            role: p?.role ?? null,
            markets: p?.markets ?? [],
            created_at: u.created_at,
          };
        });

      return json(result, 200, origin);
    }

    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }

      const telegramIdToAdd = body.telegram_id as number | undefined;
      const usernameToAdd = body.username as string | undefined;
      if (!telegramIdToAdd && !usernameToAdd) return apiErr(400, "telegram_id or username required", origin);

      if (telegramIdToAdd) {
        await supabase.from("allowed_users").upsert(
          { telegram_id: telegramIdToAdd, group_id: wsId, added_by: ADMIN_TELEGRAM_ID },
          { onConflict: "telegram_id" }
        );
      } else {
        await supabase.from("allowed_users").upsert(
          { username: usernameToAdd, group_id: wsId, added_by: ADMIN_TELEGRAM_ID },
          { onConflict: "username" }
        );
      }
      return json({ ok: true }, 200, origin);
    }
  }

  // DELETE /admin/workspaces/:wsId/users/:userId
  const wsUserMatch = routePath.match(/^\/admin\/workspaces\/([^/]+)\/users\/([^/]+)$/);
  if (wsUserMatch && req.method === "DELETE") {
    const [, wsId, userId] = wsUserMatch;
    if (Number(userId) === ADMIN_TELEGRAM_ID) return apiErr(400, "Cannot remove super admin", origin);
    await supabase.from("allowed_users").delete()
      .eq("telegram_id", Number(userId))
      .eq("group_id", wsId);
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin } });
  }

  // PATCH /admin/workspaces/:id
  const wsPatchMatch = routePath.match(/^\/admin\/workspaces\/([^/]+)$/);
  if (wsPatchMatch && req.method === "PATCH") {
    const wsId = wsPatchMatch[1];
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }

    const fields: Record<string, unknown> = {};
    if ("name" in body && typeof body.name === "string") fields.name = body.name;
    if ("allowed_markets" in body) {
      fields.allowed_markets = body.allowed_markets === null
        ? null
        : normalizeCountries((body.allowed_markets as string[]) ?? []);
    }
    if (!Object.keys(fields).length) return json({ ok: true }, 200, origin);

    await supabase.from("workspaces").update(fields).eq("id", wsId);
    const { data } = await supabase.from("workspaces").select("*").eq("id", wsId).single();
    return json(data, 200, origin);
  }

  return apiErr(404, "Admin route not found", origin);
}
