import { assertEquals } from "@std/assert";
import {
  canRemoveTaskFile,
  checkNewFile,
  cleanFileName,
  contentDisposition,
  isInline,
  MAX_PENDING_PER_DAY,
  pendingQuotaExceeded,
  taskFileLimits,
  UPLOAD_TTL_SEC,
  uploadSlotsSince,
} from "./task-files.ts";

const MB = 1024 * 1024;
const limits = taskFileLimits(() => undefined);

Deno.test("task-files: лимиты по умолчанию — 50 МБ и 10 файлов", () => {
  assertEquals([limits.maxBytes, limits.maxFiles], [50 * MB, 10]);
});

Deno.test("task-files: лимиты настраиваются переменными, мусор игнорируется", () => {
  const env = { TASK_FILES_MAX_MB: "25", TASK_FILES_MAX_COUNT: "3" } as Record<
    string,
    string
  >;
  assertEquals(taskFileLimits((n) => env[n]).maxBytes, 25 * MB);
  assertEquals(taskFileLimits((n) => env[n]).maxFiles, 3);
  for (const junk of ["0", "-5", "abc", "1.5", ""]) {
    assertEquals(taskFileLimits(() => junk).maxBytes, 50 * MB, junk);
  }
});

Deno.test("task-files: принимаем PDF ровно на лимите, тип выводим сами", () => {
  assertEquals(
    checkNewFile(
      { name: "Договор.PDF", size: 50 * MB, mime: "text/html" },
      limits,
      0,
    ),
    {
      name: "Договор.PDF",
      size: 50 * MB,
      mime: "application/pdf",
    },
  );
});

Deno.test("task-files: отказы — больше лимита, видео, пустой, без имени, лишний файл", () => {
  assertEquals(checkNewFile({ name: "a.pdf", size: 50 * MB + 1 }, limits, 0), {
    error: "too_big",
  });
  assertEquals(checkNewFile({ name: "call.mp4", size: 10 }, limits, 0), {
    error: "type",
  });
  assertEquals(checkNewFile({ name: "page.html", size: 10 }, limits, 0), {
    error: "type",
  });
  assertEquals(checkNewFile({ name: "a.pdf", size: 0 }, limits, 0), {
    error: "empty",
  });
  assertEquals(checkNewFile({ name: "a.pdf", size: "5" }, limits, 0), {
    error: "empty",
  });
  assertEquals(checkNewFile({ name: "  ", size: 5 }, limits, 0), {
    error: "name",
  });
  assertEquals(checkNewFile(null, limits, 0), { error: "name" });
  assertEquals(checkNewFile({ name: "a.pdf", size: 5 }, limits, 10), {
    error: "too_many",
  });
});

Deno.test("task-files: имя чистится от путей, кавычек и управляющих символов", () => {
  assertEquals(
    cleanFileName('C:\\Users\\x\\отчёт "финал"\n.pdf'),
    "отчёт финал.pdf",
  );
  assertEquals(cleanFileName("../../etc/passwd.txt"), "passwd.txt");
  const long = cleanFileName("я".repeat(300) + ".docx");
  assertEquals([long.length, long.endsWith(".docx")], [200, true]);
});

Deno.test("task-files: в браузере открываются PDF и картинки, SVG/HTML/офис — только скачиванием", () => {
  assertEquals(["a.pdf", "b.PNG", "c.svg", "d.html", "e.docx"].map(isInline), [
    true,
    true,
    false,
    false,
    false,
  ]);
});

Deno.test("task-files: Content-Disposition несёт UTF-8 имя и ASCII-запас", () => {
  assertEquals(
    contentDisposition("План Q4.pdf", true),
    `inline; filename="____ Q4.pdf"; filename*=UTF-8''%D0%9F%D0%BB%D0%B0%D0%BD%20Q4.pdf`,
  );
});

Deno.test("task-files: убрать файл — прикрепивший, владелец задачи, админ; остальным нет", () => {
  const f = { uploadedBy: 1, taskOwnerId: 2 };
  assertEquals([1, 2, 3].map((id) => canRemoveTaskFile(f, id, false)), [
    true,
    true,
    false,
  ]);
  assertEquals(canRemoveTaskFile(f, 3, true), true);
  assertEquals(
    canRemoveTaskFile({ uploadedBy: 1, taskOwnerId: null }, 3, false),
    false,
  );
});

Deno.test("task-files: незавершённая загрузка со свежей ссылкой занимает место в лимите файлов", () => {
  // 9 готовых + 1 загрузка, чья ссылка ещё жива, = 10: одиннадцатый не заводится (иначе цикл
  // POST без PUT-подтверждения кладёт на диск сколько угодно объектов по 50 МБ).
  assertEquals(checkNewFile({ name: "a.pdf", size: 5 }, limits, 9 + 1), { error: "too_many" });
  const now = Date.parse("2026-09-30T12:00:00Z");
  assertEquals(uploadSlotsSince(now), new Date(now - UPLOAD_TTL_SEC * 1000).toISOString());
});

Deno.test("task-files: у человека не больше MAX_PENDING_PER_DAY незавершённых загрузок за сутки", () => {
  assertEquals(pendingQuotaExceeded(MAX_PENDING_PER_DAY - 1), false);
  assertEquals(pendingQuotaExceeded(MAX_PENDING_PER_DAY), true);
  assertEquals(pendingQuotaExceeded(0), false);
});
