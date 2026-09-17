import { describe, expect, it } from "vitest";

import { MUTE_AUDIO_ARG, chromiumLaunchOptions } from "./browser.ts";

describe("chromiumLaunchOptions", () => {
  const options = chromiumLaunchOptions();

  it("--mute-audio из аргументов Playwright по умолчанию снят — иначе запись будет тишиной", () => {
    expect(options.ignoreDefaultArgs).toContain(MUTE_AUDIO_ARG);
  });

  it("сам --mute-audio в аргументы не попадает", () => {
    expect(options.args).not.toContain(MUTE_AUDIO_ARG);
  });

  it("режим headed: headless чаще ломает звук и чаще палится детектом", () => {
    expect(options.headless).toBe(false);
  });

  it("автовоспроизведение без жеста пользователя разрешено — жать в звонке некому", () => {
    expect(options.args).toContain("--autoplay-policy=no-user-gesture-required");
  });

  it("локаль запиннена, чтобы вёрстка не менялась под язык", () => {
    expect(options.args).toContain("--lang=en-US");
    expect(chromiumLaunchOptions({ lang: "ru-RU" }).args).toContain("--lang=ru-RU");
  });

  it("проверка сертификатов не отключается — это приманка для детекта ботов", () => {
    expect(options.args.some((a) => a.includes("ignore-certificate-errors"))).toBe(false);
  });

  it("дополнительные аргументы добавляются", () => {
    expect(chromiumLaunchOptions({ extraArgs: ["--window-size=800,600"] }).args).toContain(
      "--window-size=800,600",
    );
  });

  it("попытка передать --mute-audio снаружи — громкий отказ, а не тихая тишина в записи", () => {
    expect(() => chromiumLaunchOptions({ extraArgs: [MUTE_AUDIO_ARG] })).toThrow(/mute-audio/);
  });
});
