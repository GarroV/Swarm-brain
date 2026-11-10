// Флаг «экрана А»: включён только владельцу (по telegram_id) и по ?home=a; ?home=old выключает.
// Раннер: deno test -A --no-check src/lib/ (bare specifier из deno.json).
import { assertEquals } from "@std/assert";
import { HOME_A_OWNER_ID, isHomeAEnabled } from "./homeFlag.ts";

const owner = { telegram_id: HOME_A_OWNER_ID };
const other = { telegram_id: 1 };

Deno.test("home A: включён владельцу и только ему", () => {
  assertEquals(isHomeAEnabled(owner), true);
  assertEquals(isHomeAEnabled(other), false);
  assertEquals(isHomeAEnabled(null), false);
  assertEquals(isHomeAEnabled(undefined), false);
});

Deno.test("home A: демо-аккаунт с id владельца флага не получает", () => {
  assertEquals(isHomeAEnabled({ ...owner, is_demo: true }), false);
});

Deno.test("home A: ?home=a включает любому, ?home=old выключает владельцу", () => {
  assertEquals(isHomeAEnabled(other, "?home=a"), true);
  assertEquals(isHomeAEnabled(null, "?home=a"), true);
  assertEquals(isHomeAEnabled(owner, "?home=old"), false);
  assertEquals(isHomeAEnabled(other, "?x=1&home=a"), true);
  assertEquals(isHomeAEnabled(other, "?home=other"), false);
});
