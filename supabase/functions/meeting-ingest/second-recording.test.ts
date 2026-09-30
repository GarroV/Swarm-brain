// Что делает meeting-ingest с выгрузкой, когда у встречи уже есть запись (T156): бот scriba и
// рекордер bumblebee ОДНОГО человека пишут одну встречу, claim_owner у обоих один, выгружают оба.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideUpload, uploadSource } from "./second-recording.ts";

const ME = 7;
const OTHER = 8;
const BOT = "agent:scriba-1:7";
const PERSON = "person:7";

Deno.test("источник выгрузки: агент — по его id и человеку, за которого пишет; человек — один на всех своих клиентов", () => {
  assertEquals(uploadSource({ kind: "bot", agentId: "scriba-1", telegramId: ME }), BOT);
  assertEquals(uploadSource({ kind: "recorder", telegramId: ME }), PERSON);
  assertEquals(uploadSource({ kind: "recorder_prev", telegramId: ME }), PERSON);
  assertEquals(uploadSource({ kind: "mcp", telegramId: ME }), PERSON);
});

Deno.test("запись другого человека — другой источник, а не повтор чужой выгрузки", () => {
  assertEquals(uploadSource({ kind: "recorder", telegramId: OTHER }) === PERSON, false);
  assertEquals(uploadSource({ kind: "bot", agentId: "scriba-1", telegramId: OTHER }) === BOT, false);
  assertEquals(
    decideUpload({
      summaryStatus: "processing",
      sources: [PERSON],
      hasTranscript: false,
      incoming: uploadSource({ kind: "recorder", telegramId: OTHER }),
    }),
    "queue",
  );
});

Deno.test("первая выгрузка встречи — обычная обработка", () => {
  assertEquals(
    decideUpload({ summaryStatus: null, sources: [], hasTranscript: false, incoming: BOT }),
    "process",
  );
});

Deno.test("повтор той же выгрузки, пока она обрабатывается или готова, — второй обработки нет", () => {
  for (const summaryStatus of ["processing", "done"]) {
    assertEquals(
      decideUpload({ summaryStatus, sources: [BOT], hasTranscript: summaryStatus === "done", incoming: BOT }),
      "already_processed",
    );
  }
});

Deno.test("состояние старой формы (источник не записан) — как раньше, already_processed", () => {
  // В полёте на момент раскатки: чья это выгрузка, неизвестно, и повтор bumblebee нельзя принять
  // за вторую запись — иначе одно и то же аудио пошло бы в Whisper дважды.
  for (const summaryStatus of ["processing", "done"]) {
    assertEquals(
      decideUpload({ summaryStatus, sources: null, hasTranscript: true, incoming: PERSON }),
      "already_processed",
    );
  }
});

Deno.test("вторая запись другого источника, пока первая в обработке, — в очередь, а не в мусор", () => {
  assertEquals(
    decideUpload({ summaryStatus: "processing", sources: [BOT], hasTranscript: false, incoming: PERSON }),
    "queue",
  );
});

Deno.test("вторая запись другого источника к готовой встрече — обработать и сравнить с текущей", () => {
  assertEquals(
    decideUpload({ summaryStatus: "done", sources: [PERSON], hasTranscript: true, incoming: BOT }),
    "challenge",
  );
});

Deno.test("источник, уже бывший у встречи, не становится претендентом повторно", () => {
  // Очередь отработала: у встречи побывали обе записи; поздний ретрай первой — не новая запись.
  assertEquals(
    decideUpload({ summaryStatus: "done", sources: [BOT, PERSON], hasTranscript: true, incoming: BOT }),
    "already_processed",
  );
});

Deno.test("claim обнулил маркеры, а стенограмма осталась — новая выгрузка сравнивается с ней", () => {
  // Перехват тем же владельцем сбрасывает summary_status и process_state, но не transcript.
  assertEquals(
    decideUpload({ summaryStatus: null, sources: null, hasTranscript: true, incoming: PERSON }),
    "challenge",
  );
});

Deno.test("обработка упала: повтор того же источника перерабатывается как раньше, чужой — сравнивается", () => {
  assertEquals(
    decideUpload({ summaryStatus: "failed", sources: [PERSON], hasTranscript: true, incoming: PERSON }),
    "process",
  );
  assertEquals(
    decideUpload({ summaryStatus: "failed", sources: [PERSON], hasTranscript: true, incoming: BOT }),
    "challenge",
  );
});

Deno.test("упавшая обработка без стенограммы — сравнивать не с чем, обычная обработка", () => {
  assertEquals(
    decideUpload({ summaryStatus: "failed", sources: [PERSON], hasTranscript: false, incoming: BOT }),
    "process",
  );
});
