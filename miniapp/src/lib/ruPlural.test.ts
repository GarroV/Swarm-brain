import { assertEquals } from "jsr:@std/assert@1";
import { ruPlural } from "./ruPlural.ts";

Deno.test("ruPlural: 1, 21, 101 take one; 2–4 few; 0, 5–20, 111–114 many", () => {
  const f = (n: number) => ruPlural(n, "точка", "точки", "точек");
  assertEquals([1, 21, 101, 2, 34, 0, 5, 11, 12, 14, 111, 392].map(f), ["точка", "точка", "точка", "точки", "точки", "точек", "точек", "точек", "точек", "точек", "точек", "точки"]);
});
