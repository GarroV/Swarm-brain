// Приём данных сборщиков «Анализа рынка» из GitHub Actions (workflow market-collect).
// Только POST и только с токеном MARKET_INGEST_TOKEN: ключ service role в Actions не кладём,
// у токена нет прав ни на что, кроме таблиц mkt_* через эту функцию. Решения админа (импорт
// снимка, «принять все») токен сборщика не принимает — только личный MCP-токен админа (/mytoken):
// утечка токена сборщика из CI не даёт решать за админа, а решение записано на человека.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyIngest } from "./apply.ts";
import { validateSnapshot } from "../_shared/market/snapshot.ts";
import { acceptAllNewLocations, importSnapshot } from "../_shared/market/db.ts";
import { sha256Hex } from "../_shared/agent-auth.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const TOKEN = Deno.env.get("MARKET_INGEST_TOKEN") ?? "";
const SUPER_ADMIN_ID = 744230399; // единый суперадмин, см. swarm-bot/lib/supabase.ts
const ADMIN_SOURCES = new Set(["snapshot", "accept_new"]);

/** Сравнение без утечки по времени; пустой ожидаемый токен не пускает никого. */
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given),
    b = new TextEncoder().encode(expected);
  if (!expected || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** telegram_id админа по его действующему MCP-токену; null — не токен, протух или не админ. */
export type FindAdmin = (bearer: string) => Promise<number | null>;

export async function findAdminByMcpToken(
  bearer: string,
): Promise<number | null> {
  if (!bearer.startsWith("smcp_")) return null;
  const { data, error } = await supabase.from("allowed_users")
    .select("telegram_id, is_admin, claude_mcp_token_expires_at")
    .eq("claude_mcp_token_hash", await sha256Hex(bearer)).maybeSingle();
  if (error) throw new Error(`admin lookup: ${error.message}`);
  const row = data as
    | {
      telegram_id: number;
      is_admin: boolean | null;
      claude_mcp_token_expires_at: string | null;
    }
    | null;
  if (!row) return null;
  const expires = row.claude_mcp_token_expires_at;
  if (expires && Date.parse(expires) < Date.now()) return null;
  return row.telegram_id === SUPER_ADMIN_ID || row.is_admin === true ? row.telegram_id : null;
}

export async function handleIngest(
  req: Request,
  token = TOKEN,
  findAdmin: FindAdmin = findAdminByMcpToken,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const given = (req.headers.get("authorization") ?? "").replace(
    /^Bearer /,
    "",
  );
  const isCollector = sameSecret(given, token);
  const adminId = isCollector ? null : await findAdmin(given).catch((e) => {
    console.error("market-ingest admin lookup", e);
    return null;
  });
  if (!isCollector && adminId === null) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (
    !body?.source || !/^[A-Za-z]{2}$/.test(body?.country ?? "") ||
    !body?.started_at
  ) {
    return new Response("Bad payload", { status: 400 });
  }
  // Каждый токен — только своя работа: сборщик не принимает решений, админ не льёт данные.
  if (ADMIN_SOURCES.has(body.source) ? adminId === null : !isCollector) {
    return new Response("Forbidden", { status: 403 });
  }
  const admin = adminId === null ? null : await adminAction(body, adminId);
  if (admin) return admin;
  try {
    const stats = await applyIngest(
      supabase,
      body,
      new Date().toISOString().slice(0, 10),
    );
    return Response.json({ ok: true, stats });
  } catch (e) {
    console.error("market-ingest", e);
    return Response.json({ ok: false, error: "apply failed" }, { status: 500 });
  }
}

/** Решения админа без его входа: те же кнопки «Импорт снимка» и «Принять все» из «Источников и
 *  свежести», но по личному MCP-токену админа — чтобы страну можно было довести
 *  скриптом (scripts/market/admin.ts), а не руками в вебе. Права те же: только таблицы mkt_*. */
async function adminAction(
  body: { source: string; country: string; snapshot?: unknown },
  adminId: number,
): Promise<Response | null> {
  const cc = body.country.toUpperCase();
  if (body.source === "snapshot") {
    const v = validateSnapshot(body.snapshot);
    if (!v.ok) {
      return Response.json({
        ok: false,
        error: "Invalid snapshot",
        details: v.errors,
      }, {
        status: 400,
      });
    }
    return await guarded(() => importSnapshot(supabase, cc, v.snapshot));
  }
  if (body.source === "accept_new") {
    return await guarded(async () => ({
      accepted: await acceptAllNewLocations(supabase, cc, adminId),
    }));
  }
  return null;
}

async function guarded(f: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json({ ok: true, stats: await f() });
  } catch (e) {
    console.error("market-ingest admin", e);
    return Response.json({ ok: false, error: "apply failed" }, { status: 500 });
  }
}

if (import.meta.main) Deno.serve((req) => handleIngest(req));
