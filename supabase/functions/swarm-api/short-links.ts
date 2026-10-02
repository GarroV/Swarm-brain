import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { generateShortCode, normalizeLinkMeta, normalizeTargetUrl, SHORT_CODE_RE } from "./short-links-core.ts";

// Сокращатель ссылок («Полезности»).
//   • GET  /public/s/:code     — БЕЗ авторизации: адрес для переадресации + счётчик клика.
//                                Зовёт только Pages Function веба `functions/s/[code].ts`.
//   • GET    /short-links             — все живые ссылки СВОЕГО пространства (group_id), с автором.
//   • POST   /short-links {url,title,note?} — создать; название обязательно.
//   • PATCH  /short-links/:code {title?,note?} — поправить название/комментарий (автор или админ).
//                                       Адрес назначения не меняется: под ним уже разосланы СМС.
//   • DELETE /short-links/:code       — убрать в архив (автор или админ; физически не удаляем).
// Доступ — только в коде (service_role, RLS не защищает): ссылки чужого пространства не видны
// и не трогаются. Видимость на всё пространство — решение владельца 03.10.2026 (issue #770).

// Хосты, на которых живёт `/s/…`: ссылка на них же — петля. Боевые адреса веба — miniapp/src/lib/prodHosts.ts.
export const SHORT_LINK_HOSTS = ["swarm-team.app", "swarm-brain.pages.dev"] as const;

const LIST_LIMIT = 300;
const DAILY_CREATE_LIMIT = 200;
const CODE_ATTEMPTS = 5;
const PUBLIC_RE = /^\/public\/s\/([^/]+)$/;
const ITEM_RE = /^\/short-links\/([^/]+)$/;
const COLUMNS = "code,url,title,note,owner_id,clicks,last_clicked_at,created_at";

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

type Ctx = {
  supabase: SupabaseClient;
  telegramId: number;
  groupId: string | null;
  isDemo: boolean;
  isAdmin: boolean;
  origin: string;
  resolveNames: (ids: number[]) => Promise<Map<number, string>>;
};

type LinkRow = {
  code: string;
  url: string;
  title: string | null;
  note: string | null;
  owner_id: number;
  clicks: number;
  last_clicked_at: string | null;
  created_at: string;
};

/** Строка для клиента: имя автора и право править — считаются здесь, клиент им не доверяет вслепую. */
async function present(ctx: Ctx, rows: LinkRow[]) {
  const names = await ctx.resolveNames([...new Set(rows.map((r) => r.owner_id))]);
  return rows.map((r) => ({
    ...r,
    owner_name: names.get(r.owner_id) ?? String(r.owner_id),
    can_manage: r.owner_id === ctx.telegramId || ctx.isAdmin,
  }));
}

/** Роуты /short-links*. null — путь не про сокращатель, index.ts идёт дальше. */
export async function handleShortLinkRoutes(ctx: Ctx, req: Request, routePath: string): Promise<Response | null> {
  if (routePath === "/short-links" && req.method === "GET") return await listWorkspace(ctx);
  if (routePath === "/short-links" && req.method === "POST") return await create(ctx, req);
  const item = routePath.match(ITEM_RE);
  if (item && req.method === "PATCH") return await edit(ctx, req, item[1]);
  if (item && req.method === "DELETE") return await archive(ctx, item[1]);
  return null;
}

async function listWorkspace(ctx: Ctx): Promise<Response> {
  const { supabase, groupId, origin } = ctx;
  if (!groupId) return json([], 200, origin);
  const { data, error } = await supabase
    .from("short_links")
    .select(COLUMNS)
    .eq("group_id", groupId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) return serverError(origin, "short links list", error);
  return json(await present(ctx, (data ?? []) as LinkRow[]), 200, origin);
}

async function create(ctx: Ctx, req: Request): Promise<Response> {
  const { supabase, telegramId, groupId, isDemo, origin } = ctx;
  // Демо-вход открыт всем без регистрации: создание там превратило бы наш домен в анонимную
  // переадресацию куда угодно.
  if (isDemo) return json({ error: "demo_readonly" }, 403, origin);

  const body = await req.json().catch(() => ({})) as { url?: unknown; title?: unknown; note?: unknown };
  const target = normalizeTargetUrl(typeof body.url === "string" ? body.url : "", SHORT_LINK_HOSTS);
  if (!target.ok) return json({ error: target.error }, 400, origin);
  const meta = normalizeLinkMeta(body.title, body.note);
  if (!meta.ok) return json({ error: meta.error }, 400, origin);

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
      .insert({
        code: generateShortCode(),
        url: target.url,
        title: meta.title,
        note: meta.note,
        owner_id: telegramId,
        group_id: groupId,
      })
      .select(COLUMNS)
      .single();
    if (!error) return json((await present(ctx, [data as LinkRow]))[0], 201, origin);
    // 23505 — код уже занят (одна на десятки миллиардов при 6 символах): пробуем другой.
    if (error.code !== "23505") return serverError(origin, "short link create", error);
  }
  return serverError(origin, "short link create", new Error("no free code"));
}

/** Изменение живой ссылки своего пространства: автор — свою, админ — любую. Чужая для
 *  не-админа и несуществующая неотличимы (404): не подсказываем, какие коды заняты. */
function updateManageable(ctx: Ctx, code: string, patch: Record<string, unknown>, columns: string) {
  let q = ctx.supabase
    .from("short_links")
    .update(patch)
    .eq("code", code)
    .eq("group_id", ctx.groupId ?? "")
    .is("archived_at", null);
  if (!ctx.isAdmin) q = q.eq("owner_id", ctx.telegramId);
  return q.select(columns);
}

async function edit(ctx: Ctx, req: Request, code: string): Promise<Response> {
  const { origin } = ctx;
  if (ctx.isDemo) return json({ error: "demo_readonly" }, 403, origin);
  if (!SHORT_CODE_RE.test(code) || !ctx.groupId) return json({ error: "not_found" }, 404, origin);
  const body = await req.json().catch(() => ({})) as { title?: unknown; note?: unknown };
  const meta = normalizeLinkMeta(body.title, body.note);
  if (!meta.ok) return json({ error: meta.error }, 400, origin);
  const { data, error } = await updateManageable(ctx, code, { title: meta.title, note: meta.note }, COLUMNS);
  if (error) return serverError(origin, "short link edit", error);
  if (!data?.length) return json({ error: "not_found" }, 404, origin);
  return json((await present(ctx, data as unknown as LinkRow[]))[0], 200, origin);
}

async function archive(ctx: Ctx, code: string): Promise<Response> {
  const { origin } = ctx;
  if (ctx.isDemo) return json({ error: "demo_readonly" }, 403, origin);
  if (!SHORT_CODE_RE.test(code) || !ctx.groupId) return json({ error: "not_found" }, 404, origin);
  const { data, error } = await updateManageable(ctx, code, { archived_at: new Date().toISOString() }, "code");
  if (error) return serverError(origin, "short link archive", error);
  if (!data?.length) return json({ error: "not_found" }, 404, origin);
  return json({ ok: true }, 200, origin);
}
