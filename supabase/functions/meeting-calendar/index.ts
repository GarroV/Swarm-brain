// meeting-calendar — бот приходит на встречу сам, по календарю человека (T100, решения D015/D016).
//
// Оркестратор под токеном служебного агента зовёт этот эндпоинт раз в минуту. Сервер читает
// Google-календари людей СВОЕГО воркспейса, включивших автозапуск (allowed_users.scriba_autojoin),
// берёт встречи Google Meet и Контур.Толка (площадки бота, T111), начинающиеся в ближайшие минуты,
// заводит задание (одно на встречу воркспейса, таблица meeting_calendar_jobs) и отдаёт оркестратору
// ещё не забранные — каждое ровно один раз.
// Выключивший автозапуск (переключатель в вебе, D021) теряет и заведённые, но не забранные задания —
// sweep.ts гасит их на ближайшем опросе, до забора.
//
// К каждому заданию сервер выдаёт пропуск бота на эту встречу (`grant_token`, T165,
// _shared/agent-grant.ts): за `invited_by` бот ходит только с ним. Бот заявляет встречу в
// meeting-claim как `calendar` с `calendar_key` своего пропуска — и сервер сам сверяет, что встреча в
// календаре этого человека, что он ответил «да» (D016, D024) и что автозапуск всё ещё включён (D021,
// meeting-claim/agent-scope.ts). Задание пропуском в ручную встречу не является. Пропуск не выдался —
// задания возвращаются в очередь.
//
// Всё, на что бот не пойдёт, возвращается в `skipped` с причиной — громко (D015):
//   calendar_not_connected · calendar_token_dead · calendar_unavailable — у человека (ключа нет);
//   no_conference_link · unsupported_platform · unrecognized_link · declined · not_accepted ·
//   manual_invite_exists —
//   у встречи. Список — _shared/calendar-dispatch.ts (SkipReason).
//
// Дверь — resolveServiceAgent: только токен агента, без подмены личности; люди сюда не проходят.
//
// POST, тело не читается.
// 200 { ok: true, jobs: [{ id, calendar_key, invited_by, join_url, platform, title, starts_at, ends_at,
//                         grant_token }],
//       skipped: [{ invited_by, calendar_key, title, reason, platform? }] }
// 401 не агент · 403 X-On-Behalf-Of или агент без воркспейса · 405 не POST · 500 сбой базы.
//
// Пропуски (бот не пойдёт / забрал задание и не дошёл) записываются в meeting_calendar_misses —
// какие причины, решает _shared/calendar-missed.ts, запись — missed.ts; показывает их рекордер
// человека через meeting-missed (T102, D022).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
// Деплой: supabase functions deploy meeting-calendar --no-verify-jwt (бот хитит с Bearer-токеном).
//
// URL-импорты — канон этого репозитория: функции деплоятся без карты импортов.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, resolveServiceAgent } from "../_shared/agent-auth.ts";
import { accessToken, listEvents } from "../_shared/google-calendar.ts";
import { sweep, type SweepSource, type TakenJob } from "./sweep.ts";
import { recordSweepMisses } from "./missed.ts";
import { makeMissStore } from "../_shared/calendar-miss-store.ts";
import { mintGrants } from "../_shared/agent-grant.ts";
import { loadCoveredRooms } from "../_shared/manual-rooms.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Пропуски автозапуска (T102) пишутся в meeting_calendar_misses — их показывает рекордер человека.
const missStore = makeMissStore(supabase);

const JOB_COLUMNS = "id, calendar_key, invited_by, join_url, platform, title, starts_at, ends_at";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

