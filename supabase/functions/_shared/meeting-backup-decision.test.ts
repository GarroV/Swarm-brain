// Решение по копии записи (#1314): покрыта / покрыта другой встречей / влить / ждать / нужен разбор.
// Ядро: ошибка здесь молчаливая — либо запись теряется (покрыта, а на деле нет), либо чужой звонок
// сливается в чужую встречу. Каждый случай — отдельная строка из реальных данных прода или из
// сценариев решения 11.11.2026 (recorder-pick-not-guess).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type BackupFacts,
  type BackupMeetingFacts,
  decideBackup,
  type OwnMeetingFacts,
  RESOLVE_GRACE_MS,
  separateRecordingTitle,
  WAIT_LIMIT_MS,
} from "./meeting-backup-decision.ts";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600_000;

const backup = (over: Partial<BackupFacts> = {}): BackupFacts => ({
  id: "b1",
  meetingId: "m1",
  uploader: 7,
  source: "person:7",
  recordedSeconds: 6100,
  createdAt: ago(5 * H),
  filesPurged: false,
  ...over,
});
const meeting = (over: Partial<BackupMeetingFacts> = {}): BackupMeetingFacts => ({
  id: "m1",
  claimOwner: 7,
  summaryStatus: "done",
  frozen: false,
  hasTranscript: true,
  recordedSeconds: 6526,
  sources: ["person:7"],
  ...over,
});
const own = (over: Partial<OwnMeetingFacts> = {}): OwnMeetingFacts => ({
  id: "m2",
  summaryStatus: "done",
  recordedSeconds: 6100,
  createdAt: ago(3 * H),
  ...over,
});
const decide = (b: BackupFacts, m: BackupMeetingFacts, o: OwnMeetingFacts[] = []) =>
  decideBackup({ backup: b, meeting: m, ownMeetings: o, nowMs: NOW });

Deno.test("ЯДРО: встреча получила полную запись того же человека, она не короче копии — копия покрыта (прод 09.11: 6526 с против 6100 с)", () => {
  assertEquals(decide(backup(), meeting()).action, "covered");
});

Deno.test("ЯДРО: запись встречи короче копии — не покрыта, копия вливается второй записью (#1271: 7 минут против 100)", () => {
  const v = decide(backup({ recordedSeconds: 6100 }), meeting({ recordedSeconds: 420 }));
  assertEquals(v.action, "ingest");
  if (v.action === "ingest") assertEquals(v.mode, "challenge");
});

Deno.test("ЯДРО: запись другого человека длиннее копии НЕ покрывает её и НЕ вливается в чужую встречу — своя отдельная встреча (прод 11.11: 4867 с против 630 с)", () => {
  const v = decide(
    backup({ uploader: 7, source: "person:7", recordedSeconds: 630 }),
    meeting({ claimOwner: 9, sources: ["person:9", "agent:scriba:9"], recordedSeconds: 4867 }),
  );
  assertEquals(v.action, "own_meeting");
});

Deno.test("ЯДРО: чужая встреча правлена/опубликована или ещё обрабатывается — копия всё равно своя встреча, чужую не трогаем", () => {
  for (
    const over of [{ frozen: true }, { summaryStatus: "processing" }, { summaryStatus: null, hasTranscript: false }]
  ) {
    const v = decide(backup({ recordedSeconds: 630 }), meeting({ claimOwner: 9, sources: ["person:9"], ...over }));
    assertEquals(v.action, "own_meeting", JSON.stringify(over));
  }
});

Deno.test("ЯДРО: у копии чужого человека нет файлов — своей встречи не из чего собрать, на разбор", () => {
  const v = decide(backup({ filesPurged: true }), meeting({ claimOwner: 9, sources: ["person:9"] }));
  assertEquals(v.action, "review");
});

Deno.test("ЯДРО: источник копии уже принят этой встречей, а держатель другой — запись там, дубля не заводим, на разбор", () => {
  const v = decide(backup({ recordedSeconds: 7000 }), meeting({ claimOwner: 9, sources: ["person:9", "person:7"] }));
  assertEquals(v.action, "review");
});

Deno.test("ЯДРО: тот же звук уже вернулся отдельной своей встречей (длительность совпала до 2 с) — покрыта другой встречей", () => {
  const v = decide(
    backup({ uploader: 7, recordedSeconds: 630.1029 }),
    meeting({ claimOwner: 9, sources: ["person:9"], recordedSeconds: 4867 }),
    [own({ recordedSeconds: 630.1029 })],
  );
  assertEquals(v.action, "covered_elsewhere");
  if (v.action === "covered_elsewhere") assertEquals(v.meetingId, "m2");
});

