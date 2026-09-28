// meeting-missed — рекордер человека узнаёт, что бот на его встречу не пошёл или не дошёл, и зовёт
// его руками (T102, решения D015/D021/D022). Логика — handle.ts, что считается пропуском —
// _shared/calendar-missed.ts, хранилище — _shared/calendar-miss-store.ts. Показывает рекордер (T162).
// В Google не ходит (T164, D023): календарь снимает по расписанию meeting-calendar-snapshot, здесь
// читаются снимок (meeting_calendar_snapshot_runs / _events) и задания.
//
// Дверь — токен рекордера самого человека (verifyAgentToken, kind recorder / recorder_prev);
// X-On-Behalf-Of не принимается, токен служебного агента и MCP-токен — 403. Автозапуск выключен
// (allowed_users.scriba_autojoin=false, D021) — пропусков нет по определению.
//
//   GET  → 200 { autojoin, checked, snapshot_at, misses: [{ id, reason, title, starts_at, ends_at,
//              join_url, platform, detected_at, can_invite, message: { en, ru } }] }
//          checked=false — сегодня календарь человека не снят (Google не ответил на всех снимках дня, снимка
//          ещё не было) или сверка упала; показано записанное. snapshot_at — время последнего снимка.
//   POST { miss_id } → 201/200 { invite } — как POST /meeting-invites (swarm-api/meeting-invites.ts);
//          404 not_found · 409 cannot_invite / meeting_over / autojoin_off · 400/429 — правила приглашений.
//   401 не токен · 403 не токен рекордера · 405 не GET/POST · 500 сбой базы.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Деплой: supabase functions deploy meeting-missed --no-verify-jwt (рекордер хитит с Bearer-токеном).
//
// URL-импорты — канон этого репозитория: функции деплоятся без карты импортов.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, verifyAgentToken } from "../_shared/agent-auth.ts";
import { makeMissStore, MISS_COLUMNS, type MissRow } from "../_shared/calendar-miss-store.ts";
import { isDemoSession } from "../_shared/demo-session.ts";
import { loadCoveredRooms } from "../_shared/manual-rooms.ts";
import type { SnapshotEvent, SnapshotRun } from "../_shared/calendar-snapshot.ts";
import { handleMeetingInviteRoutes, type InviteContext } from "../swarm-api/meeting-invites.ts";
import { handleMissed, type MissedDeps, type Person } from "./handle.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/** Токены, с которыми приходит рекордер. MCP-токен — это Claude Desktop, не рекордер. */
const RECORDER_KINDS = new Set(["recorder", "recorder_prev"]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function must<T>(what: string, res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

function inviteCtx(person: Person): InviteContext {
  // Демо автозапуска не имеет (его люди без scriba_autojoin); отказ демо — правило веба, решается
  // по личности (_shared/demo-session.ts), а не по слагу группы.
  return {
    supabase,
    telegramId: person.telegramId,
    groupId: person.groupId,
    isDemo: isDemoSession(person.telegramId),
    origin: "",
  };
}

async function viaInviteRoutes(person: Person, req: Request, path: string): Promise<Response> {
  const res = await handleMeetingInviteRoutes(inviteCtx(person), req, path);
  return res ?? json({ error: "invite route not found" }, 500);
}

const deps: MissedDeps = {
  async identify(req) {
    try {
      const who = await verifyAgentToken(supabase, req);
      if (!RECORDER_KINDS.has(who.kind)) return json({ error: "recorder token required" }, 403);
      if (!who.groupId) return json({ error: "no workspace" }, 403);
      return { telegramId: who.telegramId, groupId: who.groupId };
    } catch (e) {
      if (e instanceof AgentAuthError) return json({ error: e.message }, e.status);
      throw e;
    }
  },
  async autojoin(telegramId) {
    const data = must(
      "allowed_users",
      await supabase.from("allowed_users").select("scriba_autojoin").eq("telegram_id", telegramId).maybeSingle(),
    ) as { scriba_autojoin?: boolean } | null;
    return data?.scriba_autojoin === true;
  },
  async snapshotRun(person) {
    const data = must(
      "meeting_calendar_snapshot_runs",
      await supabase.from("meeting_calendar_snapshot_runs").select("snapshot_at, attempted_at, outcome")
        .eq("invited_by", person.telegramId).eq("group_id", person.groupId).maybeSingle(),
    );
    return data as SnapshotRun | null;
  },
  async snapshotEvents(person, snapshotAt, nowIso) {
    const data = must(
      "meeting_calendar_snapshot_events",
      await supabase.from("meeting_calendar_snapshot_events")
        .select("calendar_key, outcome, title, join_url, platform, starts_at, ends_at")
        .eq("invited_by", person.telegramId).eq("group_id", person.groupId).eq("snapshot_at", snapshotAt)
        .lte("starts_at", nowIso).gt("ends_at", nowIso).limit(50),
    ) ?? [];
    return data as SnapshotEvent[];
  },
  manualRooms: (groupId, nowMs) => loadCoveredRooms(supabase, groupId, nowMs),
  store: makeMissStore(supabase),
  async openMisses(person, sinceIso) {
    const data = must(
      "meeting_calendar_misses",
      await supabase.from("meeting_calendar_misses").select(MISS_COLUMNS)
        .eq("invited_by", person.telegramId).eq("group_id", person.groupId).is("invite_id", null)
        .gte("detected_at", sinceIso).order("detected_at", { ascending: false }).limit(50),
    ) ?? [];
    return data as unknown as MissRow[];
  },
  async missById(person, id) {
    const data = must(
      "meeting_calendar_misses by id",
      await supabase.from("meeting_calendar_misses").select(MISS_COLUMNS)
        .eq("id", id).eq("invited_by", person.telegramId).eq("group_id", person.groupId).maybeSingle(),
    );
    return data as unknown as MissRow | null;
  },
  async attachInvite(missId, inviteId) {
    must(
      "meeting_calendar_misses invite",
      await supabase.from("meeting_calendar_misses").update({ invite_id: inviteId }).eq("id", missId).is(
        "invite_id",
        null,
      ),
    );
  },
  createInvite: (person, joinUrl) =>
    viaInviteRoutes(
      person,
      new Request("http://local/meeting-invites", { method: "POST", body: JSON.stringify({ join_url: joinUrl }) }),
      "/meeting-invites",
    ),
  readInvite: (person, inviteId) =>
    viaInviteRoutes(person, new Request(`http://local/meeting-invites/${inviteId}`), `/meeting-invites/${inviteId}`),
  log: (line) => console.warn(line),
  now: () => Date.now(),
};

Deno.serve((req: Request) => handleMissed(req, deps));
