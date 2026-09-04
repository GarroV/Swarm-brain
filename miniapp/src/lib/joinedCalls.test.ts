// Локальная память «я нажал Подключиться» (решение владельца 04.09.2026 — ON AIR в панели
// встреч). Нужна, чтобы строка переключалась МГНОВЕННО: серверный флаг придёт только со
// следующим heartbeat рекордера, а человек уже нажал и ушёл в звонок.
import { assertEquals } from "jsr:@std/assert";
import { markJoined, hasJoined, type JoinStore } from "./joinedCalls.ts";

const NOW = new Date("2026-09-04T10:30:00Z");
const ENDS = "2026-09-04T11:30:00Z";

function memStore(): JoinStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

Deno.test("нажатие помнится, пока слот не кончился", () => {
  const store = memStore();
  markJoined("m1", ENDS, store);
  assertEquals(hasJoined("m1", ENDS, NOW, store), true);
});

Deno.test("после конца слота память гаснет", () => {
  const store = memStore();
  markJoined("m1", ENDS, store);
  const later = new Date("2026-09-04T11:31:00Z");
  assertEquals(hasJoined("m1", ENDS, later, store), false);
});

Deno.test("нажатие на одной встрече не помечает другую", () => {
  const store = memStore();
  markJoined("m1", ENDS, store);
  assertEquals(hasJoined("m2", ENDS, NOW, store), false);
});

Deno.test("протухшая запись убирается из хранилища, а не копится", () => {
  const store = memStore();
  markJoined("m1", ENDS, store);
  hasJoined("m1", ENDS, new Date("2026-09-04T12:00:00Z"), store);
  assertEquals(store.getItem("swarm.joined.m1"), null);
});

Deno.test("недоступное хранилище не роняет панель", () => {
  // Приватное окно, отключённые site data, скриншотилка — обращение к storage бросает
  // исключение. Панель обязана отрисоваться, просто без локальной памяти.
  const broken: JoinStore = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("SecurityError"); },
    removeItem: () => { throw new Error("SecurityError"); },
  };
  markJoined("m1", ENDS, broken);
  assertEquals(hasJoined("m1", ENDS, NOW, broken), false);
});
