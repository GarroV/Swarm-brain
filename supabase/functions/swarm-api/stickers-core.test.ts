// Ядро стикеров: разбор входа, правило видимости, прогресс. Ошибка в любом из них молчит.
import { assert, assertEquals } from "@std/assert";
import {
  ADDRESSEES_MAX,
  dueDateOf,
  isAddresseeDone,
  isSafeLink,
  isStickerVisible,
  parseStickerInput,
  progressOf,
  taskDescription,
} from "./stickers-core.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-11T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

Deno.test("ссылка: http(s) и путь внутри приложения проходят, остальное — нет", () => {
  assert(isSafeLink("https://example.com/a?b=1"));
  assert(isSafeLink("http://example.com"));
  assert(isSafeLink("/tasks"));
  assert(!isSafeLink("javascript:alert(1)"));
  assert(!isSafeLink("data:text/html,x"));
  assert(!isSafeLink("//evil.example.com"));
  // Браузер читает обратный слеш как прямой: `/\\host` уходит на чужой сайт.
  assert(!isSafeLink("/\\evil.example.com"));
  assert(!isSafeLink("/tasks\\x"));
  assert(!isSafeLink("https://a.com\\@evil.example.com"));
  assert(!isSafeLink("https://a.com/ b"));
  assert(!isSafeLink("ftp://a.com"));
  assert(!isSafeLink(""));
  assert(!isSafeLink("/" + "a".repeat(600)));
});

Deno.test("разбор: минимальное тело, значения по умолчанию", () => {
  const r = parseStickerInput({ kind: "notice", title: "  Привет ", person_ids: [ID] });
  assertEquals(r, {
    ok: true,
    value: {
      kind: "notice",
      title: "Привет",
      body: "",
      due_at: null,
      tone: "yellow",
      link: null,
      person_ids: [ID],
      all: false,
    },
  });
});

Deno.test("разбор: all=true не требует person_ids; срок нормализуется в ISO", () => {
  const r = parseStickerInput({ kind: "task", title: "T", all: true, due_at: "2026-10-12T10:00:00+02:00" });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.person_ids, null);
    assertEquals(r.value.due_at, "2026-10-12T08:00:00.000Z");
  }
});

Deno.test("разбор: плохие входы отбиваются понятной причиной", () => {
  const bad = (b: unknown) => {
    const r = parseStickerInput(b);
    assert(!r.ok);
    return r.ok ? "" : r.error;
  };
  assert(bad({ kind: "x", title: "T", all: true }).includes("Тип"));
  assert(bad({ kind: "task", title: "  ", all: true }).includes("Заголовок"));
  assert(bad({ kind: "task", title: "a".repeat(121), all: true }).includes("Заголовок"));
  assert(bad({ kind: "task", title: "T", body: "a".repeat(2001), all: true }).includes("Текст"));
  assert(bad({ kind: "task", title: "T", all: true, due_at: "не дата" }).includes("Срок"));
  assert(bad({ kind: "task", title: "T", all: true, tone: "red" }).includes("Цвет"));
  assert(bad({ kind: "task", title: "T", all: true, link: "javascript:alert(1)" }).includes("Ссылка"));
  assert(bad({ kind: "task", title: "T" }).includes("адресатов"));
  assert(bad({ kind: "task", title: "T", person_ids: [] }).includes("адресатов"));
  assert(bad({ kind: "task", title: "T", person_ids: ["не-uuid"] }).includes("адресатов"));
  const many = Array.from(
    { length: ADDRESSEES_MAX + 1 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  assert(bad({ kind: "task", title: "T", person_ids: many }).includes("не больше"));
  assert(!parseStickerInput(null).ok);
});

Deno.test("разбор: повторы адресатов схлопываются", () => {
  const r = parseStickerInput({ kind: "task", title: "T", person_ids: [ID, ID] });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.person_ids, [ID]);
});

Deno.test("выполнение: задание — по статусу задачи, объявление — по «Понятно»", () => {
  assert(isAddresseeDone("task", { acked_at: null, task_status: "done" }));
  assert(!isAddresseeDone("task", { acked_at: "2026-10-11T00:00:00Z", task_status: "open" }));
  assert(!isAddresseeDone("task", { acked_at: null, task_status: null }));
  assert(isAddresseeDone("notice", { acked_at: "2026-10-11T00:00:00Z", task_status: null }));
  assert(!isAddresseeDone("notice", { acked_at: null, task_status: "done" }));
});

Deno.test("прогресс считает выполнивших из всех", () => {
  assertEquals(progressOf([true, false, true]), { done: 2, total: 3 });
  assertEquals(progressOf([]), { done: 0, total: 0 });
});

Deno.test("видимость: без срока виден; срок впереди виден; прошёл и все готовы — скрыт", () => {
  assert(isStickerVisible(null, [true, true], NOW));
  assert(isStickerVisible(hours(5), [true, true], NOW));
  assert(isStickerVisible(hours(-5), [true, false], NOW));
  assert(!isStickerVisible(hours(-5), [true, true], NOW));
});

Deno.test("видимость: старше недели скрыт, даже если не закрыт; пустой список адресатов не «все готовы»", () => {
  assert(!isStickerVisible(hours(-24 * 8), [false], NOW));
  assert(isStickerVisible(hours(-24 * 6), [false], NOW));
  assert(isStickerVisible(hours(-5), [], NOW));
});

Deno.test("срок задачи — дата по времени команды; описание собирается из текста, пометки и ссылки", () => {
  assertEquals(dueDateOf("2026-10-11T23:30:00Z"), "2026-10-12");
  assertEquals(dueDateOf(null), undefined);
  assertEquals(taskDescription("Текст", "https://a.com"), "Текст\n\nСтикер на главной\n\nhttps://a.com");
  assertEquals(taskDescription("", null), "Стикер на главной");
});
