import { describe, expect, it } from "vitest";
import { type SpeakerSample, SpeakerTimelineCollector, spansFromSamples } from "./speakers.ts";

const sample = (at: number, name: string | null): SpeakerSample => ({ at, name });

describe("spansFromSamples", () => {
  it("пустой опрос даёт пустой таймлайн, а не выдуманный интервал", () => {
    expect(spansFromSamples([], 10)).toEqual([]);
  });

  it("один говорящий на всю запись — один интервал до конца", () => {
    const spans = spansFromSamples([sample(0, "Вера"), sample(1, "Вера"), sample(2, "Вера")], 3);
    expect(spans).toEqual([{ start: 0, end: 3, name: "Вера" }]);
  });

  it("смена говорящего режет интервал в момент опроса, когда её заметили", () => {
    const spans = spansFromSamples([sample(0, "Вера"), sample(1, "Вера"), sample(2, "Пётр")], 3);
    expect(spans).toEqual([
      { start: 0, end: 2, name: "Вера" },
      { start: 2, end: 3, name: "Пётр" },
    ]);
  });

  it("тишина закрывает интервал и своего не создаёт", () => {
    const spans = spansFromSamples([sample(0, "Вера"), sample(1, null), sample(2, null)], 3);
    expect(spans).toEqual([{ start: 0, end: 1, name: "Вера" }]);
  });

  it("тишина между репликами одного человека даёт два интервала, а не один склеенный", () => {
    const spans = spansFromSamples([sample(0, "Вера"), sample(1, null), sample(2, "Вера")], 3);
    expect(spans).toEqual([
      { start: 0, end: 1, name: "Вера" },
      { start: 2, end: 3, name: "Вера" },
    ]);
  });

  it("до первого опроса ничего не приписывается: запись могла начаться раньше разговора", () => {
    const spans = spansFromSamples([sample(5, "Вера")], 6);
    expect(spans[0]?.start).toBe(5);
  });

  it("пустое имя — это «не знаем», а не участник с пустым именем", () => {
    const blank = [sample(0, " ".repeat(3)), sample(1, "")];
    expect(spansFromSamples(blank, 2)).toEqual([]);
  });

  it("имя чистится от пробелов по краям — иначе сервер не сведёт его с участником", () => {
    expect(spansFromSamples([sample(0, "  Вера Петровна  ")], 1)).toEqual([
      { start: 0, end: 1, name: "Вера Петровна" },
    ]);
  });

  it("конец записи раньше последнего опроса не даёт интервала наизнанку", () => {
    expect(spansFromSamples([sample(0, "Вера"), sample(9, "Пётр")], 5)).toEqual([
      { start: 0, end: 5, name: "Вера" },
    ]);
  });

  it("опросы, пришедшие не по порядку, упорядочиваются, а не ломают таймлайн", () => {
    const spans = spansFromSamples([sample(2, "Пётр"), sample(0, "Вера")], 3);
    expect(spans).toEqual([
      { start: 0, end: 2, name: "Вера" },
      { start: 2, end: 3, name: "Пётр" },
    ]);
  });

  it("интервалы монотонны и не перекрываются", () => {
    const spans = spansFromSamples(
      [sample(0, "А"), sample(1, "Б"), sample(2, null), sample(3, "А"), sample(4, "В")],
      5,
    );
    for (const [index, span] of spans.entries()) {
      expect(span.end).toBeGreaterThan(span.start);
      const previous = spans[index - 1];
      if (previous) expect(span.start).toBeGreaterThanOrEqual(previous.end);
    }
    expect(spans.map((s) => s.name)).toEqual(["А", "Б", "А", "В"]);
  });
});

/**
 * Дождаться условия, а не «поспать и надеяться»: опрос идёт в настоящем времени,
 * и фиксированная пауза либо тормозит тест, либо делает его капризным.
 */
async function waitUntil(isReady: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isReady()) {
    if (Date.now() > deadline) throw new Error("не дождались условия опроса");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/**
 * Источник, который отдаёт заготовленную последовательность по кругу (последнее значение
 * повторяется) и считает обращения.
 */
function scriptedSource(script: readonly (string | null | Error)[]) {
  let index = 0;
  return {
    calls: (): number => index,
    activeSpeaker: (): Promise<string | null> => {
      const value = script[Math.min(index, script.length - 1)];
      index += 1;
      if (value instanceof Error) throw value;
      return Promise.resolve(value ?? null);
    },
  };
}

/**
 * Сколько опросов ждать: весь сценарий плюс запас, чтобы последний интервал получил
 * ненулевую длину. Без запаса `stop()` приходит в тот же миг, что и последний опрос.
 */
const afterScript = (script: readonly unknown[]): number => script.length + 2;

describe("SpeakerTimelineCollector", () => {
  it("собирает таймлайн из опросов активного говорящего", async () => {
    const script = ["Вера", "Вера", "Пётр", null, "Пётр"];
    const source = scriptedSource(script);
    const collector = new SpeakerTimelineCollector(source, { intervalMs: 5 });

    collector.start();
    await waitUntil(() => source.calls() >= afterScript(script));
    const spans = await collector.stop();

    expect(spans.map((s) => s.name)).toEqual(["Вера", "Пётр", "Пётр"]);
    // Первый опрос случается не в математический ноль, а через миг после старта, и под
    // нагрузкой этот миг растёт. Утверждение здесь — «таймлайн начинается с начала
    // записи, а не позже», а не «ровно 0»: точное равенство делало прогон капризным.
    expect(spans[0]?.start).toBeLessThan(0.5);
    for (const span of spans) expect(span.end).toBeGreaterThan(span.start);
  });

  it("сбой опроса не валит запись, но и не выдаётся за тишину", async () => {
    const seen: unknown[] = [];
    const script = ["Вера", new Error("страница отвалилась"), "Вера"];
    const source = scriptedSource(script);
    const collector = new SpeakerTimelineCollector(source, {
      intervalMs: 5,
      onError: (error) => {
        seen.push(error);
      },
    });

    collector.start();
    await waitUntil(() => source.calls() >= afterScript(script));
    const spans = await collector.stop();

    expect(seen).toHaveLength(1);
    expect(spans.map((s) => s.name)).toEqual(["Вера", "Вера"]);
  });

  it("после stop опросы прекращаются", async () => {
    const source = scriptedSource(["Вера", "Вера"]);
    const collector = new SpeakerTimelineCollector(source, { intervalMs: 5 });

    collector.start();
    await waitUntil(() => source.calls() >= 3);
    await collector.stop();
    const after = source.calls();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(source.calls()).toBe(after);
  });

  it("никого не слышали — таймлайн пуст, и это нормальный исход", async () => {
    const source = scriptedSource([null, null]);
    const collector = new SpeakerTimelineCollector(source, { intervalMs: 5 });

    collector.start();
    await waitUntil(() => source.calls() >= 3);

    await expect(collector.stop()).resolves.toEqual([]);
  });
});
