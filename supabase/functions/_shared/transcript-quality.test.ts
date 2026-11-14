// Тесты оценки качества стенограммы (#75).
// Запуск: deno test -A --no-check supabase/functions/_shared/transcript-quality.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assessTranscript,
  countConfidence,
  MIN_SEGMENTS_FOR_VERDICT,
  qualityOfTranscript,
  repeatShare,
} from "./transcript-quality.ts";
import { refineWhisperReply } from "./whisper-segments.ts";

const speech = (n: number): string[] => Array.from({ length: n }, (_, i) => `уникальная фраза номер ${i} про рынок`);

Deno.test("живая речь без петель — запись нормальная", () => {
  const q = assessTranscript(speech(200));
  assertEquals(q.flag, "ok");
  assertEquals(q.repeat_share, 0);
  assertEquals(q.low_conf_share, null);
});

Deno.test("короткие реплики («да», «угу») в петлю не считаются, сколько бы раз ни повторились", () => {
  const texts = [...speech(100), ...Array(40).fill("Да."), ...Array(40).fill("Угу")];
  assertEquals(repeatShare(texts), 0);
});

Deno.test("петля, разбросанная НЕ подряд, ловится (dropConsecutiveRuns её пропускает)", () => {
  const loop = "Мы здесь делаем все, что угодно.";
  const texts: string[] = [];
  for (let i = 0; i < 60; i++) texts.push(i % 2 === 0 ? loop : `другая фраза номер ${i} из разговора`);
  const q = assessTranscript(texts);
  assertEquals(q.flag, "poor");
  assertEquals(q.reasons, ["repeats"]);
  assertEquals(q.repeat_share, 0.5);
});

Deno.test("регистр и пунктуация не прячут повтор", () => {
  assertEquals(
    repeatShare([
      "Я думаю, что я пропаду!",
      "я думаю что я пропаду",
      "Я ДУМАЮ что я пропаду.",
      "иное предложение здесь",
    ]),
    0.75,
  );
});

Deno.test("низкая уверенность Whisper по частям даёт вердикт, данных нет — вердикта по уверенности нет", () => {
  const poor = assessTranscript(speech(100), [{ n: 60, low: 30 }, { n: 40, low: 20 }]);
  assertEquals(poor.flag, "poor");
  assertEquals(poor.reasons, ["low_confidence"]);
  assertEquals(poor.low_conf_share, 0.5);
  assertEquals(assessTranscript(speech(100), [{ n: 100, low: 5 }]).flag, "ok");
  assertEquals(assessTranscript(speech(100), []).low_conf_share, null);
});

Deno.test("мало сегментов — вердикт не выносится", () => {
  const q = assessTranscript(Array(MIN_SEGMENTS_FOR_VERDICT - 1).fill("одна и та же длинная фраза"), [{
    n: 10,
    low: 10,
  }]);
  assertEquals(q.flag, "ok");
  assertEquals(q.repeat_share, 1);
});

Deno.test("countConfidence не считает сегменты без avg_logprob", () => {
  assertEquals(countConfidence([{}, {}]), undefined);
  assertEquals(countConfidence([{ avg_logprob: -0.3 }, { avg_logprob: -1.4 }, {}]), { n: 2, low: 1 });
});

Deno.test("разбор ответа Whisper: уверенность считается по оставшимся сегментам, галлюцинации не в счёт", () => {
  const r = refineWhisperReply({
    segments: [
      { start: 0, end: 2, text: "Давайте начнём встречу", avg_logprob: -0.2 },
      { start: 2, end: 4, text: "что-то неразборчивое тут", avg_logprob: -1.5 },
      { start: 4, end: 6, text: "Редактор субтитров А.Семкин Корректор А.Егорова", avg_logprob: -1.9 },
    ],
  });
  assertEquals(r.segments.map((s) => s.text), ["Давайте начнём встречу", "что-то неразборчивое тут"]);
  assertEquals(r.conf, { n: 2, low: 1 });
});

Deno.test("qualityOfTranscript берёт уверенность только готовых частей", () => {
  const segs = speech(100).map((text) => ({ text }));
  const q = qualityOfTranscript("m1", segs, [{ done: true, conf: { n: 10, low: 10 } }, {
    done: false,
    conf: { n: 1000, low: 0 },
  }]);
  assert(q.flag === "poor");
  assertEquals(q.low_conf_share, 1);
});