Deno.test("ЯДРО: своя встреча другой длины не считается тем же звуком", () => {
  const v = decide(
    backup({ recordedSeconds: 630 }),
    meeting({ claimOwner: 9, sources: ["person:9"] }),
    [own({ recordedSeconds: 1200 })],
  );
  assertEquals(v.action, "own_meeting");
});

Deno.test("ЯДРО: своя встреча, созданная ДО копии, не покрывает её", () => {
  const v = decide(
    backup({ recordedSeconds: 630 }),
    meeting({ claimOwner: 9, sources: ["person:9"] }),
    [own({ recordedSeconds: 630, createdAt: ago(9 * H) })],
  );
  assertEquals(v.action, "own_meeting");
});

Deno.test("ЯДРО: своя встреча с провальной обработкой (failed) не покрывает копию", () => {
  const v = decide(
    backup({ recordedSeconds: 630 }),
    meeting({ claimOwner: 9, sources: ["person:9"] }),
    [own({ recordedSeconds: 630, summaryStatus: "failed" })],
  );
  assertEquals(v.action, "own_meeting");
});

Deno.test("ЯДРО: у копии неизвестная длительность — покрытие по длине не выводится", () => {
  const v = decide(backup({ recordedSeconds: null }), meeting({ recordedSeconds: 6526 }));
  assertEquals(v.action, "ingest");
});

Deno.test("встреча ещё обрабатывается — ждём, ничего не решаем", () => {
  assertEquals(decide(backup(), meeting({ summaryStatus: "processing", recordedSeconds: 100 })).action, "wait");
});

Deno.test("ждали дольше предела — нужен разбор, а не вечное ожидание", () => {
  const v = decide(
    backup({ createdAt: ago(WAIT_LIMIT_MS + H) }),
    meeting({ summaryStatus: "processing", recordedSeconds: 100 }),
  );
  assertEquals(v.action, "review");
});

Deno.test("ЯДРО: встречу опубликовали или правили — автоматика её не трогает, копия на разбор", () => {
  const v = decide(backup(), meeting({ recordedSeconds: 420, frozen: true }));
  assertEquals(v.action, "review");
});

Deno.test("ЯДРО: покрытие проверяется раньше заморозки — опубликованная полная запись покрывает копию", () => {
  assertEquals(decide(backup(), meeting({ frozen: true })).action, "covered");
});

Deno.test("встреча без стенограммы (сбой) и тот же человек — вливаем обычной обработкой, не сравнением", () => {
  const v = decide(backup(), meeting({ summaryStatus: "failed", hasTranscript: false, recordedSeconds: 6526 }));
  assertEquals(v.action, "ingest");
  if (v.action === "ingest") assertEquals(v.mode, "process");
});

Deno.test("ЯДРО: файлы копии уже убраны, а записи не нашлось — влить нечего, на разбор", () => {
  const v = decide(backup({ filesPurged: true }), meeting({ recordedSeconds: 420 }));
  assertEquals(v.action, "review");
});

Deno.test("файлы убраны, но запись покрыта — отметка «покрыта» всё равно ставится", () => {
  assertEquals(decide(backup({ filesPurged: true }), meeting()).action, "covered");
});

Deno.test("копия моложе льготы — не трогаем: рекордер сам досылает и спрашивает владельца", () => {
  const v = decide(backup({ createdAt: ago(RESOLVE_GRACE_MS - 60_000) }), meeting({ recordedSeconds: 420 }));
  assertEquals(v.action, "wait");
});

Deno.test("встреча без держателя права — на разбор", () => {
  assertEquals(decide(backup(), meeting({ claimOwner: null, recordedSeconds: 420, sources: null })).action, "review");
});

Deno.test("название своей встречи — из встречи-источника с пометкой «отдельная запись» на двух языках; без названия — только пометка", () => {
  assertEquals(
    separateRecordingTitle("November Marketers"),
    "November Marketers — отдельная запись / separate recording",
  );
  assertEquals(separateRecordingTitle("  "), "Отдельная запись / Separate recording");
  assertEquals(separateRecordingTitle(null), "Отдельная запись / Separate recording");
  assertEquals(separateRecordingTitle("x".repeat(300)).length <= 200, true);
});
