import { describe, expect, it } from "vitest";

import {
  inspectAudioEnvironment,
  monitorSourceName,
  parseDefaultSink,
  parsePactlShort,
} from "./audio.ts";

const SINKS = [
  "0\tscriba\tmodule-null-sink.c\ts16le 2ch 48000Hz\tRUNNING",
  "1\tauto_null\tmodule-null-sink.c\ts16le 2ch 44100Hz\tSUSPENDED",
].join("\n");

const SOURCES = [
  "0\tscriba.monitor\tmodule-null-sink.c\ts16le 2ch 48000Hz\tIDLE",
  "1\tauto_null.monitor\tmodule-null-sink.c\ts16le 2ch 44100Hz\tSUSPENDED",
].join("\n");

const INFO = [
  "Server String: /run/user/1001/pulse/native",
  "Library Protocol Version: 35",
  "Default Sink: scriba",
  "Default Source: scriba.monitor",
].join("\n");

const healthy = {
  sinkName: "scriba",
  sinksShort: SINKS,
  sourcesShort: SOURCES,
  info: INFO,
  runtimeDirectory: "/run/user/1001",
};

describe("parsePactlShort", () => {
  it("разбирает табличный вывод pactl list short", () => {
    expect(parsePactlShort(SINKS)).toEqual([
      {
        index: 0,
        name: "scriba",
        module: "module-null-sink.c",
        spec: "s16le 2ch 48000Hz",
        state: "RUNNING",
      },
      {
        index: 1,
        name: "auto_null",
        module: "module-null-sink.c",
        spec: "s16le 2ch 44100Hz",
        state: "SUSPENDED",
      },
    ]);
  });

  it("не падает на пустом выводе и на мусорных строках", () => {
    expect(parsePactlShort("")).toEqual([]);
    expect(parsePactlShort("\n  \nне табличная строка\n")).toEqual([]);
  });
});

describe("parseDefaultSink", () => {
  it("достаёт sink по умолчанию из pactl info", () => {
    expect(parseDefaultSink(INFO)).toBe("scriba");
  });

  it("возвращает null, когда строки Default Sink нет", () => {
    expect(parseDefaultSink("Server String: /tmp/x")).toBeNull();
  });
});

describe("monitorSourceName", () => {
  it("имя monitor-source выводится из имени sink", () => {
    expect(monitorSourceName("scriba")).toBe("scriba.monitor");
  });
});

describe("inspectAudioEnvironment", () => {
  it("исправное окружение — ok и имя monitor-source", () => {
    const report = inspectAudioEnvironment(healthy);

    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.monitorSource).toBe("scriba.monitor");
  });

  it("нет null-sink — отказ с названием sink", () => {
    const report = inspectAudioEnvironment({ ...healthy, sinksShort: "" });

    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toContain("scriba");
    expect(report.problems.some((p) => p.includes("null-sink"))).toBe(true);
  });

  it("sink по умолчанию чужой — отказ, потому что Chromium заиграет мимо записи", () => {
    const report = inspectAudioEnvironment({
      ...healthy,
      info: INFO.replace("Default Sink: scriba", "Default Sink: auto_null"),
    });

    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes("auto_null"))).toBe(true);
  });

  it("нет monitor-source — отказ, писать нечего", () => {
    const report = inspectAudioEnvironment({ ...healthy, sourcesShort: "" });

    expect(report.ok).toBe(false);
    expect(report.monitorSource).toBeNull();
    expect(report.problems.some((p) => p.includes("monitor"))).toBe(true);
  });

  it("не выставлен XDG_RUNTIME_DIR — отказ отдельным пунктом", () => {
    const report = inspectAudioEnvironment({ ...healthy, runtimeDirectory: undefined });

    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes("XDG_RUNTIME_DIR"))).toBe(true);
  });

  it("собирает все беды сразу, а не только первую", () => {
    const report = inspectAudioEnvironment({
      sinkName: "scriba",
      sinksShort: "",
      sourcesShort: "",
      info: "",
      runtimeDirectory: undefined,
    });

    expect(report.problems.length).toBeGreaterThanOrEqual(4);
  });
});
