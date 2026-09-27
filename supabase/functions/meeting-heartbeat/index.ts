// ВСЕХ функциях); перевод на голые спецификаторы из import-map из ветки непроверяем. См. _shared/agent-auth.ts.
// Heartbeat рекордера. Рекордер раз в ~15 мин (maintenanceTick) шлёт «я жив» + статус записи +
// версию. Пишет allowed_users.recorder_last_{seen,recording,version}. Watchdog checkRecorderHealth
// (swarm-bot) читает эти поля для двух сигналов: «оборванная запись» и «токен истекает».
// Данные наружу НЕ отдаёт — только 200/ok.
//
// С 04.09.2026 heartbeat несёт ещё два факта — для `ON AIR` в панели «Встречи сегодня»
// (docs/decisions/2026-09-04-on-air-v-panele-vstrech.md):
//   • on_call     — идёт реальный созвон (вход микрофона держит другое приложение). В звонке
//                   можно сидеть без записи, поэтому это ОТДЕЛЬНЫЙ факт от recording;
//   • meeting_key — какую встречу рекордер при этом видит («<uid>:<дата>» из meeting-current).
// Пока звонок идёт, рекордер шлёт keep-alive чаще (2 мин) — панель считает присутствие живым
// пять минут, дальше гасит.
//
// Auth: resolveActingIdentity принимает recorder_token_hash ИЛИ claude_mcp_token_hash человека
// (см. _shared/agent-auth), а также токен служебного агента с заголовком X-On-Behalf-Of.
// Heartbeat агента при этом НЕ ложится в строку человека: иначе watchdog решил бы, что у человека
// работает рекордер, и погасил бы настоящий сигнал. С D018 удар агента несёт meeting_id и пишется
// в строку встречи (meetings.agent_last_*) — только встречи его воркспейса, где claim_owner —
// человек из X-On-Behalf-Of; чужая встреча → 403. Плюс строка агента (service_agents.last_seen_at,
// last_version) — «бот вообще жив, такая-то сборка». Куда и с какими условиями — write.ts.
// Деплой: supabase functions deploy meeting-heartbeat --no-verify-jwt (рекордер хитит с Bearer-токеном).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AgentAuthError,
  resolveActingIdentity,
} from "../_shared/agent-auth.ts";
import {
  buildHeartbeatWrites,
  type HeartbeatBody,
  HeartbeatRejected,
  type HeartbeatWrite,
  NOT_CLAIM_OWNER,
} from "./write.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  let identity;
  try {
    identity = await resolveActingIdentity(supabase, req);
  } catch (e) {
    if (e instanceof AgentAuthError) {
      return json({ error: e.message }, e.status);
    }
    throw e;
  }

  let body: HeartbeatBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let writes: HeartbeatWrite[];
  try {
    writes = buildHeartbeatWrites(identity, body, new Date().toISOString());
  } catch (e) {
    if (e instanceof HeartbeatRejected) {
      return json({ error: e.message }, e.status);
    }
    throw e;
  }
  for (const write of writes) {
    const outcome = await apply(write);
    if (outcome === "failed") return json({ error: "update failed" }, 500);
    // Не отличаем «встречи нет» от «встреча чужая»: ответ не должен подтверждать чужие id.
    // code — для бота: по своей встрече такой отказ значит «право ушло другой записи» (D019).
    if (outcome === "missed") {
      return json(
        { error: "meeting is not yours", code: NOT_CLAIM_OWNER },
        403,
      );
    }
    // Опоздавший удар: встречу уже освежил более поздний. Ничего не пишем дальше — строку агента
    // тот, более поздний, тоже освежил.
    if (outcome === "stale") return json({ ok: true, stale: true });
  }
  return json({ ok: true });
});

type Outcome = "ok" | "missed" | "stale" | "failed";

async function apply(write: HeartbeatWrite): Promise<Outcome> {
  let query = supabase.from(write.table).update(write.patch);
  for (const [column, value] of Object.entries(write.match)) {
    query = query.eq(column, value);
  }
  if (write.newerThan) {
    const { column, value } = write.newerThan;
    query = query.or(`${column}.is.null,${column}.lt.${value}`);
  }
  // Отдать назад только ключ: строка встречи несёт транскрипт, тащить его ради счёта незачем.
  const key = Object.keys(write.match)[0];
  const { data, error } = await query.select(key);
  if (error) {
    console.error(`meeting-heartbeat: update ${write.table}: ${error.message}`);
    return "failed";
  }
  if (!write.requireHit || (data ?? []).length > 0) return "ok";
  if (!write.newerThan) return "missed";
  // Промах при условии свежести: встреча либо не того, кто пришёл, либо удар опоздал. Различаем
  // тем же набором условий владения, но уже без свежести.
  let owned = supabase.from(write.table).select(key);
  for (const [column, value] of Object.entries(write.match)) {
    owned = owned.eq(column, value);
  }
  const { data: rows, error: ownedError } = await owned;
  if (ownedError) {
    console.error(
      `meeting-heartbeat: select ${write.table}: ${ownedError.message}`,
    );
    return "failed";
  }
  return (rows ?? []).length > 0 ? "stale" : "missed";
}
