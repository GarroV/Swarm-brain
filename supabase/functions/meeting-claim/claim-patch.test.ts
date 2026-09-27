// ВСЕХ функциях); перевод на голые спецификаторы из import-map из ветки непроверяем.
//
// Переход права транскрибации гасит пульс бота по встрече (D019): иначе новый claim_owner получает
// ложный алерт «scriba перестал отвечать» — удары бота после перехвата отбиваются 403, а флаг
// agent_last_recording остался бы true. Проверяется не только поле патча, но и то, что видит
// настоящий сторож (checkRecordingWatchdog) после применения патча к строке встречи.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AgentMeetingBeat,
  checkRecordingWatchdog,
  type WatchdogStore,
} from "../swarm-bot/lib/recording-watchdog.ts";
import { type ClaimPatchInput, occupyPatch, takeoverPatch } from "./claim-patch.ts";

const NOW_MS = Date.parse("2026-09-26T12:00:00.000Z");
const BOT_OWNER = 111; // за него бот писал встречу
const RECORDER_OWNER = 222; // его рекордер перехватил право

const input: ClaimPatchInput = {
  ownerId: RECORDER_OWNER,
  leaseIso: "2026-09-26T12:30:00.000Z",
  nowIso: "2026-09-26T12:00:00.000Z",
  micStartOffset: null,
  recordedSeconds: 3600,
};

interface Row extends AgentMeetingBeat {
  agent_last_recording: boolean | null;
}

/** Встреча, которую бот писал и замолчал на ней 15 минут назад — бот ушёл после 403. */
function botMeeting(): Row {
  return {
    id: "m-1",
    title: "Weekly",
    claim_owner: BOT_OWNER,
    agent_last_seen_at: new Date(NOW_MS - 15 * 60_000).toISOString(),
    agent_last_recording: true,
  };
}

/** Сторож над строками в памяти — ровно тот контракт, что у recording-watchdog-store.ts. */
async function watchdogSends(
  rows: Row[],
): Promise<Array<{ to: number; html: string }>> {
  const sent: Array<{ to: number; html: string }> = [];
  const store: WatchdogStore = {
    recordingHumans: () => Promise.resolve([]),
    clearHumanRecording: () => Promise.resolve(),
    recordingAgentMeetings: () => Promise.resolve(rows.filter((r) => r.agent_last_recording === true)),
    clearAgentRecording: (id, seenAt) => {
      const row = rows.find((r) =>
        r.id === id && r.agent_last_recording === true &&
        r.agent_last_seen_at === seenAt
      );
      if (!row) return Promise.resolve(false);
      row.agent_last_recording = false;
      return Promise.resolve(true);
    },
    containerDiedNoticeSent: () => Promise.resolve(false),
  };
  await checkRecordingWatchdog({
    store,
    nowMs: NOW_MS,
    send: (to, html) => {
      sent.push({ to, html });
      return Promise.resolve();
    },
    logError: () => {},
  });
  return sent;
}

function applied(row: Row, patch: Record<string, unknown>): Row {
  return { ...row, ...patch } as Row;
}

Deno.test("без перехвата замолчавший бот — алерт тому, за кого он писал (контроль сценария)", async () => {
  const sent = await watchdogSends([botMeeting()]);
  assertEquals(sent.map((s) => s.to), [BOT_OWNER]);
});

Deno.test("перехват более полной записью: сторож не шлёт алерт ни новому claim_owner, ни прежнему", async () => {
  const row = applied(botMeeting(), takeoverPatch(input));
  assertEquals(row.claim_owner, RECORDER_OWNER);
  assertEquals(await watchdogSends([row]), []);
});

Deno.test("занятие встречи с истёкшим лизом тоже гасит пульс бота: право ушло тем же путём", async () => {
  const row = applied(botMeeting(), occupyPatch(input));
  assertEquals(row.claim_owner, RECORDER_OWNER);
  assertEquals(await watchdogSends([row]), []);
});

Deno.test("сброс пульса едет в том же патче, что и смена claim_owner — не отдельным UPDATE", () => {
  for (const patch of [occupyPatch(input), takeoverPatch(input)]) {
    assertEquals(patch.claim_owner, RECORDER_OWNER);
    assertEquals(patch.agent_last_recording, false);
  }
});

Deno.test("перехват сбрасывает маркеры обработки, но не транскрипт и не черновик", () => {
  const patch = takeoverPatch(input);
  assertEquals(patch.summary_status, null);
  assertEquals(patch.process_state, null);
  assertEquals(patch.processing_lease, null);
  assertEquals(patch.last_progress_at, null);
  assertEquals(patch.recorded_seconds, 3600);
  assertEquals("transcript" in patch, false);
  assertEquals("draft_notes_md" in patch, false);
});

Deno.test("занятие свободной встречи не трогает маркеры обработки", () => {
  const patch = occupyPatch(input);
  assertEquals("summary_status" in patch, false);
  assertEquals("process_state" in patch, false);
});
