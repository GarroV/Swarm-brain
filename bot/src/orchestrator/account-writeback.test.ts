import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commitExport, validateExportedState } from "./account-writeback.ts";

const state = (value: string, name = "SID", domain = ".google.com"): string =>
  JSON.stringify({ cookies: [{ name, value, domain, path: "/" }], origins: [] });

describe("продление входа: защита замены", () => {
  let directory: string;
  let stateFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "scriba-writeback-"));
    stateFile = path.join(directory, "google-state.json");
    await writeFile(stateFile, state("old"), { mode: 0o644 });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("годная выгрузка заменяет вход атомарно: права 0600, прежний — google-state.prev.json", async () => {
    const result = await commitExport({ stateFile, raw: state("fresh"), outcome: "recorded" });

    expect(result).toEqual({ written: true, cookies: 1 });
    expect(await readFile(stateFile, "utf8")).toBe(state("fresh"));
    expect(await readFile(path.join(directory, "google-state.prev.json"), "utf8")).toBe(
      state("old"),
    );
    const info = await stat(stateFile);
    expect(info.mode & 0o777).toBe(0o600);
    const names = await readdir(directory);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "google-state.json",
      "google-state.prev.json",
    ]);
  });

  it("входа раньше не было — просто создаётся", async () => {
    await rm(stateFile);
    const result = await commitExport({ stateFile, raw: state("fresh"), outcome: "recorded" });
    expect(result.written).toBe(true);
    expect(await readdir(directory)).toEqual(["google-state.json"]);
  });

  it.each([
    ["signin_required", state("bad"), "account_signin_required", /слетевший вход/u],
    ["битый JSON", "{oops", "recorded", /JSON/u],
    ["пустой список кук", JSON.stringify({ cookies: [] }), "recorded", /сессии Google/u],
    ["нет сессии Google", state("x", "NID"), "recorded", /сессии Google/u],
    ["сессия чужого домена", state("x", "SID", ".example.com"), "recorded", /сессии Google/u],
    ["нет файла выгрузки", null, "recorded", /ничего не выгрузил/u],
  ])("%s — вход не трогается", async (_name, raw, outcome, reason) => {
    const result = await commitExport({ stateFile, raw, outcome });

    expect(result.written).toBe(false);
    expect(result.written ? "" : result.reason).toMatch(reason);
    expect(await readFile(stateFile, "utf8")).toBe(state("old"));
    expect(await readdir(directory)).toEqual(["google-state.json"]);
  });

  it("причина отказа не содержит значений кук", () => {
    const verdict = validateExportedState(state("super-secret-cookie", "NID"));
    expect(JSON.stringify(verdict)).not.toContain("super-secret-cookie");
  });

  it("каталог не записывается — ошибка наружу, вход цел, временного файла не остаётся", async () => {
    await chmod(directory, 0o500);
    try {
      await expect(
        commitExport({ stateFile, raw: state("fresh"), outcome: "recorded" }),
      ).rejects.toThrow();
    } finally {
      await chmod(directory, 0o700);
    }
    expect(await readFile(stateFile, "utf8")).toBe(state("old"));
    expect(await readdir(directory)).toEqual(["google-state.json"]);
  });
});
