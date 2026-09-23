import { describe, expect, it, vi } from "vitest";
import { SwarmHttpError, SwarmTransportError } from "./errors.ts";
import { backoffMs, withRetry } from "./retry.ts";

/**
 * Сон и случайность внедряются — тест не ждёт настоящие секунды и не зависит от удачи.
 */
function harness(random = 0.5) {
  const slept: number[] = [];
  return {
    slept,
    options: {
      sleep: (ms: number): Promise<void> => {
        slept.push(ms);
        return Promise.resolve();
      },
      random: () => random,
    },
  };
}

describe("backoffMs", () => {
  it("растёт вдвое и упирается в потолок", () => {
    const options = { baseMs: 1000, maxBackoffMs: 8000, random: () => 1 };
    expect([0, 1, 2, 3, 4, 5].map((index) => backoffMs(index, options))).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });

  it("полный джиттер: от половины окна до целого", () => {
    const options = { baseMs: 1000, maxBackoffMs: 30_000 };
    expect(backoffMs(2, { ...options, random: () => 0 })).toBe(2000);
    expect(backoffMs(2, { ...options, random: () => 0.999999 })).toBe(4000);
  });
});

describe("withRetry", () => {
  it("успех с первой попытки не спит вовсе", async () => {
    const h = harness();
    const operation = vi.fn((): Promise<string> => Promise.resolve("ok"));

    await expect(withRetry(operation, h.options)).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(1);
    expect(h.slept).toEqual([]);
  });

  it("временный сбой повторяется и запись доезжает", async () => {
    const h = harness(0);
    let calls = 0;
    const operation = vi.fn((): Promise<string> => {
      calls += 1;
      if (calls < 3) throw new SwarmHttpError(503, "unavailable");
      return Promise.resolve("ok");
    });

    await expect(withRetry(operation, { ...h.options, baseMs: 1000 })).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(3);
    expect(h.slept).toEqual([500, 1000]);
  });

  it("обрыв сети повторяется так же, как 5xx", async () => {
    const h = harness(0);
    let calls = 0;
    const operation = (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new SwarmTransportError("ECONNREFUSED");
      return Promise.resolve("ok");
    };

    await expect(withRetry(operation, h.options)).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it.each([400, 401, 403, 404, 413])(
    "постоянный сбой %i бросается сразу, без ожидания",
    async (status) => {
      const h = harness();
      const operation = vi.fn((): Promise<never> => {
        throw new SwarmHttpError(status, "no");
      });

      await expect(withRetry(operation, h.options)).rejects.toBeInstanceOf(SwarmHttpError);

      expect(operation).toHaveBeenCalledTimes(1);
      expect(h.slept).toEqual([]);
    },
  );

  it("попытки кончились — наружу уходит последняя ошибка, а не «успех»", async () => {
    const h = harness();
    const operation = vi.fn((): Promise<never> => {
      throw new SwarmHttpError(500, "boom");
    });

    await expect(withRetry(operation, { ...h.options, attempts: 3 })).rejects.toMatchObject({
      status: 500,
    });

    expect(operation).toHaveBeenCalledTimes(3);
    expect(h.slept).toHaveLength(2);
  });

  it("Retry-After сервера сильнее бэкоффа", async () => {
    const h = harness(0);
    let calls = 0;
    const operation = (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new SwarmHttpError(429, "slow down", 7000);
      return Promise.resolve("ok");
    };

    await expect(withRetry(operation, { ...h.options, baseMs: 1000 })).resolves.toBe("ok");
    expect(h.slept).toEqual([7000]);
  });

  it("Retry-After не безграничен: час ожидания срезается потолком", async () => {
    const h = harness();
    const operation = vi.fn((): Promise<never> => {
      throw new SwarmHttpError(503, "wait", 3_600_000);
    });

    await expect(
      withRetry(operation, { ...h.options, attempts: 2, maxRetryAfterMs: 60_000 }),
    ).rejects.toBeInstanceOf(SwarmHttpError);

    expect(h.slept).toEqual([60_000]);
  });

  it("о каждом повторе сообщается наружу — сбой должен быть виден в логе", async () => {
    const h = harness(0);
    const seen: number[] = [];
    const operation = vi.fn((): Promise<never> => {
      throw new SwarmHttpError(500, "boom");
    });

    await expect(
      withRetry(operation, {
        ...h.options,
        attempts: 3,
        onRetry: (info) => {
          seen.push(info.attempt);
        },
      }),
    ).rejects.toBeInstanceOf(SwarmHttpError);

    expect(seen).toEqual([1, 2]);
  });
});
