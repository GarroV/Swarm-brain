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
// Удар бота по своей встрече ещё продлевает лиз права транскрибации и пишет recorded_seconds —
// так арбитраж meeting-claim видит запись бота честно (T155, write.ts). Лиз — только при
// recording:true, секунды — только вверх и не быстрее прошедшего времени с запасом (T157, write.ts).
// Деплой: supabase functions deploy meeting-heartbeat --no-verify-jwt (рекордер хитит с Bearer-токеном).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AgentAuthError, resolveActingIdentity } from "../_shared/agent-auth.ts";
import {
  buildHeartbeatWrites,
  type HeartbeatBody,
  HeartbeatRejected,
  type HeartbeatWrite,
  NOT_CLAIM_OWNER,
  type RecordedPrior,
  runHeartbeat,
  type WriteStore,
} from "./write.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Таблицы в Postgres через PostgREST. Условие свежести — `col is null or col < value` той же UPDATE.
const store: WriteStore = {
  async update(write) {
    let query = supabase.from(write.table).update(write.patch);
    for (const [column, value] of Object.entries(write.match)) {
      query = query.eq(column, value);
    }
    // Одно условие «пусто или меньше» на запись: два `or` в одном запросе PostgREST не сложит.
    const condition = write.newerThan ?? write.below;
    if (write.newerThan && write.below) throw new Error(`update ${write.table}: newerThan и below вместе`);
    if (condition) {
      const { column, value } = condition;
      query = query.or(`${column}.is.null,${column}.lt.${value}`);
    }
    // Отдать назад только ключ: строка встречи несёт транскрипт, тащить его ради счёта незачем.
    const { data, error } = await query.select(Object.keys(write.match)[0]);
    if (error) throw new Error(`update ${write.table}: ${error.message}`);
    return (data ?? []).length;
  },
  async read(write) {
    let query = supabase.from(write.table).select("recorded_seconds, agent_last_seen_at, lease_expires_at");
    for (const [column, value] of Object.entries(write.match)) {
      query = query.eq(column, value);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`select ${write.table}: ${error.message}`);
    return data as RecordedPrior | null;
  },
  async count(write) {
    let query = supabase.from(write.table).select(Object.keys(write.match)[0]);
    for (const [column, value] of Object.entries(write.match)) {
      query = query.eq(column, value);
    }
    const { data, error } = await query;
    if (error) throw new Error(`select ${write.table}: ${error.message}`);
    return (data ?? []).length;
  },
};

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

  const nowIso = new Date().toISOString();
  let writes: HeartbeatWrite[];
  try {
    writes = buildHeartbeatWrites(identity, body, nowIso);
  } catch (e) {
    if (e instanceof HeartbeatRejected) {
      return json({ error: e.message }, e.status);
    }
    throw e;
  }
  let outcome;
  try {
    outcome = await runHeartbeat(writes, store, nowIso);
  } catch (e) {
    console.error(`meeting-heartbeat: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "update failed" }, 500);
  }
  // Не отличаем «встречи нет» от «встреча чужая»: ответ не должен подтверждать чужие id.
  // code — для бота: по своей встрече такой отказ значит «право ушло другой записи» (D019).
  if (outcome === "missed") {
    return json({ error: "meeting is not yours", code: NOT_CLAIM_OWNER }, 403);
  }
  // Опоздавший удар: встречу уже освежил более поздний. Дальше ничего не пишется — строку агента
  // тот, более поздний, тоже освежил.
  if (outcome === "stale") return json({ ok: true, stale: true });
  return json({ ok: true });
});
