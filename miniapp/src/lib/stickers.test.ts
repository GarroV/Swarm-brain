import { assert, assertEquals } from "jsr:@std/assert";
import { dueInputToIso, groupRecipients, isHotDue, orderStickers, safeStickerHref, stickerProgress } from "./stickers.ts";
import type { BoardSticker, Person, StickerAddressee } from "../types.ts";

const NOW = new Date("2026-10-11T12:00:00Z");
const ME = 7;

function addr(over: Partial<StickerAddressee>): StickerAddressee {
  return { person_id: "p", name: "N", telegram_id: null, done: false, acked_at: null, task_id: null, task_due: null, ...over };
}
function sticker(id: string, over: Partial<BoardSticker>): BoardSticker {
  return {
    id, kind: "task", title: id, body: "", due_at: null, tone: "yellow", link: null, created_by: 1,
    created_at: "2026-10-01T00:00:00Z", mine: false, addressees: [], ...over,
  };
}
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

Deno.test("порядок: моё несделанное по сроку, потом чужое, моё сделанное — последним", () => {
  const list = [
    sticker("done-mine", { due_at: hours(1), addressees: [addr({ telegram_id: ME, done: true })] }),
    sticker("other", { due_at: hours(2), addressees: [addr({ telegram_id: 99 })] }),
    sticker("mine-late", { due_at: hours(50), addressees: [addr({ telegram_id: ME })] }),
    sticker("mine-soon", { due_at: hours(5), addressees: [addr({ telegram_id: ME })] }),
    sticker("mine-nodue", { addressees: [addr({ telegram_id: ME })] }),
  ];
  assertEquals(orderStickers(list, ME).map((s) => s.id), ["mine-soon", "mine-late", "mine-nodue", "other", "done-mine"]);
});

Deno.test("порядок: при равном сроке новые раньше; вход не меняется", () => {
  const a = sticker("old", { created_at: "2026-10-01T00:00:00Z" });
  const b = sticker("new", { created_at: "2026-10-05T00:00:00Z" });
  const input = [a, b];
  assertEquals(orderStickers(input, ME).map((s) => s.id), ["new", "old"]);
  assertEquals(input.map((s) => s.id), ["old", "new"]);
});

Deno.test("порядок: без личности все стикеры «чужие» и идут по сроку", () => {
  const list = [sticker("b", { due_at: hours(9) }), sticker("a", { due_at: hours(3) })];
  assertEquals(orderStickers(list, null).map((s) => s.id), ["a", "b"]);
});

Deno.test("горит: срок в сутки или прошёл и не сделано; сделанное и без срока — нет", () => {
  assert(isHotDue(hours(23), false, NOW));
  assert(isHotDue(hours(-3), false, NOW));
  assert(!isHotDue(hours(26), false, NOW));
  assert(!isHotDue(hours(-3), true, NOW));
  assert(!isHotDue(null, false, NOW));
  assert(!isHotDue("не дата", false, NOW));
});

Deno.test("прогресс: выполнившие из всех", () => {
  const s = sticker("x", { addressees: [addr({ done: true }), addr({}), addr({ done: true })] });
  assertEquals(stickerProgress(s), { done: 2, total: 3 });
  assertEquals(stickerProgress(sticker("y", {})), { done: 0, total: 0 });
});

Deno.test("ссылка в href: http(s) и путь внутри приложения; остальное — null", () => {
  assertEquals(safeStickerHref("https://example.com/a"), "https://example.com/a");
  assertEquals(safeStickerHref("/tasks"), "/tasks");
  assertEquals(safeStickerHref("javascript:alert(1)"), null);
  assertEquals(safeStickerHref("data:text/html,x"), null);
  assertEquals(safeStickerHref("//evil.example.com"), null);
  assertEquals(safeStickerHref("https://a.com/ b"), null);
  assertEquals(safeStickerHref(null), null);
  assertEquals(safeStickerHref(""), null);
});

Deno.test("срок из поля формы: пусто и мусор — null, дата — ISO", () => {
  assertEquals(dueInputToIso(""), null);
  assertEquals(dueInputToIso("не дата"), null);
  assert(dueInputToIso("2026-10-12T10:00")!.endsWith("Z"));
});

const person = (id: string, name: string, telegram_id: number | null, email: string | null = null): Person => ({ id, name, email, telegram_id });

Deno.test("«Кому»: люди с входом и без входа — в разных группах, порядок сохранён", () => {
  const people = [person("a", "Anna", 1), person("g1", "Guest One", null), person("b", "Boris", 2), person("g2", "a.kislyakova", null)];
  const { users, guests } = groupRecipients(people, "");
  assertEquals(users.map((p) => p.id), ["a", "b"]);
  assertEquals(guests.map((p) => p.id), ["g1", "g2"]);
});

Deno.test("«Кому»: поиск ищет по имени и почте в обеих группах", () => {
  const people = [person("a", "Anna Kis", 1), person("g1", "Guest", null, "kis@x.com"), person("g2", "Other", null, "o@x.com")];
  const { users, guests } = groupRecipients(people, "  KIS ");
  assertEquals(users.map((p) => p.id), ["a"]);
  assertEquals(guests.map((p) => p.id), ["g1"]);
});
