import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  INITIAL_STATUS,
  LoginWatch,
  REPEAT_EVERY_MS,
  isProbeDue,
  isQuietHour,
  loginAlertText,
} from "./login-watch.ts";

// 2026-11-06 в Белграде зима (UTC+1): 10:00 по Белграду — 09:00 UTC.
const MORNING = Date.UTC(2026, 10, 6, 9, 0, 0);
const HOUR = 60 * 60 * 1000;

describe("тексты — утверждены владельцем 06.11.2026", () => {
  it("слёт и восстановление дословно", () => {
    expect(loginAlertText("broken", "Google просит вход")).toBe(
      "🔴 Scriba: слетел вход Google у бота — встречи в Meet не записываются. " +
        "Причина: Google просит вход. Нужен перелогин бота. Напоминаю каждые 4 часа, пока не починим.",
    );
    expect(loginAlertText("recovered", "")).toBe("🟢 Scriba: вход Google бота снова работает.");
  });
});

describe("тихие часы по Белграду", () => {
  it("с 22:00 до 08:00 тихо, днём нет — с учётом зимнего и летнего времени", () => {
    expect(isQuietHour(Date.UTC(2026, 10, 6, 6, 59))).toBe(true); // 07:59 CET
    expect(isQuietHour(Date.UTC(2026, 10, 6, 7, 0))).toBe(false); // 08:00 CET
    expect(isQuietHour(Date.UTC(2026, 10, 6, 20, 59))).toBe(false); // 21:59 CET
    expect(isQuietHour(Date.UTC(2026, 10, 6, 21, 0))).toBe(true); // 22:00 CET
    expect(isQuietHour(Date.UTC(2026, 6, 6, 5, 59))).toBe(true); // 07:59 CEST
    expect(isQuietHour(Date.UTC(2026, 6, 6, 6, 0))).toBe(false); // 08:00 CEST
  });
});

