// Запуск: deno test supabase/functions/swarm-bot/lib/recording-watchdog.test.ts
//
// Сторож оборванной записи решает две вещи, ошибка в которых стоит дорого: жив ли писатель
// и кому идёт алерт. Ложный «жив» — человек не узнаёт, что встреча не записалась; ложный
// «мёртв» или не тот адресат — тревога не тому человеку. Поэтому тесты здесь идут вперёд кода.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AGENT_STALE_MIN,
  type AgentMeetingBeat,
  checkRecordingWatchdog,
  type HumanBeat,
  isSilent,
  RECORDER_STALE_MIN,
  type WatchdogStore,
} from "./recording-watchdog.ts";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

interface FakeState {
  humans: HumanBeat[];
  /** Встречи с agent_last_recording = true. */
  agentMeetings: AgentMeetingBeat[];
  diedNotices: Array<[string, number]>;
  /** Встречи, по которым между чтением и сбросом успел прийти свежий heartbeat бота. */
  racedMeetings: string[];
  failSendTo: number[];
}

function harness(over: Partial<FakeState> = {}) {
  const state: FakeState = {
    humans: [],
    agentMeetings: [],
    diedNotices: [],
    racedMeetings: [],
    failSendTo: [],
    ...over,
  };
  const clearedHumans: number[] = [];
  const clearedAgents: Array<[string, string]> = [];
  const sent: Array<{ to: number; text: string }> = [];
  const errors: string[] = [];
  const store: WatchdogStore = {
    recordingHumans: () => Promise.resolve(state.humans),
    clearHumanRecording: (id) => {
      clearedHumans.push(id);
      return Promise.resolve();
    },
    recordingAgentMeetings: () => Promise.resolve(state.agentMeetings),
    clearAgentRecording: (meetingId, seenAt) => {
      clearedAgents.push([meetingId, seenAt]);
      return Promise.resolve(!state.racedMeetings.includes(meetingId));
    },
    containerDiedNoticeSent: (meetingId, recipient) =>
      Promise.resolve(state.diedNotices.some(([m, r]) => m === meetingId && r === recipient)),
  };
  const send = (to: number, text: string) => {
    if (state.failSendTo.includes(to)) return Promise.reject(new Error("telegram down"));
    sent.push({ to, text });
    return Promise.resolve();
  };
  const run = () => checkRecordingWatchdog({ store, send, nowMs: NOW, logError: (m) => errors.push(m) });
  return { run, clearedHumans, clearedAgents, sent, errors };
}

/** Встреча, которую бот пишет: последний удар — minutes назад. */
function beat(minutes: number, over: Partial<AgentMeetingBeat> = {}): AgentMeetingBeat {
  return { id: "m-1", title: "Weekly <sync>", claim_owner: 501, agent_last_seen_at: minutesAgo(minutes), ...over };
}

Deno.test("isSilent: тишина строго дольше порога; без отметки — не тишина (как прежний SQL lt)", () => {
  assertEquals(isSilent(minutesAgo(21), NOW, 20), true);
  assertEquals(isSilent(minutesAgo(20), NOW, 20), false);
  assertEquals(isSilent(minutesAgo(5), NOW, 20), false);
  assertEquals(isSilent(null, NOW, 20), false);
  assertEquals(isSilent("not a date", NOW, 20), false);
});

Deno.test("порог бота короче порога рекордера: бот бьёт раз в 2 мин, рекордер раз в 15", () => {
  assert(AGENT_STALE_MIN < RECORDER_STALE_MIN);
  assert(AGENT_STALE_MIN >= 3 * 2, "порог обязан пережить пару пропущенных ударов по 2 мин");
});

// ── Рекордер человека (bumblebee): поведение как до правки ──────────────────────────

Deno.test("bumblebee: замолчал посреди записи → алерт ЕМУ ЖЕ про bumblebee, флаг сброшен", async () => {
  const h = harness({ humans: [{ telegram_id: 111, recorder_last_seen: minutesAgo(25) }] });
  const r = await h.run();
  assertEquals(h.clearedHumans, [111]);
  assertEquals(h.sent.length, 1);
  assertEquals(h.sent[0].to, 111);
  assertStringIncludes(h.sent[0].text, "bumblebee");
  assertEquals(r.humanAlerts, 1);
});

Deno.test("bumblebee: свежий heartbeat → тишина, флаг не трогаем", async () => {
  const h = harness({ humans: [{ telegram_id: 111, recorder_last_seen: minutesAgo(10) }] });
  await h.run();
  assertEquals(h.clearedHumans, []);
  assertEquals(h.sent, []);
});

Deno.test("bumblebee: сбой Telegram у одного не глушит остальных", async () => {
  const h = harness({
    humans: [
      { telegram_id: 111, recorder_last_seen: minutesAgo(25) },
      { telegram_id: 222, recorder_last_seen: minutesAgo(30) },
    ],
    failSendTo: [111],
  });
  await h.run();
  assertEquals(h.sent.map((s) => s.to), [222]);
  assertEquals(h.errors.length, 1);
});

// ── Бот scriba: heartbeat по встрече (D018, meetings.agent_last_*) ───────────────────

