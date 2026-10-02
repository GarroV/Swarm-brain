import { assertEquals } from "@std/assert";
import { samePlace } from "./geo.ts";

const ref = {
  chain: "dominos",
  lat: 45.80,
  lng: 15.97,
  address: "Ulica kneza Mislava 1, 10000 Zagreb (opposite Hotel Sheraton)",
};

Deno.test("samePlace: near point of the chain, or the same street and number a few km off; a neighbour number is not", () => {
  const at = (lat: number, address: string | null, chain = "dominos") => ({ chain, lat, lng: 15.97, address });
  assertEquals([
    samePlace(at(45.8005, null), [ref]),
    samePlace(at(45.81, "Ulica kneza Mislava 1"), [ref]),
    samePlace(at(45.81, "Kneza Mislava 3"), [ref]),
    samePlace(at(45.81, "Ulica kneza Mislava 1", "kfc"), [ref]),
    samePlace(at(45.99, "Ulica kneza Mislava 1"), [ref]),
  ], [true, true, false, false, false]);
  const bk = { chain: "bk", lat: 45.80, lng: 16.20, address: "Ul. Alfreda Nobela 10, Sop, 10361 Sesvetski Kraljevec" };
  assertEquals(samePlace({ chain: "bk", lat: 45.82, lng: 16.20, address: "Ulica Alfreda Nobela 10" }, [bk]), true);
});
