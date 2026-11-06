import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compare, scan } from "./check-ui-language.mjs";

test("Cyrillic JSX text, child expressions and three visible attributes are checked", () => {
  const source =
    '<button title="Подсказка" aria-label={"Кнопка"} placeholder={`Найти ${n} строк`}>Привет {ok ? "Да" : "Нет"}</button>';
  assert.deepEqual(scan(source).map(({ context, text }) => [context, text]), [
    ["title", "Подсказка"],
    ["aria-label", "Кнопка"],
    ["placeholder", "Найти"],
    ["placeholder", "строк"],
    ["jsx-text", "Привет"],
    ["children", "Да"],
    ["children", "Нет"],
  ]);
});

test("comments, internal attributes and dt/tx pairs do not produce UI violations", () => {
  assert.deepEqual(
    scan(`
    // Русский комментарий
    const internal = "Внутреннее значение";
    const element = <button data-id="идентификатор" className={"класс"}
      onClick={() => log("диагностика")} title={dt("Подсказка", "Hint")}
      aria-label={tx("Кнопка", "Button")}>
      {/* Комментарий в JSX */}{dt("Русский", "English")}
      {tx(<b>Перевод</b>, <b>Translation</b>)} English
    </button>;
  `),
    [],
  );
});

test("escaped literals and multiline JSX are resolved by the parser; broken TSX fails", () => {
  assert.equal(
    scan('<div title={"\\u0420усский"}>Первая\n строка</div>')[0].text,
    "Русский",
  );
  assert.equal(scan("<div>Первая\n строка</div>")[0].text, "Первая строка");
  assert.throws(() => scan("<button title=>"), /fixture.tsx/);
});

test("baseline permits only the exact file, surface, text and occurrence count", () => {
  const finding = scan('<b title="Старое">Старое</b>', "old.tsx");
  const baseline = finding.map(({ file, context, text }) => ({
    file,
    context,
    text,
    count: 1,
    reason: "existing fixture",
  }));
  assert.deepEqual(compare(finding, baseline), { unexpected: [], stale: [] });
  assert.equal(
    compare([...finding, finding[0]], baseline).unexpected.length,
    1,
  );
  assert.equal(
    compare(scan('<b title="Старое">Старое</b>', "new.tsx"), baseline)
      .unexpected.length,
    2,
  );
  assert.equal(compare([], baseline).stale.length, 2);
  assert.throws(
    () => compare(finding, [{ ...baseline[0], reason: "" }]),
    /Invalid/,
  );
});

test("CLI mutation: a new raw label is RED, the same dt pair is GREEN", () => {
  // A unique, temporary component in this worktree only. Always removed, including failures.
  const fixture = new URL(
    `../miniapp/src/components/UiLanguageGuardFixture${process.pid}.tsx`,
    import.meta.url,
  );
  const command = fileURLToPath(
    new URL("./check-ui-language.mjs", import.meta.url),
  );
  const run = () =>
    spawnSync(process.execPath, [command], { encoding: "utf8" });
  try {
    fs.writeFileSync(
      fixture,
      'export const Fixture = () => <span title="Новая подсказка">Новый текст</span>;\n',
      { flag: "wx" },
    );
    const red = run();
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stderr, /Новая подсказка/);
    assert.match(red.stderr, /Новый текст/);
    fs.writeFileSync(
      fixture,
      'export const Fixture = () => <span title={dt("Новая подсказка", "New hint")}>{dt("Новый текст", "New text")}</span>;\n',
    );
    const green = run();
    assert.equal(green.status, 0, green.stdout + green.stderr);
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});
