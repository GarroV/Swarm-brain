// деплоятся с URL-импортами, перевод на голые спецификаторы из линта непроверяем из ветки.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AgentIdentity } from "../_shared/agent-auth.ts";
import {
  buildHeartbeatWrites,
  freshnessFilter,
  HeartbeatRejected,
  type HeartbeatWrite,
  MAX_RECORDED_SECONDS,
  RECORDED_GROWTH_FACTOR,
  type RecordedPrior,
  recordedSecondsCeiling,
  recordedSecondsWrite,
} from "./write.ts";

const NOW = "2026-09-17T10:00:00.000Z";
// NOW + 30 минут: лиз права транскрибации, который удар бота продлевает (CLAIM_LEASE_TTL_SEC).
const LEASE_UNTIL = "2026-09-17T10:30:00.000Z";
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
  const w = only(
    buildHeartbeatWrites(
      human,
      { recording: true, meeting_id: MEETING_ID },
      NOW,
    ),
  );
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
    recorded_seconds: 1260,
  }, NOW);
  assertEquals(writes.map((w) => w.table), ["meetings", "service_agents"]);
  for (const w of writes) {
    assertEquals(
      Object.keys(w.patch).some((k) => k.startsWith("recorder_")),
      false,
      "ни одно поле рекордера человека не должно быть тронуто",
    );
  }
  assertEquals(writes[0].patch, {
    agent_last_seen_at: NOW,
    agent_last_recording: true,
    lease_expires_at: LEASE_UNTIL,
  });
  // Секунды — отдельной записью после чтения строки (planWrites): только вверх и с потолком.
  assertEquals(writes[0].reportedSeconds, 1260);
  assertEquals(writes[1].match, { id: "scriba" });
  assertEquals(writes[1].patch, { last_seen_at: NOW, last_version: 7 });
});

Deno.test("БЛОКИРУЮЩИЙ: бот обновляет только встречу своего воркспейса, заявленную за того, за кого он пришёл", () => {
  // Сверка владения — условия той же UPDATE, а не отдельное чтение: ни гонки, ни второго запроса.
  // Не совпало ни одной строки (чужая встреча, чужой воркспейс, встречи нет) — отказ, а не тишина.
  const meeting = buildHeartbeatWrites(
    bot,
    { recording: false, meeting_id: MEETING_ID },
    NOW,
  )[0];
  assertEquals(meeting.table, "meetings");
  assertEquals(meeting.match, {
    id: MEETING_ID,
    group_id: "alpha",
    claim_owner: 111,
  });
  assertEquals(meeting.requireHit, true);
  assertEquals(meeting.patch.agent_last_recording, false);
});

Deno.test("удар бота по встрече монотонен: опоздавший не перетирает более свежий", () => {
  // Два удара коммитятся в любом порядке; без условия поздний recording:true поверх свежего
  // recording:false взвёл бы сторожа на закончившейся встрече, а поздний recorded_seconds
  // занизил бы запись для арбитража. Строка агента — с тем же условием по своей колонке: иначе
  // опоздавший удар старой сборки вернул бы в last_version её номер (перестановка — apply.test.ts).
  const [meeting, agent] = buildHeartbeatWrites(bot, {
    recording: true,
    meeting_id: MEETING_ID,
  }, NOW);
  assertEquals(meeting.newerThan, { column: "agent_last_seen_at", value: NOW });
  assertEquals(meeting.patch.agent_last_seen_at, meeting.newerThan?.value);
  assertEquals(agent.newerThan, { column: "last_seen_at", value: NOW });
  assertEquals(agent.patch.last_seen_at, agent.newerThan?.value);
});

