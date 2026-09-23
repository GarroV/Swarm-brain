// Тесты сведения времени и говорящего в стенограмме встречи (ingest-speakers).
// Дорогая ошибка здесь молчаливая и правдоподобная: неверно подставленное имя выглядит как
// настоящая реплика этого человека и никто не заметит подмену, пока не станет поздно (в отличие
// от упавшего запроса, который виден сразу). Поэтому границы (парсинг, точки перекрытия, тай-брейк
// по индексу массива, регресс легенды для bumblebee) проверяются явно, а не «по коду видно».
// Запуск: deno test supabase/functions/_shared/speakers.test.ts
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSegments,
  MAX_SPEAKER_NAME_LEN,
  MAX_SPEAKER_SPANS,
  nameAt,
  parseSpeakerTimeline,
  type Segment,
  speakerLegend,
  type SpeakerPart,
  type SpeakerSpan,
  SpeakerTimelineError,
} from "./speakers.ts";

// ── Хелперы-конструкторы ────────────────────────────────────────────────────

function span(start: number, end: number, name: string): SpeakerSpan {
  return { start, end, name };
}

function seg(start: number, end: number, text: string, speaker?: string): Segment {
  return speaker === undefined ? { start, end, text } : { start, end, text, speaker };
}

function part(track: "sys" | "mic", done: boolean, segments?: Segment[]): SpeakerPart {
  return segments === undefined ? { track, done } : { track, done, segments };
}

// Бросок SpeakerTimelineError + проверка, что сообщение внятное: всегда упоминает "speakers",
// плюс любые дополнительные подстроки (индекс сбойного элемента, имя проблемного поля).
function expectSpeakerError(fn: () => unknown, ...mustInclude: string[]): SpeakerTimelineError {
  const err = assertThrows(fn, SpeakerTimelineError);
  assert(err.message.includes("speakers"), `сообщение "${err.message}" должно упоминать "speakers"`);
  for (const s of mustInclude) {
    assert(err.message.includes(s), `сообщение "${err.message}" должно содержать "${s}"`);
  }
  return err;
}

// ── parseSpeakerTimeline: пустой/no-op вход ─────────────────────────────────

Deno.test('parseSpeakerTimeline: null/undefined/пустая строка/"[]"/пустой массив → []', () => {
  assertEquals(parseSpeakerTimeline(null), []);
  assertEquals(parseSpeakerTimeline(undefined), []);
  assertEquals(parseSpeakerTimeline(""), []);
  assertEquals(parseSpeakerTimeline("[]"), []);
  assertEquals(parseSpeakerTimeline([]), []);
});

// ── parseSpeakerTimeline: валидный вход ─────────────────────────────────────

Deno.test("parseSpeakerTimeline: валидная JSON-строка разбирается корректно", () => {
  const result = parseSpeakerTimeline('[{"start":0,"end":12.4,"name":"Василий Гарро"}]');
  assertEquals(result, [{ start: 0, end: 12.4, name: "Василий Гарро" }]);
});

Deno.test("parseSpeakerTimeline: принимает уже разобранный массив (не JSON-строку)", () => {
  const input = [{ start: 1, end: 2, name: "Аня" }];
  assertEquals(parseSpeakerTimeline(input), [{ start: 1, end: 2, name: "Аня" }]);
});

Deno.test("parseSpeakerTimeline: порядок элементов сохраняется", () => {
  const raw = '[{"start":10,"end":20,"name":"B"},{"start":0,"end":5,"name":"A"}]';
  assertEquals(parseSpeakerTimeline(raw), [
    { start: 10, end: 20, name: "B" },
    { start: 0, end: 5, name: "A" },
  ]);
});

Deno.test("parseSpeakerTimeline: лишние поля элемента игнорируются", () => {
  const raw = '[{"start":0,"end":5,"name":"Аня","color":"red","extra":true}]';
  assertEquals(parseSpeakerTimeline(raw), [{ start: 0, end: 5, name: "Аня" }]);
});

Deno.test("parseSpeakerTimeline: имя чистится — перенос строки внутри и пробелы по краям", () => {
  const raw = '[{"start":0,"end":1,"name":"  Василий\\nГарро  "}]';
  assertEquals(parseSpeakerTimeline(raw), [{ start: 0, end: 1, name: "Василий Гарро" }]);
});

