import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runMeetingStep, LEASE_STALE_MS } from "../_shared/meeting-processor.ts";

// meeting-process — cron-воркер durable-обработки встреч. Триггерится pg_cron каждую минуту
// (net.http_post с X-Cron-Secret, см. cron.job 'meetings-process'). Берёт незаконченные встречи
// в summary_status='processing' и продвигает каждую на шаг (транскрибация следующих частей или
// финальная сводка тезисов) в рамках бюджета. Переживает wall-clock: что не успели — добьём в
// следующий тик. Логику шага держит _shared/meeting-processor.ts (общая с meeting-ingest).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// Бюджет на весь тик — под лимитом воркера Supabase (~400s) с запасом.
const TICK_BUDGET_MS = 300_000;
// Бюджет на одну встречу за тик — чтобы одна длинная не съела весь тик и не заморозила остальные.
const PER_MEETING_BUDGET_MS = 120_000;
// Сколько встреч максимум трогаем за тик (свежий лиз остальных всё равно отсечёт параллельные тики).
const MAX_MEETINGS_PER_TICK = 6;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });
  if (!CRON_SECRET || req.headers.get("X-Cron-Secret") !== CRON_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const startedAt = Date.now();
  const staleIso = new Date(Date.now() - LEASE_STALE_MS).toISOString();

  // Кандидаты: в обработке, с манифестом, и НЕ под свежим лизом (никто другой их сейчас не двигает).
  // Сначала те, кто дольше всех без прогресса (nullsFirst — кто ещё ни разу не продвигался).
  const { data, error } = await supabase
    .from("meetings")
    .select("id")
    .eq("summary_status", "processing")
    .not("process_state", "is", null)
    .or(`processing_lease.is.null,processing_lease.lt.${staleIso}`)
    .order("last_progress_at", { ascending: true, nullsFirst: true })
    .limit(MAX_MEETINGS_PER_TICK);

  if (error) {
    console.error("meeting-process: select failed:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  let processed = 0;
  let finished = 0;
  for (const id of ids) {
    const remaining = TICK_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 5_000) break; // бюджет тика исчерпан — остальное в следующий тик
    try {
      const r = await runMeetingStep(supabase, id, Math.min(PER_MEETING_BUDGET_MS, remaining));
      if (r.claimed) processed++;
      if (r.done) finished++;
    } catch (e) {
      console.error(`meeting-process: step failed for ${id}:`, e);
    }
  }

  return new Response(JSON.stringify({ ok: true, candidates: ids.length, processed, finished }), { status: 200 });
});
