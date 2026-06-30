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

  // GET /admin/review-counts — СВОДКА «сколько встреч на вычитке у каждого участника».
  // Только агрегат (имя + число), БЕЗ доступа к чужому контенту — для пригляда админа.
  // Считаем по воркспейсу админа: непубликованные entry (Granola/Read.ai, confirmed null/false)
  // по владельцу + черновики рекордера (awaiting_review) по каждому записавшему.
  if (req.method === "GET" && routePath === "/admin/review-counts") {
    const { data: adminRow } = await supabase
      .from("allowed_users").select("group_id").eq("telegram_id", telegramId).maybeSingle();
    const groupId = (adminRow as { group_id?: string } | null)?.group_id;
    if (!groupId) return json([], 200, origin);

    const [entRes, mtgRes] = await Promise.all([
      supabase.from("entries").select("owner_id, metadata")
        .eq("group_id", groupId).eq("entry_type", "meeting")
        .or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false"),
      supabase.from("meetings").select("recorders")
        .eq("group_id", groupId).eq("status", "awaiting_review"),
    ]);

    const counts = new Map<number, number>();
    const bump = (id: number | null | undefined) => {
      if (typeof id === "number") counts.set(id, (counts.get(id) ?? 0) + 1);
    };
    for (const e of (entRes.data ?? []) as Array<{ owner_id: number | null; metadata: { added_by_telegram_id?: number } | null }>) {
      bump(e.owner_id ?? e.metadata?.added_by_telegram_id ?? null);
    }
    for (const m of (mtgRes.data ?? []) as Array<{ recorders: Array<{ telegram_id: number }> | null }>) {
      for (const r of (m.recorders ?? [])) bump(r.telegram_id);
    }

    const ids = [...counts.keys()];
    const { data: profs } = ids.length
      ? await supabase.from("user_profiles").select("telegram_id, first_name, last_name").in("telegram_id", ids)
      : { data: [] as Array<{ telegram_id: number; first_name?: string; last_name?: string }> };
    const nameById = new Map<number, string>();
    for (const p of (profs ?? []) as Array<{ telegram_id: number; first_name?: string; last_name?: string }>) {
      nameById.set(p.telegram_id, [p.first_name, p.last_name].filter(Boolean).join(" ") || `#${p.telegram_id}`);
    }
    const result = ids
      .map((id) => ({ telegram_id: id, name: nameById.get(id) ?? `#${id}`, count: counts.get(id)! }))
      .sort((a, b) => b.count - a.count);
    return json(result, 200, origin);
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

  // POST /admin/workspaces — создать воркспейс (id = slug, как в боте sa_create)
  if (req.method === "POST" && routePath === "/admin/workspaces") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
    const id = String(body.id ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const name = String(body.name ?? "").trim();
    if (!id) return apiErr(400, "id обязателен (a-z, 0-9, -)", origin);
    if (!name) return apiErr(400, "name обязателен", origin);
    const { data: existing } = await supabase.from("workspaces").select("id").eq("id", id).maybeSingle();
    if (existing) return apiErr(409, `Воркспейс «${id}» уже существует`, origin);
    const { error } = await supabase.from("workspaces").insert({ id, name });
    if (error) return apiErr(500, error.message, origin);
    return json({ id, name, allowed_markets: null, user_count: 0 }, 201, origin);
  }

  // POST /admin/broadcast — рассылка всем пользователям системы (как бот /broadcast, но superadmin-wide)
  if (req.method === "POST" && routePath === "/admin/broadcast") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }
    const text = String(body.text ?? "").trim();
    if (!text) return apiErr(400, "Текст обязателен", origin);
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return apiErr(500, "Bot token не настроен", origin);

    const { data: users } = await supabase
      .from("allowed_users").select("telegram_id").not("telegram_id", "is", null);
    const ids = [...new Set((users ?? []).map((u: Record<string, unknown>) => u.telegram_id as number))]
      .filter((id) => id !== ADMIN_TELEGRAM_ID);

    let sent = 0, failed = 0;
    for (const id of ids) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: id, text, disable_web_page_preview: true }),
        });
        if (r.ok) sent++; else failed++;
      } catch { failed++; }
    }
    return json({ sent, failed, total: ids.length }, 200, origin);
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
        ? await supabase.from("user_profiles").select("telegram_id, first_name, last_name, role, markets, email, phone, notes").in("telegram_id", ids)
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
            first_name: p?.first_name ?? null,
            last_name: p?.last_name ?? null,
            email: p?.email ?? null,
            phone: p?.phone ?? null,
            notes: p?.notes ?? null,
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

  // PATCH /admin/users/:telegramId — правка профиля пользователя (user_profiles)
  const userPatchMatch = routePath.match(/^\/admin\/users\/([^/]+)$/);
  if (userPatchMatch && req.method === "PATCH") {
    const targetId = Number(userPatchMatch[1]);
    if (!targetId) return apiErr(400, "Invalid user id", origin);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }

    const fields: Record<string, unknown> = { telegram_id: targetId, updated_at: new Date().toISOString() };
    for (const k of ["first_name", "last_name", "role", "email", "phone", "notes"]) {
      if (k in body) fields[k] = body[k] === "" ? null : body[k];
    }
    if ("markets" in body) {
      fields.markets = Array.isArray(body.markets) ? body.markets : [];
    }
    const { error } = await supabase.from("user_profiles").upsert(fields, { onConflict: "telegram_id" });
    if (error) return apiErr(500, error.message, origin);
    const { data } = await supabase.from("user_profiles").select("*").eq("telegram_id", targetId).single();
    return json(data, 200, origin);
  }

  return apiErr(404, "Admin route not found", origin);
}