Deno.test("parseSpeakerTimeline: имя чистится — \\r\\t\\u0000\\u007f и повторные пробелы схлопываются", () => {
  const raw = JSON.stringify([{ start: 0, end: 1, name: "A\r\t\u0000\u007fB   C" }]);
  assertEquals(parseSpeakerTimeline(raw), [{ start: 0, end: 1, name: "A B C" }]);
});

Deno.test("parseSpeakerTimeline: имя длиной ровно MAX_SPEAKER_NAME_LEN — не ошибка (граница)", () => {
  const maxLen = "a".repeat(MAX_SPEAKER_NAME_LEN);
  assertEquals(parseSpeakerTimeline([{ start: 0, end: 1, name: maxLen }]), [
    { start: 0, end: 1, name: maxLen },
  ]);
});

Deno.test("parseSpeakerTimeline: ровно MAX_SPEAKER_SPANS элементов — не ошибка (граница)", () => {
  const many = Array.from({ length: MAX_SPEAKER_SPANS }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 5,
    name: `P${i}`,
  }));
  assertEquals(parseSpeakerTimeline(many).length, MAX_SPEAKER_SPANS);
});

// ── parseSpeakerTimeline: ошибки ────────────────────────────────────────────

Deno.test("parseSpeakerTimeline: строка не парсится как JSON → SpeakerTimelineError про JSON", () => {
  expectSpeakerError(() => parseSpeakerTimeline("{oops"), "JSON");
});

Deno.test("parseSpeakerTimeline: JSON не массив → SpeakerTimelineError про array", () => {
  expectSpeakerError(() => parseSpeakerTimeline('{"a":1}'), "array");
  expectSpeakerError(() => parseSpeakerTimeline('"строка"'), "array");
  expectSpeakerError(() => parseSpeakerTimeline("42"), "array");
});

Deno.test("parseSpeakerTimeline: элемент не объект → SpeakerTimelineError с индексом сбойного элемента", () => {
  expectSpeakerError(() => parseSpeakerTimeline("[null]"), "speakers[0]");
  expectSpeakerError(() => parseSpeakerTimeline("[42]"), "speakers[0]");
  expectSpeakerError(() => parseSpeakerTimeline('["a"]'), "speakers[0]");
  expectSpeakerError(() => parseSpeakerTimeline("[[1,2]]"), "speakers[0]");
});

Deno.test("parseSpeakerTimeline: name не строка → SpeakerTimelineError (число/отсутствует/null)", () => {
  const ok = '{"start":0,"end":1,"name":"A"}';
  // третий элемент (индекс 2) сбойный — сообщение обязано указать именно speakers[2]
  expectSpeakerError(
    () => parseSpeakerTimeline(`[${ok},${ok},{"start":0,"end":1,"name":42}]`),
    "speakers[2]",
    "name",
  );
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":0,"end":1}]'), "speakers[0]", "name");
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":0,"end":1,"name":null}]'), "speakers[0]", "name");
});

Deno.test("parseSpeakerTimeline: name пустое после чистки → SpeakerTimelineError", () => {
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":0,"end":1,"name":""}]'), "speakers[0]", "name");
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":0,"end":1,"name":"   "}]'), "speakers[0]", "name");
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":0,"end":1,"name":"\\n\\t"}]'), "speakers[0]", "name");
});

Deno.test("parseSpeakerTimeline: name длиннее MAX_SPEAKER_NAME_LEN после чистки → SpeakerTimelineError", () => {
  const tooLong = "a".repeat(MAX_SPEAKER_NAME_LEN + 1);
  expectSpeakerError(() => parseSpeakerTimeline([{ start: 0, end: 1, name: tooLong }]), "speakers[0]", "name");
});

Deno.test("parseSpeakerTimeline: start не конечное число → SpeakerTimelineError (строка/null/NaN/Infinity/отсутствует)", () => {
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":"a","end":5,"name":"A"}]'), "speakers[0]", "start");
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":null,"end":5,"name":"A"}]'), "speakers[0]", "start");
  expectSpeakerError(() => parseSpeakerTimeline([{ start: NaN, end: 5, name: "A" }]), "speakers[0]", "start");
  expectSpeakerError(() => parseSpeakerTimeline([{ start: Infinity, end: 5, name: "A" }]), "speakers[0]", "start");
  expectSpeakerError(() => parseSpeakerTimeline('[{"end":5,"name":"A"}]'), "speakers[0]", "start");
});

