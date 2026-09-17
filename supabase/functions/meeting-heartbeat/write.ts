import type { AgentIdentity } from "../_shared/agent-auth.ts";

// Куда именно ложится heartbeat. Вынесено чистой функцией не ради красоты: разница между
// «рекордер человека жив» и «служебный агент жив» — единственное, что удерживает watchdog
// checkRecorderHealth от ложного вывода, и проверять её на живом Deno.serve нечем.

export interface HeartbeatBody {
  recording?: unknown;
  version?: unknown;
  on_call?: unknown;
  meeting_key?: unknown;
}

export interface HeartbeatWrite {
  table: "allowed_users" | "service_agents";
  matchColumn: "telegram_id" | "id";
  matchValue: number | string;
  patch: Record<string, unknown>;
}

export function buildHeartbeatWrite(
  identity: AgentIdentity,
  body: HeartbeatBody,
  nowIso: string,
): HeartbeatWrite {
  const recording = body.recording === true;
  const version = typeof body.version === "number" ? body.version : null;
  const onCall = body.on_call === true;
  const rawKey = typeof body.meeting_key === "string"
    ? body.meeting_key.trim()
    : "";
  // Ключ держим только пока человек в звонке (или мы пишем). Иначе он завис бы после
  // созвона и панель показывала бы ON AIR на давно закончившейся встрече.
  const meetingKey = (onCall || recording) && rawKey ? rawKey : null;

  if (identity.kind === "bot") {
    if (!identity.agentId) {
      // Тихо записать такое некуда, а записать в allowed_users — ровно та ошибка, от которой
      // здесь стоит развилка. Значит, громко.
      throw new Error(
        "heartbeat: identity.kind=bot без agentId — некуда писать",
      );
    }
    return {
      table: "service_agents",
      matchColumn: "id",
      matchValue: identity.agentId,
      // on_call у агента нет: он сам и есть участник звонка, отдельный факт «человек в созвоне»
      // для него не определён и колонки под него в service_agents нет.
      patch: {
        last_seen_at: nowIso,
        last_recording: recording,
        last_version: version,
        last_meeting_key: meetingKey,
      },
    };
  }

  return {
    table: "allowed_users",
    matchColumn: "telegram_id",
    matchValue: identity.telegramId,
    patch: {
      recorder_last_seen: nowIso,
      recorder_last_recording: recording,
      recorder_last_version: version,
      recorder_last_on_call: onCall,
      recorder_last_meeting_key: meetingKey,
    },
  };
}