Deno.test("ЯДРО: удар бота по своей встрече продлевает лиз — claim через 30 минут не считает живого бота истёкшим", () => {
  // Бот заявляется до захода, и лиз 30 минут отсчитывается от claim. Без продления любой claim
  // после этого срока занимал встречу как брошенную (ветка «лиз истёк» в meeting-claim), хотя бот
  // пишет её прямо сейчас. Продление — условие той же UPDATE, что сверяет claim_owner: удар после
  // перехвата встречу не находит и лиз новому владельцу не трогает.
  const [meeting] = buildHeartbeatWrites(bot, { recording: true, meeting_id: MEETING_ID }, NOW);
  assertEquals(meeting.table, "meetings");
  assertEquals(meeting.patch.lease_expires_at, LEASE_UNTIL);
  assertEquals(meeting.match.claim_owner, 111);
});

Deno.test("ЯДРО: удар recording:false лиз НЕ продлевает — контейнер без записи встречу не держит", () => {
  // Разбор прав T155 (HIGH): агент, который шлёт удары без записи, иначе держал бы встречу вечно.
  const [meeting] = buildHeartbeatWrites(bot, { recording: false, meeting_id: MEETING_ID, recorded_seconds: 900 }, NOW);
  assertEquals("lease_expires_at" in meeting.patch, false);
  assertEquals(meeting.patch.agent_last_recording, false);
  assertEquals(meeting.reportedSeconds, 900, "финальный удар несёт всю длину записи — секунды пишутся");
});

Deno.test("ЯДРО: удар бота несёт записанные секунды в recorded_seconds — арбитраж видит запись, а не 0", () => {
  // meeting-claim сравнивает претендента с recorded_seconds строки. Бот заявился с 0 секунд, и
  // без этого поля любой рекордер с записью от 5 минут отбирал у него встречу.
  const [meeting] = buildHeartbeatWrites(bot, {
    recording: true,
    meeting_id: MEETING_ID,
    recorded_seconds: 2400.6,
  }, NOW);
  assertEquals(meeting.reportedSeconds, 2400.6);
  const [zero] = buildHeartbeatWrites(bot, { recording: true, meeting_id: MEETING_ID, recorded_seconds: 0 }, NOW);
  assertEquals(zero.reportedSeconds, 0);
});

Deno.test("удар бота без recorded_seconds не трогает записанное — продлевает только лиз", () => {
  // Старая сборка бота секунд не шлёт: затирать ими записанное (null) значило бы обнулить запись
  // для арбитража.
  const [meeting] = buildHeartbeatWrites(bot, { recording: true, meeting_id: MEETING_ID }, NOW);
  assertEquals("recorded_seconds" in meeting.patch, false);
  assertEquals(meeting.reportedSeconds, undefined);
  assertEquals(meeting.patch.lease_expires_at, LEASE_UNTIL);
});

Deno.test("ЯДРО: recorded_seconds не число, отрицательно или сверх суток — 400, в арбитраж не попадает", () => {
  // Завышенные секунды навсегда закрыли бы встречу от перехвата более полной записью.
  for (const bad of [-1, "600", true, MAX_RECORDED_SECONDS + 1, 1e308]) {
    rejected(
      () => buildHeartbeatWrites(bot, { recording: true, meeting_id: MEETING_ID, recorded_seconds: bad }, NOW),
      400,
    );
  }
  const [edge] = buildHeartbeatWrites(bot, {
    recording: true,
    meeting_id: MEETING_ID,
    recorded_seconds: MAX_RECORDED_SECONDS,
  }, NOW);
  assertEquals(edge.reportedSeconds, MAX_RECORDED_SECONDS);
});

// ── Потолок секунд: не быстрее прошедшего времени с запасом, и только вверх ────

const MINUTE = 60_000;
const minutesBefore = (m: number) => new Date(Date.parse(NOW) - m * MINUTE).toISOString();
function meetingWith(seconds: number): HeartbeatWrite {
  return buildHeartbeatWrites(bot, { recording: true, meeting_id: MEETING_ID, recorded_seconds: seconds }, NOW)[0];
}