Deno.test("parseSpeakerTimeline: end не конечное число → SpeakerTimelineError (строка/null/NaN/Infinity/отсутствует)", () => {
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":0,"end":"a","name":"A"}]'), "speakers[0]", "end");
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":0,"end":null,"name":"A"}]'), "speakers[0]", "end");
  expectSpeakerError(() => parseSpeakerTimeline([{ start: 0, end: NaN, name: "A" }]), "speakers[0]", "end");
  expectSpeakerError(() => parseSpeakerTimeline([{ start: 0, end: Infinity, name: "A" }]), "speakers[0]", "end");
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":0,"name":"A"}]'), "speakers[0]", "end");
});

Deno.test("parseSpeakerTimeline: start < 0 → SpeakerTimelineError", () => {
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":-1,"end":5,"name":"A"}]'), "speakers[0]", "start");
});

Deno.test("parseSpeakerTimeline: end <= start (включая равенство) → SpeakerTimelineError", () => {
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":5,"end":5,"name":"A"}]'), "speakers[0]", "end");
  expectSpeakerError(() => parseSpeakerTimeline('[{"start":5,"end":2,"name":"A"}]'), "speakers[0]", "end");
});

Deno.test("parseSpeakerTimeline: больше MAX_SPEAKER_SPANS элементов → SpeakerTimelineError", () => {
  const many = Array.from({ length: MAX_SPEAKER_SPANS + 1 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 5,
    name: `P${i}`,
  }));
  expectSpeakerError(() => parseSpeakerTimeline(many));
});

// ── nameAt ───────────────────────────────────────────────────────────────────

Deno.test("nameAt: сегмент целиком внутри одного интервала → имя этого интервала", () => {
  const tl = [span(0, 10, "A")];
  assertEquals(nameAt(tl, 2, 5), "A");
});

Deno.test("nameAt: сегмент пересекает два интервала, у первого перекрытие больше → имя первого", () => {
  const tl = [span(0, 10, "A"), span(10, 20, "B")];
  assertEquals(nameAt(tl, 5, 12), "A"); // overlap(A)=5, overlap(B)=2
});

Deno.test("nameAt: сегмент пересекает два интервала, у второго перекрытие больше → имя второго", () => {
  const tl = [span(0, 10, "A"), span(10, 20, "B")];
  assertEquals(nameAt(tl, 8, 20), "B"); // overlap(A)=2, overlap(B)=10
});

Deno.test("nameAt: ничья по величине перекрытия → имя более раннего элемента массива", () => {
  const tl = [span(0, 10, "A"), span(10, 20, "B")];
  assertEquals(nameAt(tl, 5, 15), "A"); // overlap(A)=5, overlap(B)=5
});

Deno.test("nameAt: сегмент попал в дыру между интервалами → null", () => {
  const tl = [span(0, 5, "A"), span(10, 15, "B")];
  assertEquals(nameAt(tl, 6, 9), null);
});

Deno.test("nameAt: сегмент до начала всего таймлайна и после его конца → null", () => {
  const tl = [span(10, 20, "A")];
  assertEquals(nameAt(tl, 0, 5), null);
  assertEquals(nameAt(tl, 25, 30), null);
});

Deno.test("nameAt: касание границ перекрытием не считается → null", () => {
  const tl = [span(0, 10, "A")];
  assertEquals(nameAt(tl, 10, 15), null); // start сегмента === end интервала
  assertEquals(nameAt(tl, -5, 0), null); // end сегмента === start интервала
});

Deno.test("nameAt: пустой таймлайн → null всегда", () => {
  assertEquals(nameAt([], 0, 10), null);
  assertEquals(nameAt([], 5, 5), null);
});

Deno.test("nameAt: сегмент нулевой/отрицательной длины — внутри интервала даёт имя, вне — null", () => {
  const tl = [span(0, 10, "A")];
  assertEquals(nameAt(tl, 5, 5), "A");
  assertEquals(nameAt(tl, 0, 0), "A"); // левая граница включительно
  assertEquals(nameAt(tl, 10, 10), "A"); // правая граница включительно
  assertEquals(nameAt(tl, 20, 20), null);
  assertEquals(nameAt(tl, 8, 3), "A"); // end < start — точка берётся по start
});

Deno.test("nameAt: интервалы во входе не по возрастанию времени — верный результат всё равно находится", () => {
  const tl = [span(10, 20, "B"), span(0, 10, "A")];
  assertEquals(nameAt(tl, 2, 5), "A");
  assertEquals(nameAt(tl, 12, 18), "B");
});

