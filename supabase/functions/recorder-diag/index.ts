// Приём постоянного журнала рекордера (issue #468). Рекордер шлёт:
//   • kind="log" — очередную порцию строк журнала (раз в 5 мин);
//   • kind="session_*" — на старте: как закончилась прошлая сессия (abnormal = умер молча),
//     хвост журнала и начало отчёта о падении macOS, если он был.
// Зачем: рекордер у коллег «молча пропадает», а heartbeat хранит только последний снимок.
// Просить файлы у людей — не вариант (решение владельца 24.09.2026), поэтому журнал едет сам.
// Хранится 3 дня: на каждой вставке чистим старое этого пользователя. Наружу данные НЕ отдаёт.
//
// Auth: verifyAgentToken (рекордер-токен), как у meeting-heartbeat.
// Деплой: supabase functions deploy recorder-diag --no-verify-jwt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAgentToken, AgentAuthError } from "../_shared/agent-auth.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const KINDS = new Set(["log", "session_abnormal", "session_clean", "session_first_run"]);
const MAX_LINES = 1500;
const MAX_LINE_CHARS = 1000;
const MAX_CRASH_CHARS = 8000;
const KEEP_DAYS = 3;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let identity;
  try {
    identity = await verifyAgentToken(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return json({ error: e.message }, 401);
    throw e;
  }

  let body: { kind?: unknown; build?: unknown; lines?: unknown; crash?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
  if (!kind) return json({ error: "bad kind" }, 400);
  if (!Array.isArray(body.lines)) return json({ error: "lines must be an array" }, 400);
  const lines = body.lines
    .filter((l): l is string => typeof l === "string")
    .slice(-MAX_LINES)
    .map((l) => l.slice(0, MAX_LINE_CHARS));
  const build = typeof body.build === "number" && Number.isInteger(body.build) ? body.build : null;
  const crash = typeof body.crash === "string" ? body.crash.slice(0, MAX_CRASH_CHARS) : null;

  const { error } = await supabase.from("recorder_diagnostics").insert({
    telegram_id: identity.telegramId, build, kind, lines: lines.join("\n"), crash,
  });
  if (error) {
    console.error("recorder-diag insert failed", { telegramId: identity.telegramId, error: error.message });
    return json({ error: "insert failed" }, 500);
  }

  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  const { error: pruneError } = await supabase.from("recorder_diagnostics")
    .delete().eq("telegram_id", identity.telegramId).lt("created_at", cutoff);
  if (pruneError) console.error("recorder-diag prune failed", { error: pruneError.message });

  return json({ ok: true });
});
