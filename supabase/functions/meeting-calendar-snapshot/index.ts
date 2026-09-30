// meeting-calendar-snapshot — снимок Google-календарей людей с автозапуском (T164, решение D023).
//
// Зачем: рекордер спрашивает meeting-missed «бот не пришёл?» часто, и раньше каждый вопрос шёл в
// Google. Теперь календарь снимается здесь, по расписанию, а meeting-missed читает только базу.
// Проход — run.ts, что попадает в снимок и когда снимать — _shared/calendar-snapshot.ts.
//
// Вызов — pg_cron раз в час (`net.http_post` с `X-Cron-Secret`, как у meeting-process); снимает
// только в часы SNAPSHOT_HOURS по Белграду (08, 11, 12), в остальные отвечает `due:false` и ничего
// не делает: cron живёт в UTC, а Белград переводит часы. `{"force":true}` в теле — снять вне часа
// (ручной перезапуск и смоук), под тем же секретом.
//
//   POST → 200 { ok: true, due: false } — не час снимка
//          200 { ok: true, due: true, report: { people, ok, calendar_not_connected, calendar_token_dead,
//                calendar_unavailable, failed, events } } — счётчики людей по итогу, events — встреч в снимке
//   403 нет/не тот X-Cron-Secret (и CRON_SECRET не задан) · 405 не POST · 500 сбой чтения людей.
//
// Пишет: meeting_calendar_snapshot_runs, meeting_calendar_snapshot_events, meeting_calendar_misses
// (причины уровня человека: календаря нет / доступ умер).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_SECRET.
// Деплой: supabase functions deploy meeting-calendar-snapshot --no-verify-jwt (cron хитит с секретом).
//
// URL-импорты — канон этого репозитория: функции деплоятся без карты импортов.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { accessToken, listEvents } from "../_shared/google-calendar.ts";
import { makeMissStore } from "../_shared/calendar-miss-store.ts";
import { snapshotDue } from "../_shared/calendar-snapshot.ts";
import { snapshotAll, type SnapshotDeps } from "./run.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const missStore = makeMissStore(supabase);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function must<T>(what: string, res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Сравнение секрета без раннего выхода: время ответа не подсказывает, сколько символов совпало. */
function sameSecret(given: string | null): boolean {
  if (CRON_SECRET === "" || given === null) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(CRON_SECRET);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

async function wantsForce(req: Request): Promise<boolean> {
  try {
    return ((await req.json()) as { force?: unknown }).force === true;
  } catch {
    return false; // пустое или не-JSON тело — обычный вызов cron
  }
}

const deps: SnapshotDeps = {
  async people() {
    const data = must(
      "allowed_users",
      await supabase.from("allowed_users").select("telegram_id, group_id")
        .eq("scriba_autojoin", true).not("group_id", "is", null).order("telegram_id"),
    ) ?? [];
    return (data as { telegram_id: number; group_id: string }[]).map((r) => ({
      telegramId: r.telegram_id,
      groupId: r.group_id,
    }));
  },
  async refreshToken(telegramId) {
    const data = must(
      "user_integrations",
      await supabase.from("user_integrations").select("api_key")
        .eq("telegram_id", telegramId).eq("service", "google_calendar").maybeSingle(),
    ) as { api_key?: string } | null;
    return data?.api_key ?? null;
  },
  accessToken,
  listEvents,
  async saveEvents(person, snapshotAt, rows) {
    if (rows.length === 0) return;
    must(
      "meeting_calendar_snapshot_events",
      await supabase.from("meeting_calendar_snapshot_events").upsert(
        rows.map((r) => ({ ...r, group_id: person.groupId, invited_by: person.telegramId, snapshot_at: snapshotAt })),
        { onConflict: "invited_by,calendar_key" },
      ),
    );
  },
  async saveRun(person, run) {
    // Колонки, которых нет в строке (snapshot_at у неудачной попытки), upsert не трогает.
    must(
      "meeting_calendar_snapshot_runs",
      await supabase.from("meeting_calendar_snapshot_runs").upsert(
        { invited_by: person.telegramId, group_id: person.groupId, ...run },
        { onConflict: "invited_by" },
      ),
    );
  },
  recordMisses: (groupId, misses) => missStore.recordMisses(groupId, misses),
  log: (line) => console.warn(line),
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (!sameSecret(req.headers.get("X-Cron-Secret"))) return json({ ok: false, error: "forbidden" }, 403);

  const nowMs = Date.now();
  if (!snapshotDue(nowMs) && !(await wantsForce(req))) return json({ ok: true, due: false });
  try {
    const report = await snapshotAll(deps, nowMs);
    console.log(`meeting-calendar-snapshot: ${JSON.stringify(report)}`);
    if (report.failed > 0) console.error(`meeting-calendar-snapshot: снимок не у всех (${report.failed})`);
    return json({ ok: true, due: true, report });
  } catch (e) {
    console.error(`meeting-calendar-snapshot: ${e instanceof Error ? e.message : String(e)}`);
    return json({ ok: false, error: "calendar snapshot failed" }, 500);
  }
});
