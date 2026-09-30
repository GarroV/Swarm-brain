import { assertEquals } from "@std/assert";
import { fileKind, formatSize, splitPicked, type TaskFileLimits } from "./taskFiles.ts";

const MB = 1024 * 1024;
const limits: TaskFileLimits = { maxBytes: 50 * MB, maxFiles: 3, accept: ["pdf", "png", "docx"] };

Deno.test("taskFiles: размер для людей", () => {
  assertEquals(formatSize(512), "512 Б");
  assertEquals(formatSize(640 * 1024), "640 КБ");
  assertEquals(formatSize(2.4 * MB), "2,4 МБ");
  assertEquals(formatSize(50 * MB, true), "50 MB");
});

Deno.test("taskFiles: вид файла по расширению, регистр не важен", () => {
  assertEquals(["a.PDF", "b.jpeg", "c.xlsx", "d.pptx", "e.docx", "f.zip", "g"].map(fileKind), [
    "pdf", "image", "sheet", "slides", "doc", "archive", "other",
  ]);
});

Deno.test("taskFiles: отказ сразу — чужой тип, пустой, больше лимита, сверх числа файлов", () => {
  const picked = [
    { name: "ok.pdf", size: 10 },
    { name: "call.mp4", size: 10 },
    { name: "empty.png", size: 0 },
    { name: "big.pdf", size: 50 * MB + 1 },
    { name: "edge.pdf", size: 50 * MB },
    { name: "extra.docx", size: 10 },
  ];
  const r = splitPicked(picked, limits, 1);
  assertEquals(r.ok.map((f) => f.name), ["ok.pdf", "edge.pdf"]);
  assertEquals(r.rejected.map((x) => [x.file.name, x.reason]), [
    ["call.mp4", "type"],
    ["empty.png", "empty"],
    ["big.pdf", "too_big"],
    ["extra.docx", "too_many"],
  ]);
});