Deno.test("бот замолчал на записи → алерт человеку, за которого он писал встречу (EN и RU)", async () => {
  const h = harness({ agentMeetings: [beat(12)] });
  const r = await h.run();
  assertEquals(h.clearedAgents, [["m-1", minutesAgo(12)]]);
  assertEquals(h.sent.length, 1);
  assertEquals(h.sent[0].to, 501);
  const text = h.sent[0].text;
  assertStringIncludes(text, "scriba stopped responding");
  assertStringIncludes(text, "scriba перестал отвечать");
  assertStringIncludes(text, "Weekly &lt;sync&gt;"); // название экранировано под HTML Telegram
  assert(!text.includes("<sync>"), "сырое название не должно попасть ни в одну из половин");
  assert(!text.includes("bumblebee"), "бот — не рекордер человека: текст не про bumblebee");
  assertEquals(r.agentAlerts, 1);
});

Deno.test("БЛОКИРУЮЩИЙ: две встречи бота сразу — живая не прячет замолчавшую, алерт только по ней", async () => {
  // Ради этого heartbeat и переехал в строку встречи: при одной строке на агента удары живого
  // контейнера освежали общую отметку, и обрыв второй встречи проходил молча.
  const h = harness({
    agentMeetings: [
      beat(2, { id: "m-alive", title: "Daily", claim_owner: 601 }),
      beat(12, { id: "m-dead", title: "Retro", claim_owner: 602 }),
    ],
  });
  const r = await h.run();
  assertEquals(h.clearedAgents, [["m-dead", minutesAgo(12)]]);
  assertEquals(h.sent.map((s) => s.to), [602]);
  assertStringIncludes(h.sent[0].text, "Retro");
  assertEquals(r.agentAlerts, 1);
});

Deno.test("бот: граница порога — ровно AGENT_STALE_MIN ещё жив, на минуту больше уже нет", async () => {
  const alive = harness({ agentMeetings: [beat(AGENT_STALE_MIN)] });
  await alive.run();
  assertEquals(alive.sent, []);
  const dead = harness({ agentMeetings: [beat(AGENT_STALE_MIN + 1)] });
  await dead.run();
  assertEquals(dead.sent.length, 1);
});

Deno.test("бот жив (heartbeat свежий) → ни алерта, ни сброса", async () => {
  const h = harness({ agentMeetings: [beat(3)] });
  await h.run();
  assertEquals(h.clearedAgents, []);
  assertEquals(h.sent, []);
});

Deno.test("бот: пока читали, пришёл свежий heartbeat → сброс не удался, алерта нет", async () => {
  const h = harness({ agentMeetings: [beat(12)], racedMeetings: ["m-1"] });
  const r = await h.run();
  assertEquals(h.sent, []);
  assertEquals(r.agentAlerts, 0);
});

Deno.test("бот: оркестратор уже сказал container_died по этой встрече → второй раз не пугаем", async () => {
  const h = harness({ agentMeetings: [beat(40)], diedNotices: [["m-1", 501]] });
  const r = await h.run();
  assertEquals(h.clearedAgents.length, 1, "флаг сбрасывается, иначе сторож повторит проверку каждый час");
  assertEquals(h.sent, []);
  assertEquals(r.agentAlreadyNotified, 1);
});

Deno.test("бот: container_died ушёл ДРУГОМУ человеку → нашему адресату алерт всё равно идёт", async () => {
  const h = harness({ agentMeetings: [beat(40)], diedNotices: [["m-1", 999]] });
  await h.run();
  assertEquals(h.sent.map((s) => s.to), [501]);
});

Deno.test("бот: container_died по ДРУГОЙ встрече того же человека → алерт по этой всё равно идёт", async () => {
  const h = harness({ agentMeetings: [beat(40)], diedNotices: [["m-other", 501]] });
  await h.run();
  assertEquals(h.sent.map((s) => s.to), [501]);
});

Deno.test("бот: у встречи нет claim_owner → громкая ошибка, никому не пишем", async () => {
  const h = harness({ agentMeetings: [beat(40, { claim_owner: null })] });
  const r = await h.run();
  assertEquals(h.sent, []);
  assertEquals(h.errors.length, 1);
  assertStringIncludes(h.errors[0], "m-1");
  assertEquals(r.agentUnresolved, 1);
});

Deno.test("бот без названия встречи → подставляется «без названия», а не пустота", async () => {
  const h = harness({ agentMeetings: [beat(40, { title: null })] });
  await h.run();
  assertStringIncludes(h.sent[0].text, "untitled meeting");
  assertStringIncludes(h.sent[0].text, "встреча без названия");
});

Deno.test("бот и человек в одном прогоне не смешиваются: каждый в свою таблицу, свой текст", async () => {
  const h = harness({
    humans: [{ telegram_id: 501, recorder_last_seen: minutesAgo(25) }],
    agentMeetings: [beat(12)],
  });
  const r = await h.run();
  assertEquals(h.clearedHumans, [501]);
  assertEquals(h.clearedAgents.map(([id]) => id), ["m-1"]);
  assertEquals(h.sent.length, 2);
  assertStringIncludes(h.sent[0].text, "bumblebee");
  assertStringIncludes(h.sent[1].text, "scriba");
  assertEquals([r.humanAlerts, r.agentAlerts], [1, 1]);
});

Deno.test("бот: сбой Telegram → ошибка в журнал, прогон не падает", async () => {
  const h = harness({ agentMeetings: [beat(12)], failSendTo: [501] });
  const r = await h.run();
  assertEquals(h.errors.length, 1);
  assertEquals(r.agentAlerts, 0);
});
