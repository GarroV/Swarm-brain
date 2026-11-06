import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileAccountCopies, hasGoogleSession } from "./account.ts";

const SIGN_IN = JSON.stringify({
  cookies: [{ name: "SID", value: "secret-cookie-value", domain: ".google.com", path: "/" }],
  origins: [],
});

describe("FileAccountCopies — вход аккаунта бота в контейнер", () => {
  let root: string;
  let stateFile: string;
  let copiesDirectory: string;
  let copies: FileAccountCopies;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "scriba-account-"));
    stateFile = path.join(root, "account", "google-state.json");
    copiesDirectory = path.join(root, "copies");
    copies = new FileAccountCopies({ stateFile, copiesDirectory });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function saveSignIn(content: string): Promise<void> {
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, content, { mode: 0o600 });
  }

  it("входа нет — копии нет, бот идёт гостем", async () => {
    expect(await copies.prepare("run-1")).toBeNull();
  });

  it("вход есть — у запуска своя копия того же содержимого, только на чтение", async () => {
    await saveSignIn(SIGN_IN);

    const copy = await copies.prepare("run-1");

    expect(copy).toBe(path.join(copiesDirectory, "run-1.json"));
    expect(await readFile(copy ?? "", "utf8")).toBe(SIGN_IN);
    const info = await stat(copy ?? "");
    expect(info.mode & 0o777).toBe(0o444);
  });

  it("два запуска — две разные копии: один контейнер не видит файл другого", async () => {
    await saveSignIn(SIGN_IN);

    const first = await copies.prepare("run-1");
    const second = await copies.prepare("run-2");

    expect(first).not.toBe(second);
    const names = await readdir(copiesDirectory);
    expect(new Set(names)).toEqual(new Set(["run-1.json", "run-2.json"]));
  });

  it("испорченный вход — громкий отказ без содержимого файла в тексте, а не молча гостем", async () => {
    await saveSignIn('{"cookies": [], "note": "secret-cookie-value"}');

    let failure: unknown = null;
    try {
      await copies.prepare("run-1");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/sign the bot in again/u);
    expect(String(failure)).not.toContain("secret-cookie-value");
  });

  it("не JSON — тоже громкий отказ", async () => {
    await saveSignIn("secret-cookie-value");

    await expect(copies.prepare("run-1")).rejects.toThrow(/damaged/u);
  });

  it("вход не читается (не файл) — громкий отказ, а не «входа нет»", async () => {
    await mkdir(stateFile, { recursive: true });

    await expect(copies.prepare("run-1")).rejects.toThrow(/не читается/u);
  });

  it("каталог копий не читается — sweep говорит об этом, а не молчит", async () => {
    await writeFile(copiesDirectory, "not a directory");

    await expect(copies.sweep(new Set())).rejects.toThrow();
  });

  it("имя запуска с разделителем пути отвергается: копия не уходит мимо своего каталога", async () => {
    await saveSignIn(SIGN_IN);

    await expect(copies.prepare("../escape")).rejects.toThrow(/не годится/u);
  });

  it("release убирает копию запуска", async () => {
    await saveSignIn(SIGN_IN);
    await copies.prepare("run-1");

    await copies.release("run-1");

    expect(await readdir(copiesDirectory)).toEqual([]);
  });

  it("sweep убирает копии запусков, которых больше нет, и не трогает живые", async () => {
    await saveSignIn(SIGN_IN);
    await copies.prepare("run-alive");
    await copies.prepare("run-dead");

    await copies.sweep(new Set(["run-alive"]));

    expect(await readdir(copiesDirectory)).toEqual(["run-alive.json"]);
  });

  it("sweep без каталога копий — не ошибка", async () => {
    await expect(copies.sweep(new Set())).resolves.toBeUndefined();
  });
  it("каталог выгрузки: свой у запуска, открыт на запись, читается; нет файла — null; release и sweep убирают", async () => {
    const directory = await copies.prepareOutput("run-1");
    const info = await stat(directory);
    expect(info.mode & 0o777).toBe(0o777);
    expect(await copies.readOutput("run-1")).toBeNull();

    await writeFile(path.join(directory, "google-state.json"), SIGN_IN);
    expect(await copies.readOutput("run-1")).toBe(SIGN_IN);

    await copies.prepareOutput("run-2");
    await copies.sweep(new Set(["run-2"]));
    expect(await readdir(copiesDirectory)).toEqual(["run-2.out"]);

    await copies.release("run-2");
    expect(await readdir(copiesDirectory)).toEqual([]);
  });

  it("выгрузка нечитаема не из-за отсутствия — ошибка наружу", async () => {
    const directory = await copies.prepareOutput("run-3");
    await mkdir(path.join(directory, "google-state.json"));
    await expect(copies.readOutput("run-3")).rejects.toThrow();
  });
});

describe("hasGoogleSession — вошёл ли человек в окне входа", () => {
  it("кука сессии на .google.com — вошёл", () => {
    expect(hasGoogleSession([{ name: "__Secure-1PSID", domain: ".google.com" }])).toBe(true);
  });

  it("только служебные куки (NID, согласие) — не вошёл, сохранять нечего", () => {
    const cookies = [
      { name: "NID", domain: ".google.com" },
      { name: "SOCS", domain: ".google.com" },
    ];
    expect(hasGoogleSession(cookies)).toBe(false);
  });

  it("кука с именем сессии, но чужого домена — не вход в Google", () => {
    expect(hasGoogleSession([{ name: "SID", domain: ".notgoogle.com" }])).toBe(false);
    expect(hasGoogleSession([{ name: "SID", domain: "evil-google.com" }])).toBe(false);
  });

  it("пусто — не вошёл", () => {
    expect(hasGoogleSession([])).toBe(false);
  });
});
