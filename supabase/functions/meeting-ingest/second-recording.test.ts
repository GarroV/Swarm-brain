// Что делает meeting-ingest с выгрузкой, когда у встречи уже есть запись (T156): бот scriba и
// рекордер bumblebee ОДНОГО человека пишут одну встречу, claim_owner у обоих один, выгружают оба.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideUpload, isNewRecording, transcriptEndSec, uploadSource } from "./second-recording.ts";

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

Deno.test("повтор той же выгрузки, пока она обрабатывается, — второй обработки нет", () => {
  assertEquals(
    decideUpload({ summaryStatus: "processing", sources: [BOT], hasTranscript: false, incoming: BOT }),
    "already_processed",
  );
});

Deno.test("повтор той же выгрузки к готовой встрече (длина как в стенограмме) — второй обработки нет", () => {
  assertEquals(
    decideUpload({
      summaryStatus: "done",
      sources: [BOT],
      hasTranscript: true,
      incoming: BOT,
      incomingSeconds: 2520,
      transcriptSeconds: 2504,
    }),
    "already_processed",
  );
});

Deno.test("новая длинная запись того же источника к готовой встрече — вторая запись, а не повтор (#1271)", () => {
  // Живой случай: рекордер выгрузил 6526 с после первой записи на 425 с; ответ already_processed
  // терял её молча, а рекордер помечал выгруженной.
  assertEquals(
    decideUpload({
      summaryStatus: "done",
      sources: [PERSON],
      hasTranscript: true,
      incoming: PERSON,
      incomingSeconds: 6526,
      transcriptSeconds: 425,
    }),
    "challenge",
  );
});

Deno.test("конец стенограммы неизвестен, аудио настоящее — безопасная сторона: вторая запись, а не молчаливая потеря", () => {
  const base = { summaryStatus: "done", sources: [PERSON], hasTranscript: true, incoming: PERSON };
  assertEquals(decideUpload({ ...base, incomingSeconds: 425, transcriptSeconds: null }), "challenge");
  assertEquals(decideUpload({ ...base, incomingSeconds: 425 }), "challenge");
});

Deno.test("аудио не измерено (не разбираемый AAC) — как раньше, повтор", () => {
  const base = { summaryStatus: "done", sources: [PERSON], hasTranscript: true, incoming: PERSON };
  assertEquals(decideUpload({ ...base, incomingSeconds: null, transcriptSeconds: 425 }), "already_processed");
  assertEquals(decideUpload({ ...base }), "already_processed");
});

Deno.test("новая запись: заметно длиннее стенограммы; ретрай с хвостом тишины и короче — повтор", () => {
  assertEquals(isNewRecording(2520, 2504), false); // тот же файл
  assertEquals(isNewRecording(2504 + 60, 2504), false); // хвост тишины после последней реплики
  assertEquals(isNewRecording(1000, 2504), false); // короче текущей: арбитр её всё равно не возьмёт
  assertEquals(isNewRecording(3500, 2504), true);
  assertEquals(isNewRecording(300, 100), true); // короткие: порог по абсолютному запасу, не по доле
  assertEquals(isNewRecording(150, 100), false);
});

Deno.test("конец стенограммы — максимум end по сегментам; пусто или мусор — null", () => {
  assertEquals(transcriptEndSec({ segments: [{ end: 3 }, { end: 2504.2 }, { end: 10 }] } as never), 2504.2);
  assertEquals(transcriptEndSec(null), null);
  assertEquals(transcriptEndSec({ segments: [] } as never), null);
  assertEquals(transcriptEndSec({ segments: [{ end: "x" }, {}] } as never), null);
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
    decideUpload({
      summaryStatus: "done",
      sources: [BOT, PERSON],
      hasTranscript: true,
      incoming: BOT,
      incomingSeconds: 1800,
      transcriptSeconds: 1790,
    }),
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
