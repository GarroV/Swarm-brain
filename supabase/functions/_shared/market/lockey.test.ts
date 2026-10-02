import { assertEquals, assertNotEquals } from "@std/assert";
import { locKey } from "./db.ts";

Deno.test("locKey: same coordinates, different addresses are different points (Mlinar geocoded by street)", () => {
  assertNotEquals(
    locKey("mlinar", 45.5595, 18.695, "Kamila Firingera 12"),
    locKey("mlinar", 45.5595, 18.695, "Europska avenija 1"),
  );
});

Deno.test("locKey ignores case, punctuation and diacritics in the address", () => {
  assertEquals(locKey("kfc", 45.8, 15.9, "Ilica 1, Zagreb"), locKey("kfc", 45.8, 15.9, "ILICA 1 zagreb"));
  assertEquals(locKey("kfc", 45.8, 15.9, "Čakovečka 5"), locKey("kfc", 45.8, 15.9, "Cakovecka 5"));
});

Deno.test("locKey without address falls back to coordinates", () => {
  assertEquals(locKey("kfc", 45.80001, 15.9, null), "kfc:45.8000:15.9000:");
});
