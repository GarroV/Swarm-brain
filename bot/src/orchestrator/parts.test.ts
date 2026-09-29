import { describe, expect, it } from "vitest";

import { PartStager, type SegmentEntry, parseSegmentList } from "./parts.ts";

describe("parseSegmentList", () => {
  it("закрытые части с началом каждой", () => {
    expect(parseSegmentList("part-000.m4a,0.000000,3.0\npart-001.m4a,3.000000,6.0\n")).toEqual([
      { file: "part-000.m4a", start: 0 },
      { file: "part-001.m4a", start: 3 },
    ]);
  });

  it("недописанная последняя строка ждёт следующего раза", () => {
    expect(parseSegmentList("part-000.m4a,0.0,3.0\npart-001.m4a,3.0")).toEqual([
      { file: "part-000.m4a", start: 0 },
    ]);
  });

  it.each([
    ["путь в имени", "../etc/passwd,0,1\n"],
    ["обратный слэш", "..\\x.m4a,0,1\n"],
    ["нет начала", "part-000.m4a\n"],
    ["начало не число", "part-000.m4a,abc,1\n"],
    ["отрицательное начало", "part-000.m4a,-1,1\n"],
    ["пустая строка", "\n"],
  ])("%s — строка пропускается", (_what, text) => {
    expect(parseSegmentList(text)).toEqual([]);
  });
});

function stagerOver(
  lists: (string | null)[],
  failOn?: string,
): { stager: PartStager; staged: SegmentEntry[] } {
  const staged: SegmentEntry[] = [];
  let call = 0;
  const stager = new PartStager({
    readList: () => {
      const text = lists[Math.min(call, lists.length - 1)] ?? null;
      call += 1;
      return Promise.resolve(text);
    },
    stage: (entry) => {
      if (entry.file === failOn) return Promise.reject(new Error("disk full"));
      staged.push(entry);
      return Promise.resolve();
    },
  });
  return { stager, staged };
}

describe("PartStager", () => {
  it("каждая часть уходит в очередь ровно один раз, сколько бы раз ни звали", async () => {
    const { stager, staged } = stagerOver([
      null,
      "a.m4a,0,3\n",
      "a.m4a,0,3\nb.m4a,3,6\n",
      "a.m4a,0,3\nb.m4a,3,6\n",
    ]);

    await stager.flush();
    await stager.flush();
    await stager.flush();
    await stager.flush();

    expect(staged.map((entry) => entry.file)).toEqual(["a.m4a", "b.m4a"]);
    expect(stager.count).toBe(2);
  });

  it("параллельные вызовы не отдают часть дважды", async () => {
    const { stager, staged } = stagerOver(["a.m4a,0,3\n"]);

    await Promise.all([stager.flush(), stager.flush(), stager.flush()]);

    expect(staged).toHaveLength(1);
  });

  it("сбой отдачи не теряет часть: она уйдёт следующим прогоном", async () => {
    let shouldFail = true;
    const staged: string[] = [];
    const stager = new PartStager({
      readList: () => Promise.resolve("a.m4a,0,3\n"),
      stage: (entry) => {
        if (shouldFail) return Promise.reject(new Error("disk full"));
        staged.push(entry.file);
        return Promise.resolve();
      },
    });

    await expect(stager.flush()).rejects.toThrow(/disk full/u);
    shouldFail = false;
    await stager.flush();

    expect(staged).toEqual(["a.m4a"]);
  });

  it("после сбоя цепочка не заклинена", async () => {
    const { stager, staged } = stagerOver(["a.m4a,0,3\nb.m4a,3,6\n"], "b.m4a");

    await expect(stager.flush()).rejects.toThrow();
    await expect(stager.flush()).rejects.toThrow();

    expect(staged.map((entry) => entry.file)).toEqual(["a.m4a"]);
  });
});
