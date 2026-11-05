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
    const verdict = validateExportedState(state("super-secret-cookie", "NID"), null);
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
  describe("выгрузка недоверенная: фильтр доменов и сверка с текущим входом", () => {
    interface Cookie {
      name: string;
      value: string;
      domain: string;
      path: string;
      expires?: number;
    }
    const cookie = (
      name: string,
      value: string,
      domain = ".google.com",
      expires?: number,
    ): Cookie => ({
      name,
      value,
      domain,
      path: "/",
      ...(expires !== undefined && { expires }),
    });
    const file = (cookies: Cookie[], origins: object[] = []): string =>
      JSON.stringify({ cookies, origins });
    const session = (value: string, expires: number, extra: Cookie[] = []): Cookie[] => [
      cookie("SID", value, ".google.com", expires),
      cookie("__Secure-1PSID", value, ".google.com", expires),
      ...extra,
    ];

    async function saved(): Promise<{ cookies: Cookie[]; origins: { origin: string }[] }> {
      return JSON.parse(await readFile(stateFile, "utf8")) as {
        cookies: Cookie[];
        origins: { origin: string }[];
      };
    }

    it("чужие домены и origins не от Google выбрасываются, Google остаётся", async () => {
      await writeFile(stateFile, file(session("old", 100)));
      const raw = file(
        [
          ...session("fresh", 200, [cookie("NID", "n", "accounts.google.com")]),
          cookie("tracker", "evil", ".evil.example"),
          cookie("SID", "fake", ".google.evil.example", 999),
          cookie("yt", "y", ".youtube.com"),
        ],
        [
          { origin: "https://meet.google.com", localStorage: [] },
          { origin: "https://evil.example", localStorage: [{ name: "k", value: "v" }] },
        ],
      );

      const result = await commitExport({ stateFile, raw, outcome: "recorded" });

      expect(result.written).toBe(true);
      const after = await saved();
      const domains = after.cookies.map((c) => c.domain);
      expect(domains.toSorted((a, b) => a.localeCompare(b))).toEqual([
        ".google.com",
        ".google.com",
        ".youtube.com",
        "accounts.google.com",
      ]);
      expect(after.origins.map((o) => o.origin)).toEqual(["https://meet.google.com"]);
    });

    it("сессия есть только на чужом домене — вход не меняется", async () => {
      await writeFile(stateFile, file(session("old", 100)));
      const raw = file([cookie("SID", "fake", ".evil.example", 999)]);

      const result = await commitExport({ stateFile, raw, outcome: "recorded" });

      expect(result).toEqual({ written: false, reason: "в выгрузке нет сессии Google" });
      expect(await readFile(stateFile, "utf8")).toBe(file(session("old", 100)));
    });

    it("в выгрузке пропала сессионная кука текущего входа — отказ без значений", async () => {
      const before = file([...session("old", 100), cookie("HSID", "h", ".google.com", 100)]);
      await writeFile(stateFile, before);

      const result = await commitExport({
        stateFile,
        raw: file(session("someone-else", 200)),
        outcome: "recorded",
      });

      expect(result.written).toBe(false);
      expect(JSON.stringify(result)).toMatch(/неполный или чужой/u);
      expect(JSON.stringify(result)).not.toContain("someone-else");
      expect(await readFile(stateFile, "utf8")).toBe(before);
    });

    it("новая сессионная кука в выгрузке и поддомены Google — принимается", async () => {
      await writeFile(stateFile, file(session("old", 100)));

      const raw = file([
        ...session("new", 200),
        cookie("HSID", "h", ".google.com", 200),
        cookie("NID", "n", "www.google.com", 200),
        cookie("OSID", "o", "myaccount.google.com", 200),
      ]);
      const result = await commitExport({ stateFile, raw, outcome: "recorded" });

      expect(result.written).toBe(true);
      const saved = await readFile(stateFile, "utf8");
      expect(saved).toContain("www.google.com");
      expect(saved).toContain("myaccount.google.com");
    });

    it("тот же набор кук, но другой идентификатор аккаунта — отказ", async () => {
      const before = file(session("old", 100, [cookie("ACCOUNT_CHOOSER", "bot-account")]));
      await writeFile(stateFile, before);

      const otherRaw = file(session("new", 200, [cookie("ACCOUNT_CHOOSER", "other-account")]));
      const swapped = await commitExport({
        stateFile,
        raw: otherRaw,
        outcome: "recorded",
      });
      expect(swapped.written).toBe(false);
      expect(JSON.stringify(swapped)).not.toContain("other-account");
      expect(await readFile(stateFile, "utf8")).toBe(before);

      const sameRaw = file(session("new", 200, [cookie("ACCOUNT_CHOOSER", "bot-account")]));
      const kept = await commitExport({
        stateFile,
        raw: sameRaw,
        outcome: "recorded",
      });
      expect(kept.written).toBe(true);
    });

    it("выгрузка старее текущего входа — отказ; не старее — принимается", async () => {
      const before = file(session("old", 500));
      await writeFile(stateFile, before);

      const older = await commitExport({
        stateFile,
        raw: file(session("replay", 400)),
        outcome: "recorded",
      });
      expect(older).toEqual({ written: false, reason: "выгрузка старее текущего входа" });
      expect(await readFile(stateFile, "utf8")).toBe(before);

      const equal = await commitExport({
        stateFile,
        raw: file(session("same-age", 500)),
        outcome: "recorded",
      });
      expect(equal.written).toBe(true);
    });
  });
});
