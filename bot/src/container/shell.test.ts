import { describe, expect, it } from "vitest";

import { run, runOrThrow } from "./shell.ts";

describe("run", () => {
  it("отдаёт stdout и нулевой код", async () => {
    const result = await run("printf", ["%s", "привет"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("привет");
    expect(result.stderr).toBe("");
  });

  it("ненулевой код — не ошибка: stderr нужен именно тогда, когда команда упала", async () => {
    const result = await run("sh", ["-c", "echo сломалось >&2; exit 3"]);

    expect(result.code).toBe(3);
    expect(result.stderr.trim()).toBe("сломалось");
  });

  it("несуществующая команда — отказ, а не пустой результат", async () => {
    await expect(run("такой-команды-нет-и-не-было", [])).rejects.toThrow();
  });
});

describe("runOrThrow", () => {
  it("успешная команда проходит насквозь", async () => {
    await expect(runOrThrow("printf", ["%s", "ок"])).resolves.toMatchObject({ stdout: "ок" });
  });

  it("упавшая команда даёт ошибку с командой и её выводом", async () => {
    await expect(runOrThrow("sh", ["-c", "echo нет >&2; exit 1"])).rejects.toThrow(/нет/);
  });
});