describe("LoginWatch — слетевший вход как состояние", () => {
  let directory: string;
  let file: string;
  let sent: string[];
  let lines: string[];
  let now: number;
  let isChannelDown: boolean;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "scriba-login-watch-"));
    file = path.join(directory, "login-status.json");
    sent = [];
    lines = [];
    now = MORNING;
    isChannelDown = false;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function watcher(hasChannel = true): LoginWatch {
    return new LoginWatch({
      file,
      log: (line) => {
        lines.push(line);
      },
      now: () => now,
      ...(hasChannel && {
        send: (text: string): Promise<void> => {
          if (isChannelDown) return Promise.reject(new Error("канал 502"));
          sent.push(text);
          return Promise.resolve();
        },
      }),
    });
  }

  it("удачная проба при целом входе ничего не шлёт", async () => {
    const watch = watcher();
    await watch.accepted();
    await watch.probeFinished();
    await watch.tick();
    expect(sent).toEqual([]);
    expect(watch.status.lastOkAt).toBe(MORNING);
  });

  it("первый слёт — сообщение сразу, второй слёт подряд не дублирует", async () => {
    const watch = watcher();
    await watch.signinRequired("Google просит вход");
    await watch.signinRequired("Google просит вход");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Причина: Google просит вход.");
  });

  it("повтор через 4 часа днём, не раньше", async () => {
    const watch = watcher();
    await watch.signinRequired("причина");
    now += REPEAT_EVERY_MS - 1;
    await watch.tick();
    expect(sent).toHaveLength(1);
    now += 1; // 14:00 по Белграду
    await watch.tick();
    expect(sent).toHaveLength(2);
    await watch.tick();
    expect(sent).toHaveLength(2);
  });

  it("ночью повторов нет, утром в 08:00 повтор уходит", async () => {
    now = Date.UTC(2026, 10, 6, 17, 0); // 18:00 по Белграду
    const watch = watcher();
    await watch.signinRequired("причина");
    now = Date.UTC(2026, 10, 6, 21, 30); // 22:30: четыре часа прошли, но ночь
    await watch.tick();
    now = Date.UTC(2026, 10, 7, 5, 0); // 06:00
    await watch.tick();
    expect(sent).toHaveLength(1);
    now = Date.UTC(2026, 10, 7, 7, 0); // 08:00
    await watch.tick();
    expect(sent).toHaveLength(2);
  });

  it("восстановление — одно сообщение и сброс состояния", async () => {
    const watch = watcher();
    await watch.signinRequired("причина");
    now += HOUR;
    await watch.accepted();
    expect(sent.at(-1)).toBe("🟢 Scriba: вход Google бота снова работает.");
    expect(sent).toHaveLength(2);
    expect(watch.status.broken).toBe(false);
    now += 10 * HOUR;
    await watch.tick();
    await watch.accepted();
    expect(sent).toHaveLength(2);
  });

  it("сообщение о слёте не ушло — «восстановился» не шлём", async () => {
    isChannelDown = true;
    const watch = watcher();
    await watch.signinRequired("причина");
    isChannelDown = false;
    await watch.accepted();
    expect(sent).toEqual([]);
    expect(lines.some((line) => line.includes("НЕ УШЛА"))).toBe(true);
  });

  it("слёт при упавшем канале: следующий tick пробует снова, не ожидая 4 часов", async () => {
    isChannelDown = true;
    const watch = watcher();
    await watch.signinRequired("причина");
    isChannelDown = false;
    now += 60_000;
    await watch.tick();
    expect(sent).toHaveLength(1);
  });

  it("канал не настроен — громкая строка, бот живёт", async () => {
    const watch = watcher(false);
    await watch.signinRequired("причина");
    expect(lines.some((line) => line.includes("НЕ ОТПРАВЛЕНА"))).toBe(true);
    expect(watch.status.broken).toBe(true);
  });

  it("состояние переживает перезапуск: после рестарта нет второго «первого» сообщения", async () => {
    const first = watcher();
    await first.signinRequired("причина");
    const saved = JSON.parse(await readFile(file, "utf8")) as { broken: boolean };
    expect(saved.broken).toBe(true);

    const restarted = watcher();
    await restarted.load();
    await restarted.signinRequired("причина");
    expect(sent).toHaveLength(1);
    now += REPEAT_EVERY_MS;
    await restarted.tick();
    expect(sent).toHaveLength(2);
    await restarted.accepted();
    expect(sent.at(-1)).toContain("🟢");
  });

  it("битый файл состояния — чистый старт, не падение", async () => {
    await writeFile(file, "{not json");
    const watch = watcher();
    await watch.load();
    expect(watch.status).toEqual(INITIAL_STATUS);
  });

  it("проба упала один раз — тишина, дважды подряд — тревога", async () => {
    const watch = watcher();
    await watch.probeCrashed("контейнер упал");
    expect(sent).toEqual([]);
    await watch.probeCrashed("контейнер упал");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("проба входа не проходит");
  });
});

describe("isProbeDue", () => {
  const ok = { ...INITIAL_STATUS, lastOkAt: MORNING - HOUR, lastProbeAt: MORNING - HOUR };

  it("проб ещё не было — сразу", () => {
    expect(isProbeDue(INITIAL_STATUS, MORNING, 6)).toBe(true);
  });

  it("последний удачный заход старше суток — сразу", () => {
    expect(isProbeDue({ ...ok, lastOkAt: MORNING - 25 * HOUR }, MORNING, 6)).toBe(true);
  });

  it("после сегодняшних 06:00 проба была — ждём завтра; до 06:00 — вчерашняя ещё свежа", () => {
    const nine = Date.UTC(2026, 10, 6, 8, 0); // 09:00 по Белграду
    expect(isProbeDue({ ...ok, lastProbeAt: nine - HOUR }, nine, 6)).toBe(false);
    expect(isProbeDue({ ...ok, lastProbeAt: nine - 5 * HOUR }, nine, 6)).toBe(true); // 04:00
  });

  it("при сломанном входе — раз в час", () => {
    const broken = { ...ok, broken: true, lastProbeAt: MORNING - 30 * 60_000 };
    expect(isProbeDue(broken, MORNING, 6)).toBe(false);
    expect(isProbeDue({ ...broken, lastProbeAt: MORNING - HOUR }, MORNING, 6)).toBe(true);
  });
});
