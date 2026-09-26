// деплоятся с URL-импортами, перевод на голые спецификаторы из линта непроверяем из ветки.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AgentIdentity } from "../_shared/agent-auth.ts";
import { buildHeartbeatWrites, HeartbeatRejected, type HeartbeatWrite } from "./write.ts";

const NOW = "2026-09-17T10:00:00.000Z";
const MEETING_ID = "0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";

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

function only(writes: HeartbeatWrite[]): HeartbeatWrite {
  assertEquals(writes.length, 1);
  return writes[0];
}

function rejected(fn: () => unknown, status: number): void {
  const e = assertThrows(fn, HeartbeatRejected);
  assertEquals(e.status, status);
}

Deno.test("рекордер человека пишет в свою строку allowed_users — как раньше", () => {
  const w = only(buildHeartbeatWrites(human, {
    recording: true,
    version: 42,
    on_call: true,
    meeting_key: "uid:2026-09-17",
  }, NOW));
  assertEquals(w.table, "allowed_users");
  assertEquals(w.match, { telegram_id: 111 });
  assertEquals(w.requireHit, false);
  assertEquals(w.patch, {
    recorder_last_seen: NOW,
    recorder_last_recording: true,
    recorder_last_version: 42,
    recorder_last_on_call: true,
    recorder_last_meeting_key: "uid:2026-09-17",
  });
});

Deno.test("рекордер человека с meeting_id в теле не трогает строку встречи", () => {
  // Поля встречи — сигнал бота. Рекордер, написавший в них, выглядел бы для сторожа живым ботом.
  const w = only(buildHeartbeatWrites(human, { recording: true, meeting_id: MEETING_ID }, NOW));
  assertEquals(w.table, "allowed_users");
});

Deno.test("БЛОКИРУЮЩИЙ: heartbeat бота по встрече идёт в строку встречи, а не человека", () => {
  // Иначе watchdog checkRecorderHealth увидит у человека живой рекордер, которого нет, и
  // погасит настоящий сигнал «запись оборвалась» — тот самый молчаливый сбой, ради которого
  // watchdog и заведён.
  const writes = buildHeartbeatWrites(bot, {
    recording: true,
    version: 7,
    meeting_key: "uid:2026-09-17",
    meeting_id: MEETING_ID,
  }, NOW);
  assertEquals(writes.map((w) => w.table), ["meetings", "service_agents"]);
  for (const w of writes) {
    assertEquals(
      Object.keys(w.patch).some((k) => k.startsWith("recorder_")),
      false,
      "ни одно поле рекордера человека не должно быть тронуто",
    );
  }
  assertEquals(writes[0].patch, { agent_last_seen_at: NOW, agent_last_recording: true });
  assertEquals(writes[1].match, { id: "scriba" });
  assertEquals(writes[1].patch, { last_seen_at: NOW, last_version: 7 });
});

Deno.test("БЛОКИРУЮЩИЙ: бот обновляет только встречу своего воркспейса, заявленную за того, за кого он пришёл", () => {
  // Сверка владения — условия той же UPDATE, а не отдельное чтение: ни гонки, ни второго запроса.
  // Не совпало ни одной строки (чужая встреча, чужой воркспейс, встречи нет) — отказ, а не тишина.
  const meeting = buildHeartbeatWrites(bot, { recording: false, meeting_id: MEETING_ID }, NOW)[0];
  assertEquals(meeting.table, "meetings");
  assertEquals(meeting.match, { id: MEETING_ID, group_id: "alpha", claim_owner: 111 });
  assertEquals(meeting.requireHit, true);
  assertEquals(meeting.patch.agent_last_recording, false);
});

Deno.test("бот без воркспейса не пишет во встречу: сверять владение не с чем", () => {
  rejected(
    () => buildHeartbeatWrites({ ...bot, groupId: null }, { recording: true, meeting_id: MEETING_ID }, NOW),
    403,
  );
});

Deno.test("meeting_id не uuid — 400, а не 500 из базы", () => {
  for (const bad of ["not-a-uuid", 42, "", `${MEETING_ID}' or 1=1`]) {
    rejected(() => buildHeartbeatWrites(bot, { recording: false, meeting_id: bad }, NOW), 400);
  }
});

Deno.test("бот пишет запись без meeting_id — 400: сторожу не за чем было бы следить", () => {
  rejected(() => buildHeartbeatWrites(bot, { recording: true }, NOW), 400);
});

Deno.test("бот вне записи без meeting_id отмечается только в своей строке", () => {
  const w = only(buildHeartbeatWrites(bot, { recording: false, version: 3 }, NOW));
  assertEquals(w.table, "service_agents");
  assertEquals(w.patch, { last_seen_at: NOW, last_version: 3 });
  assertEquals(w.requireHit, false);
});

Deno.test("ключ встречи держится только пока идёт запись или звонок", () => {
  const idle = only(buildHeartbeatWrites(human, {
    recording: false,
    on_call: false,
    meeting_key: "uid:2026-09-17",
  }, NOW));
  assertEquals(idle.patch.recorder_last_meeting_key, null);

  const onCall = only(buildHeartbeatWrites(human, {
    recording: false,
    on_call: true,
    meeting_key: "uid:2026-09-17",
  }, NOW));
  assertEquals(onCall.patch.recorder_last_meeting_key, "uid:2026-09-17");
});

Deno.test("мусор в теле не роняет heartbeat и не попадает в базу", () => {
  const w = only(buildHeartbeatWrites(human, {
    recording: "yes",
    version: "42",
    on_call: 1,
    meeting_key: 7,
  }, NOW));
  assertEquals(w.patch.recorder_last_recording, false);
  assertEquals(w.patch.recorder_last_version, null);
  assertEquals(w.patch.recorder_last_on_call, false);
  assertEquals(w.patch.recorder_last_meeting_key, null);
});

Deno.test("пробельный ключ встречи считается отсутствующим", () => {
  const w = only(buildHeartbeatWrites(human, { recording: true, meeting_key: "   " }, NOW));
  assertEquals(w.patch.recorder_last_meeting_key, null);
});

Deno.test("бот без agentId — громкая ошибка, а не запись мимо цели", () => {
  const broken: AgentIdentity = {
    telegramId: 111,
    groupId: "alpha",
    kind: "bot",
  };
  assertThrows(() => buildHeartbeatWrites(broken, { recording: true, meeting_id: MEETING_ID }, NOW));
});
