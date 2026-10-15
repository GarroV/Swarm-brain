import { assertEquals } from "jsr:@std/assert@1";
import { ESCAPE_LAYER_ATTR, hasOpenEscapeLayer } from "./escapeLayer.ts";

// Без DOM: корень подменяется объектом с querySelector, который ищет по тому же селектору.
const rootWith = (selectors: string[]) => ({ querySelector: (s: string) => (selectors.includes(s) ? {} : null) }) as unknown as ParentNode;

Deno.test("hasOpenEscapeLayer: есть помеченное меню — Escape принадлежит ему", () => {
  assertEquals(hasOpenEscapeLayer(rootWith([`[${ESCAPE_LAYER_ATTR}]`])), true);
});

Deno.test("hasOpenEscapeLayer: меню нет — Escape закрывает карточку", () => {
  assertEquals(hasOpenEscapeLayer(rootWith([])), false);
});