Deno.test("ЯДРО: скачок секунд до суток урезается до прошедшего с прошлого удара времени с запасом", () => {
  // Разбор прав T155 (HIGH): агент с ошибкой единиц или украденным токеном одним ударом ставил
  // 86400 с, и встреча навсегда закрывалась от более полной записи.
  const prior: RecordedPrior = { recorded_seconds: 600, agent_last_seen_at: minutesBefore(2), lease_expires_at: null };
  const w = recordedSecondsWrite(meetingWith(MAX_RECORDED_SECONDS), prior, NOW);
  assertEquals(w?.patch.recorded_seconds, 600 + 120 * RECORDED_GROWTH_FACTOR);
  assertEquals(recordedSecondsCeiling(prior, NOW), 600 + 120 * RECORDED_GROWTH_FACTOR);
});

Deno.test("честный удар проходит как есть: 2 минуты записи за 2 минуты с запасом на задержку сети", () => {
  const prior: RecordedPrior = { recorded_seconds: 600, agent_last_seen_at: minutesBefore(2), lease_expires_at: null };
  // Прошлый удар шёл 10 с, этот — мгновенно: сервер видит 110 с, а бот записал 120.
  const w = recordedSecondsWrite(meetingWith(720), { ...prior, agent_last_seen_at: minutesBefore(110 / 60) }, NOW);
  assertEquals(w?.patch.recorded_seconds, 720);
  assertEquals(w?.below, { column: "recorded_seconds", value: 720 });
  assertEquals(w?.match, meetingWith(720).match, "та же сверка владения, что у записи встречи");
  // Секунды — в той же UPDATE, что отметка удара: соседний удар не прочтёт одно без другого.
  assertEquals(w?.patch.agent_last_seen_at, NOW);
  assertEquals(w?.newerThan, meetingWith(720).newerThan);
  assertEquals(w?.fallback?.patch.recorded_seconds, undefined, "промах по секундам — удар ложится без них");
  assertEquals(w?.fallback?.requireHit, true);
});

Deno.test("ЯДРО: первый удар отсчитывается от выдачи лиза (claim бота), а не от начала времён", () => {
  // Бот заявляется до захода: лиз выдан claim-ом 20 минут назад — больше 20 минут записи быть не может.
  const prior: RecordedPrior = {
    recorded_seconds: null,
    agent_last_seen_at: null,
    lease_expires_at: new Date(Date.parse(NOW) + 10 * MINUTE).toISOString(), // выдан 20 мин назад
  };
  assertEquals(recordedSecondsCeiling(prior, NOW), 1200 * RECORDED_GROWTH_FACTOR);
  assertEquals(recordedSecondsWrite(meetingWith(1100), prior, NOW)?.patch.recorded_seconds, 1100);
  assertEquals(
    recordedSecondsWrite(meetingWith(5000), prior, NOW)?.patch.recorded_seconds,
    1200 * RECORDED_GROWTH_FACTOR,
  );
});

Deno.test("ЯДРО: секунды только вверх — меньшее значение не пишется вовсе", () => {
  // Сдача T156: запасная запись рекордера того же человека подняла секунды встречи до 1200, а бот
  // к этой минуте записал 660. Удар, вернувший 660, дал бы рекордеру повод «перехватить» снова.
  const prior: RecordedPrior = { recorded_seconds: 1200, agent_last_seen_at: minutesBefore(2), lease_expires_at: null };
  assertEquals(recordedSecondsWrite(meetingWith(660), prior, NOW), null);
  assertEquals(recordedSecondsWrite(meetingWith(1200), prior, NOW), null);
  assertEquals(recordedSecondsWrite(meetingWith(1300), prior, NOW)?.patch.recorded_seconds, 1300);
});

Deno.test("опоздавший удар (прошлый удар позже этого) и строка без отсчёта роста не дают", () => {
  const late: RecordedPrior = {
    recorded_seconds: 600,
    agent_last_seen_at: new Date(Date.parse(NOW) + MINUTE).toISOString(),
    lease_expires_at: null,
  };
  assertEquals(recordedSecondsCeiling(late, NOW), 600);
  const bare: RecordedPrior = { recorded_seconds: null, agent_last_seen_at: null, lease_expires_at: null };
  assertEquals(recordedSecondsCeiling(bare, NOW), 0);
  assertEquals(recordedSecondsWrite(meetingWith(300), bare, NOW), null);
});