const source: SweepSource = {
  async autojoinPeople(groupId) {
    const { data, error } = await supabase.from("allowed_users")
      .select("telegram_id").eq("group_id", groupId).eq("scriba_autojoin", true).order("telegram_id");
    fail("allowed_users", error);
    return (data ?? []).map((r) => (r as { telegram_id: number }).telegram_id);
  },
  manualRooms: (groupId, nowMs) => loadCoveredRooms(supabase, groupId, nowMs),
  async refreshToken(telegramId) {
    const { data, error } = await supabase.from("user_integrations")
      .select("api_key").eq("telegram_id", telegramId).eq("service", "google_calendar").maybeSingle();
    fail("user_integrations", error);
    return (data as { api_key?: string } | null)?.api_key ?? null;
  },
  accessToken,
  listEvents,
  async insertJobs(groupId, jobs) {
    const { error } = await supabase.from("meeting_calendar_jobs")
      .upsert(jobs.map((j) => ({ ...j, group_id: groupId })), {
        onConflict: "group_id,calendar_key",
        ignoreDuplicates: true,
      });
    fail("meeting_calendar_jobs insert", error);
  },
  async dropPendingJobsExcept(groupId, people) {
    // Незабранное задание — служебная строка очереди, не запись человека: удаляем. Забранные
    // (бот уже поднимается) не трогаются — условие taken_at is null.
    let q = supabase.from("meeting_calendar_jobs").delete().eq("group_id", groupId).is("taken_at", null);
    if (people.length > 0) q = q.not("invited_by", "in", `(${people.join(",")})`);
    const { error } = await q;
    fail("meeting_calendar_jobs drop", error);
  },
  async takeJobs(groupId, agentId, nowIso, people) {
    if (people.length === 0) return [];
    // Забор — один условный UPDATE (taken_at is null): два одновременных опроса одну строку не делят.
    // Только задания тех, чьё согласие перечитано перед забором (D021).
    const { data, error } = await supabase.from("meeting_calendar_jobs")
      .update({ taken_at: nowIso, taken_by: agentId })
      .eq("group_id", groupId).is("taken_at", null).gt("ends_at", nowIso).in("invited_by", [...people])
      .select(JOB_COLUMNS);
    fail("meeting_calendar_jobs take", error);
    return ((data ?? []) as TakenJob[]).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  },
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  let agent: { agentId: string; groupId: string };
  try {
    agent = await resolveServiceAgent(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) return json({ ok: false, error: e.message }, e.status);
    throw e;
  }

  try {
    const result = await sweep(source, agent, Date.now());
    for (const s of result.skipped) {
      console.warn(
        `meeting-calendar: ${agent.groupId} ${s.invited_by} ${s.calendar_key ?? "—"} — бот не пойдёт: ${s.reason}`,
      );
    }
    let tokens: string[];
    try {
      tokens = await mintGrants(
        supabase,
        result.jobs.map((j) => ({
          agentId: agent.agentId,
          groupId: agent.groupId,
          telegramId: j.invited_by,
          joinUrl: j.join_url,
          calendarJobId: j.id,
          calendarKey: j.calendar_key,
          title: j.title,
        })),
        Date.now(),
      );
    } catch (e) {
      // Задание без пропуска боту бесполезно: вернуть в очередь, следующий опрос заберёт снова.
      console.error(`meeting-calendar: пропуска не выданы: ${e instanceof Error ? e.message : String(e)}`);
      const { error: backErr } = await supabase.from("meeting_calendar_jobs")
        .update({ taken_at: null, taken_by: null })
        .in("id", result.jobs.map((j) => j.id))
        .eq("taken_by", agent.agentId);
      if (backErr) console.error(`meeting-calendar: задания не вернулись в очередь: ${backErr.message}`);
      return json({ ok: false, error: "grant issue failed" }, 500);
    }
    const jobs = result.jobs.map((j, n) => ({ ...j, grant_token: tokens[n] }));
    console.log(`meeting-calendar: агент ${agent.agentId} (${agent.groupId}) забрал ${result.jobs.length}`);
    // Записать пропуски и недошедших ботов. Не бросает: задания боту важнее записи, а незаписанное
    // повторится на следующем опросе.
    const missed = await recordSweepMisses(
      missStore,
      agent.groupId,
      result.skipped,
      Date.now(),
      (l) => console.warn(l),
    );
    if (missed.failed > 0) console.error(`meeting-calendar: пропуски записаны не все ${JSON.stringify(missed)}`);
    return json({ ok: true, ...result, jobs });
  } catch (e) {
    console.error(`meeting-calendar: ${e instanceof Error ? e.message : String(e)}`);
    return json({ ok: false, error: "calendar sweep failed" }, 500);
  }
});