Deno.test("nameAt: перекрывающиеся между собой интервалы (двое говорят одновременно) → больший перекрытием", () => {
  const tl = [span(0, 10, "A"), span(5, 15, "B")];
  assertEquals(nameAt(tl, 6, 14), "B"); // overlap(A)=4, overlap(B)=8
  assertEquals(nameAt(tl, 6, 9), "A"); // overlap(A)=3, overlap(B)=3 — ничья → более ранний
});

Deno.test("nameAt: NaN/Infinity на входе → null", () => {
  const tl = [span(0, 10, "A")];
  assertEquals(nameAt(tl, NaN, 5), null);
  assertEquals(nameAt(tl, 0, NaN), null);
  assertEquals(nameAt(tl, Infinity, 5), null);
  assertEquals(nameAt(tl, 0, Infinity), null);
  assertEquals(nameAt(tl, Infinity, Infinity), null);
});

// ── buildSegments ────────────────────────────────────────────────────────────

Deno.test("buildSegments: пустой таймлайн — та же метка, что и раньше (мягкая деградация)", () => {
  const parts: SpeakerPart[] = [
    part("sys", true, [seg(0, 5, "привет")]),
    part("mic", true, [seg(0, 3, "да")]),
  ];
  assertEquals(buildSegments(parts, 100, []), [
    { start: 0, end: 5, text: "привет", speaker: "собеседник" },
    { start: 100, end: 103, text: "да", speaker: "я" },
  ]);
});

Deno.test("buildSegments: таймлайн покрывает sys-сегменты → подставляются имена, mic остаётся «я»", () => {
  const tl = [span(0, 5, "Анна")];
  const parts: SpeakerPart[] = [
    part("sys", true, [seg(0, 5, "текст")]),
    part("mic", true, [seg(0, 3, "ok")]),
  ];
  assertEquals(buildSegments(parts, 0, tl), [
    { start: 0, end: 5, text: "текст", speaker: "Анна" },
    { start: 0, end: 3, text: "ok", speaker: "я" },
  ]);
});

Deno.test("buildSegments: таймлайн покрывает время mic-сегмента — mic всё равно «я» (таймлайн не перебивает)", () => {
  const micOffset = 100;
  const tl = [span(100, 103, "Анна")]; // ровно диапазон mic после сдвига
  const parts: SpeakerPart[] = [part("mic", true, [seg(0, 3, "ok")])];
  assertEquals(buildSegments(parts, micOffset, tl), [
    { start: 100, end: 103, text: "ok", speaker: "я" },
  ]);
});

Deno.test("buildSegments: done=false, отсутствующие segments и пустой segments — часть пропускается", () => {
  const parts: SpeakerPart[] = [
    part("sys", false, [seg(0, 5, "не должно попасть — done=false")]),
    { track: "sys", done: true }, // segments отсутствует вовсе
    part("sys", true, []), // segments пустой
    part("mic", true, [seg(0, 2, "единственное")]),
  ];
  assertEquals(buildSegments(parts, 0, []), [
    { start: 0, end: 2, text: "единственное", speaker: "я" },
  ]);
});

Deno.test("buildSegments: sys-сегмент без найденного имени остаётся «собеседник» рядом с найденным", () => {
  const tl = [span(0, 5, "Анна")];
  const parts: SpeakerPart[] = [
    part("sys", true, [seg(0, 5, "нашли"), seg(10, 15, "не нашли")]),
  ];
  assertEquals(buildSegments(parts, 0, tl), [
    { start: 0, end: 5, text: "нашли", speaker: "Анна" },
    { start: 10, end: 15, text: "не нашли", speaker: "собеседник" },
  ]);
});

Deno.test("buildSegments: micOffset сдвигает только mic-сегменты", () => {
  const parts: SpeakerPart[] = [
    part("sys", true, [seg(0, 5, "a")]),
    part("mic", true, [seg(0, 5, "b")]),
  ];
  assertEquals(buildSegments(parts, 50, []), [
    { start: 0, end: 5, text: "a", speaker: "собеседник" },
    { start: 50, end: 55, text: "b", speaker: "я" },
  ]);
});