Deno.test("удар без секунд записи секунд не порождает", () => {
  const [meeting] = buildHeartbeatWrites(bot, { recording: true, meeting_id: MEETING_ID }, NOW);
  const prior: RecordedPrior = { recorded_seconds: 0, agent_last_seen_at: minutesBefore(2), lease_expires_at: null };
  assertEquals(recordedSecondsWrite(meeting, prior, NOW), null);
});

Deno.test("удар без встречи и удар рекордера человека не пишут ни лиз, ни секунды", () => {
  const agentOnly = only(buildHeartbeatWrites(bot, { recording: false, recorded_seconds: 600 }, NOW));
  assertEquals(agentOnly.table, "service_agents");
  assertEquals(agentOnly.patch, { last_seen_at: NOW, last_version: null });
  const person = only(
    buildHeartbeatWrites(human, { recording: true, recorded_seconds: 600, meeting_id: MEETING_ID }, NOW),
  );
  assertEquals(person.table, "allowed_users");
  assertEquals("lease_expires_at" in person.patch || "recorded_seconds" in person.patch, false);
});

Deno.test("бот без воркспейса не пишет во встречу: сверять владение не с чем", () => {
  rejected(
    () =>
      buildHeartbeatWrites({ ...bot, groupId: null }, {
        recording: true,
        meeting_id: MEETING_ID,
      }, NOW),
    403,
  );
});

Deno.test("meeting_id не uuid — 400, а не 500 из базы", () => {
  for (const bad of ["not-a-uuid", 42, "", `${MEETING_ID}' or 1=1`]) {
    rejected(
      () => buildHeartbeatWrites(bot, { recording: false, meeting_id: bad }, NOW),
      400,
    );
  }
});

Deno.test("бот пишет запись без meeting_id — 400: сторожу не за чем было бы следить", () => {
  rejected(() => buildHeartbeatWrites(bot, { recording: true }, NOW), 400);
});

Deno.test("бот вне записи без meeting_id отмечается только в своей строке", () => {
  const w = only(
    buildHeartbeatWrites(bot, { recording: false, version: 3 }, NOW),
  );
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
  const w = only(
    buildHeartbeatWrites(human, { recording: true, meeting_key: "   " }, NOW),
  );
  assertEquals(w.patch.recorder_last_meeting_key, null);
});

Deno.test("бот без agentId — громкая ошибка, а не запись мимо цели", () => {
  const broken: AgentIdentity = {
    telegramId: 111,
    groupId: "alpha",
    kind: "bot",
  };
  assertThrows(() =>
    buildHeartbeatWrites(
      broken,
      { recording: true, meeting_id: MEETING_ID },
      NOW,
    )
  );
});

Deno.test("ЯДРО: запись встречи с секундами требует в базе ОБА условия — свежесть удара и рост секунд", () => {
  const prior: RecordedPrior = { recorded_seconds: 600, agent_last_seen_at: minutesBefore(2), lease_expires_at: null };
  const w = recordedSecondsWrite(meetingWith(720), prior, NOW)!;
  assertEquals(
    freshnessFilter(w),
    `and(agent_last_seen_at.is.null,recorded_seconds.is.null),and(agent_last_seen_at.is.null,recorded_seconds.lt.720),` +
      `and(agent_last_seen_at.lt.${NOW},recorded_seconds.is.null),and(agent_last_seen_at.lt.${NOW},recorded_seconds.lt.720)`,
  );
  assertEquals(freshnessFilter(w.fallback!), `agent_last_seen_at.is.null,agent_last_seen_at.lt.${NOW}`);
  assertEquals(freshnessFilter({ table: "allowed_users", match: {}, patch: {}, requireHit: false }), null);
});
