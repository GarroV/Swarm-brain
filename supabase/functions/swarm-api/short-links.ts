import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { generateShortCode, normalizeTargetUrl, SHORT_CODE_RE } from "./short-links-core.ts";

// Сокращатель ссылок («Полезности»).
//   • GET  /public/s/:code     — БЕЗ авторизации: адрес для переадресации + счётчик клика.
//                                Зовёт только Pages Function веба `functions/s/[code].ts`.
//   • GET  /short-links        — мои ссылки (owner_id), без архивных.
//   • POST /short-links {url}  — создать.
//   • DELETE /short-links/:code — убрать свою (архивация, физически не удаляем).
// Доступ — только в коде (service_role, RLS не защищает): чужие ссылки не видны и не трогаются.

// Хосты, на которых живёт `/s/…`: ссылка на них же — петля. Свой домен добавится сюда.
export const SHORT_LINK_HOSTS = ["swarm-brain.pages.dev"] as const;

const LIST_LIMIT = 100;
const DAILY_CREATE_LIMIT = 200;
const CODE_ATTEMPTS = 5;
const PUBLIC_RE = /^\/public\/s\/([^/]+)$/;
const ITEM_RE = /^\/short-links\/([^/]+)$/;
const COLUMNS = "code,url,clicks,last_clicked_at,created_at";

export function isPublicShortLinkPath(routePath: string): boolean {
  return PUBLIC_RE.test(routePath);
}

/** Публичный переход. Вызывается index.ts до авторизации. Наружу — только адрес. */
export async function handlePublicShortLink(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
): Promise<Response> {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (req.method !== "GET") return new Response(null, { status: 405, headers });
  const code = routePath.match(PUBLIC_RE)?.[1] ?? "";
  if (!SHORT_CODE_RE.test(code)) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });

  const { data, error } = await supabase.rpc("short_link_hit", { p_code: code });
  if (error) {
    console.error("[short-links] hit failed:", error.message);
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers });
  }
  const url = typeof data === "string" ? data : null;
  if (!url) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
  return new Response(JSON.stringify({ url }), { status: 200, headers });
}

type Ctx = { supabase: SupabaseClient; telegramId: number; groupId: string | null; isDemo: boolean; origin: string };

/** Роуты /short-links*. null — путь не про сокращатель, index.ts идёт дальше. */
export async function handleShortLinkRoutes(ctx: Ctx, req: Request, routePath: string): Promise<Response | null> {
  if (routePath === "/short-links" && req.method === "GET") return await listMine(ctx);
  if (routePath === "/short-links" && req.method === "POST") return await create(ctx, req);
  const item = routePath.match(ITEM_RE);
  if (item && req.method === "DELETE") return await archive(ctx, item[1]);
  return null;
}

async function listMine({ supabase, telegramId, origin }: Ctx): Promise<Response> {
  const { data, error } = await supabase
    .from("short_links")
    .select(COLUMNS)
    .eq("owner_id", telegramId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) return serverError(origin, "short links list", error);
  return json(data ?? [], 200, origin);
}

async function create(ctx: Ctx, req: Request): Promise<Response> {
  const { supabase, telegramId, groupId, isDemo, origin } = ctx;
  // Демо-вход открыт всем без регистрации: создание там превратило бы наш домен в анонимную
  // переадресацию куда угодно.
  if (isDemo) return json({ error: "demo_readonly" }, 403, origin);

  const body = await req.json().catch(() => ({})) as { url?: unknown };
  const target = normalizeTargetUrl(typeof body.url === "string" ? body.url : "", SHORT_LINK_HOSTS);
  if (!target.ok) return json({ error: target.error }, 400, origin);

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: countErr } = await supabase
    .from("short_links")
    .select("code", { count: "exact", head: true })
    .eq("owner_id", telegramId)
    .gte("created_at", since);
  if (countErr) return serverError(origin, "short links quota", countErr);
  if ((count ?? 0) >= DAILY_CREATE_LIMIT) return json({ error: "rate_limited" }, 429, origin);

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from("short_links")
      .insert({ code: generateShortCode(), url: target.url, owner_id: telegramId, group_id: groupId })
      .select(COLUMNS)
      .single();
    if (!error) return json(data, 201, origin);
    // 23505 — код уже занят (одна на десятки миллиардов при 6 символах): пробуем другой.
    if (error.code !== "23505") return serverError(origin, "short link create", error);
  }
  return serverError(origin, "short link create", new Error("no free code"));
}

async function archive({ supabase, telegramId, origin }: Ctx, code: string): Promise<Response> {
  if (!SHORT_CODE_RE.test(code)) return json({ error: "not_found" }, 404, origin);
  const { data, error } = await supabase
    .from("short_links")
    .update({ archived_at: new Date().toISOString() })
    .eq("code", code)
    .eq("owner_id", telegramId)
    .is("archived_at", null)
    .select("code");
  if (error) return serverError(origin, "short link archive", error);
  // Чужая и несуществующая ссылка неотличимы: не подсказываем, какие коды заняты.
  if (!data?.length) return json({ error: "not_found" }, 404, origin);
  return json({ ok: true }, 200, origin);
}