Deno.test("buildSegments: результат отсортирован по start, даже если sys идёт позже mic во входе", () => {
  const parts: SpeakerPart[] = [
    part("mic", true, [seg(10, 12, "mic-later")]),
    part("sys", true, [seg(0, 3, "sys-earlier-but-second-in-input")]),
  ];
  assertEquals(buildSegments(parts, 0, []), [
    { start: 0, end: 3, text: "sys-earlier-but-second-in-input", speaker: "собеседник" },
    { start: 10, end: 12, text: "mic-later", speaker: "я" },
  ]);
});

Deno.test("buildSegments: пустой список частей → []", () => {
  assertEquals(buildSegments([], 0, []), []);
});

// ── speakerLegend ────────────────────────────────────────────────────────────
// Регресс: пока среди меток нет ни одной ИМЕНОВАННОЙ (только "я"/"собеседник" в любом
// сочетании, включая их отсутствие), легенда обязана быть дословно старой строкой —
// это защита действующего рекордера bumblebee от неожиданной смены текста промпта.

Deno.test("speakerLegend: без именованных меток — старая строка дословно (ownerName задан)", () => {
  const expected =
    "Стенограмма (реплики помечены «собеседник» — другие участники, «я» — это Василий Гарро (владелец записи)):";
  assertEquals(speakerLegend("Василий Гарро", ["собеседник", "я"]), expected);
  assertEquals(speakerLegend("Василий Гарро", ["я"]), expected);
  assertEquals(speakerLegend("Василий Гарро", ["собеседник"]), expected);
  assertEquals(speakerLegend("Василий Гарро", []), expected);
  assertEquals(speakerLegend("Василий Гарро", [undefined, "", "я"]), expected);
});

Deno.test("speakerLegend: без именованных меток, ownerName=null — старая строка дословно", () => {
  const expected = "Стенограмма (реплики помечены «собеседник» — другие участники, «я» — владелец записи):";
  assertEquals(speakerLegend(null, ["собеседник", "я"]), expected);
  assertEquals(speakerLegend(null, []), expected);
  assertEquals(speakerLegend(null, [undefined, "собеседник"]), expected);
});

Deno.test("speakerLegend: T033 — только именованные метки → нет «я» и нет «собеседник»", () => {
  const legend = speakerLegend("Василий Гарро", ["Василий Гарро", "Анна"]);
  assert(!legend.includes("«я»"), `не должно содержать «я»: ${legend}`);
  assert(!legend.includes("«собеседник»"), `не должно содержать «собеседник»: ${legend}`);
  assert(legend.startsWith("Стенограмма ("));
  assert(legend.endsWith("):"));
});

Deno.test("speakerLegend: именованные метки + пустые/undefined среди них не мешают новой ветке", () => {
  const legend = speakerLegend("Василий Гарро", [undefined, "", "Анна"]);
  assert(!legend.includes("«я»"));
  assert(!legend.includes("«собеседник»"));
  assert(legend.startsWith("Стенограмма ("));
  assert(legend.endsWith("):"));
});

Deno.test("speakerLegend: именованные + «собеседник» присутствует, «я» — нет", () => {
  const legend = speakerLegend("Василий Гарро", ["Анна", "собеседник"]);
  assert(legend.includes("«собеседник»"), `должно упоминать «собеседник»: ${legend}`);
  assert(!legend.includes("«я»"), `не должно упоминать «я»: ${legend}`);
});

Deno.test("speakerLegend: именованные + «я» присутствует (ownerName задан) → есть «я» и имя владельца", () => {
  const legend = speakerLegend("Василий Гарро", ["Анна", "я"]);
  assert(legend.includes("«я»"), `должно упоминать «я»: ${legend}`);
  assert(legend.includes("Василий Гарро"), `должно содержать имя владельца: ${legend}`);
  assert(!legend.includes("«собеседник»"), `не должно упоминать «собеседник»: ${legend}`);
});

Deno.test("speakerLegend: именованные + «я» присутствует, ownerName=null", () => {
  const legend = speakerLegend(null, ["Анна", "я"]);
  assert(legend.includes("«я»"), `должно упоминать «я»: ${legend}`);
  assert(legend.startsWith("Стенограмма ("));
  assert(legend.endsWith("):"));
});

Deno.test("speakerLegend: именованные + и «собеседник», и «я» вместе", () => {
  const legend = speakerLegend("Василий", ["Анна", "собеседник", "я"]);
  assert(legend.includes("«я»"));
  assert(legend.includes("«собеседник»"));
  assert(legend.includes("Василий"));
});
