// deno-lint-ignore-file no-import-prefix -- см. _shared/agent-auth.ts: edge-функции Swarm
// деплоятся с URL-импортами, перевод на голые спецификаторы из линта непроверяем из ветки.
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AgentIdentity } from "../_shared/agent-auth.ts";
import { buildHeartbeatWrite } from "./write.ts";

const NOW = "2026-09-17T10:00:00.000Z";

const human: AgentIdentity = {
  telegramId: 111,
  groupId: "alpha",
  kind: "recorder",
};
const bot: AgentIdentity = {
  telegramId: 111,
  groupId: "alpha",
  kind: "bot",
  agentId: "scriba",
};

Deno.test("рекордер человека пишет в свою строку allowed_users — как раньше", () => {
  const w = buildHeartbeatWrite(human, {
    recording: true,
    version: 42,
    on_call: true,
    meeting_key: "uid:2026-09-17",
  }, NOW);
  assertEquals(w.table, "allowed_users");
  assertEquals(w.matchColumn, "telegram_id");
  assertEquals(w.matchValue, 111);
  assertEquals(w.patch, {
    recorder_last_seen: NOW,
    recorder_last_recording: true,
    recorder_last_version: 42,
    recorder_last_on_call: true,
    recorder_last_meeting_key: "uid:2026-09-17",
  });
});

Deno.test("БЛОКИРУЮЩИЙ: heartbeat бота идёт в строку агента, а не человека", () => {
  // Иначе watchdog checkRecorderHealth увидит у человека живой рекордер, которого нет, и
  // погасит настоящий сигнал «запись оборвалась» — тот самый молчаливый сбой, ради которого
  // watchdog и заведён.
  const w = buildHeartbeatWrite(bot, {
    recording: true,
    meeting_key: "uid:2026-09-17",
  }, NOW);
  assertEquals(w.table, "service_agents");
  assertEquals(w.matchColumn, "id");
  assertEquals(w.matchValue, "scriba");
  assertEquals(
    Object.keys(w.patch).some((k) => k.startsWith("recorder_")),
    false,
    "ни одно поле рекордера человека не должно быть тронуто",
  );
  assertEquals(w.patch, {
    last_seen_at: NOW,
    last_recording: true,
    last_version: null,
    last_meeting_key: "uid:2026-09-17",
  });
});

Deno.test("ключ встречи держится только пока идёт запись или звонок", () => {
  const idle = buildHeartbeatWrite(human, {
    recording: false,
    on_call: false,
    meeting_key: "uid:2026-09-17",
  }, NOW);
  assertEquals(idle.patch.recorder_last_meeting_key, null);

  const onCall = buildHeartbeatWrite(human, {
    recording: false,
    on_call: true,
    meeting_key: "uid:2026-09-17",
  }, NOW);
  assertEquals(onCall.patch.recorder_last_meeting_key, "uid:2026-09-17");
});

Deno.test("мусор в теле не роняет heartbeat и не попадает в базу", () => {
  const w = buildHeartbeatWrite(human, {
    recording: "yes",
    version: "42",
    on_call: 1,
    meeting_key: 7,
  }, NOW);
  assertEquals(w.patch.recorder_last_recording, false);
  assertEquals(w.patch.recorder_last_version, null);
  assertEquals(w.patch.recorder_last_on_call, false);
  assertEquals(w.patch.recorder_last_meeting_key, null);
});

Deno.test("пробельный ключ встречи считается отсутствующим", () => {
  const w = buildHeartbeatWrite(
    human,
    { recording: true, meeting_key: "   " },
    NOW,
  );
  assertEquals(w.patch.recorder_last_meeting_key, null);
});

Deno.test("бот без agentId — громкая ошибка, а не запись мимо цели", () => {
  const broken: AgentIdentity = {
    telegramId: 111,
    groupId: "alpha",
    kind: "bot",
  };
  assertThrows(() => buildHeartbeatWrite(broken, { recording: true }, NOW));
});
