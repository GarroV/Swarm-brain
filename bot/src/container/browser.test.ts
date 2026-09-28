import { describe, expect, it } from "vitest";

import { MUTE_AUDIO_ARG, NO_SANDBOX_ARG, chromiumLaunchOptions } from "./browser.ts";

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

  it("песочница Chromium включена: без явного флага Playwright сам добавил бы --no-sandbox", () => {
    expect(options.chromiumSandbox).toBe(true);
    expect(options.args).not.toContain(NO_SANDBOX_ARG);
  });

  it("выключить песочницу снаружи нельзя — громкий отказ", () => {
    expect(() => chromiumLaunchOptions({ extraArgs: [NO_SANDBOX_ARG] })).toThrow(/no-sandbox/);
  });

  it("с прокси стенда весь выход браузера идёт через него, включая медиа звонка", () => {
    const proxied = chromiumLaunchOptions({
      environment: { SCRIBA_EGRESS_PROXY: `${["ht", "tp:"].join("")}//egress:3128` },
    });
    expect(proxied.args).toContain(`--proxy-server=${["ht", "tp:"].join("")}//egress:3128`);
    expect(proxied.args).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
  });

  it("без прокси стенда (смоук записи) браузер идёт напрямую", () => {
    const direct = chromiumLaunchOptions({ environment: { SCRIBA_EGRESS_PROXY: "" } });
    expect(direct.args.some((argument) => argument.startsWith("--proxy-server"))).toBe(false);
    expect(direct.args.some((argument) => argument.startsWith("--force-webrtc"))).toBe(false);
  });

  it("задать или снять прокси аргументом снаружи нельзя — громкий отказ", () => {
    for (const argument of [
      "--proxy-server=evil:1",
      "--no-proxy-server",
      "--proxy-bypass-list=*",
    ]) {
      expect(() => chromiumLaunchOptions({ extraArgs: [argument] }), argument).toThrow(
        /SCRIBA_EGRESS_PROXY/u,
      );
    }
  });
});
