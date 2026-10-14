import { assertEquals } from "jsr:@std/assert@1";
import { SWARM_PUBLIC_URL, toPublicUrl } from "./public-url.ts";

function withInternal<T>(value: string | undefined, fn: () => T): T {
  const prev = Deno.env.get("SUPABASE_URL");
  if (value === undefined) Deno.env.delete("SUPABASE_URL");
  else Deno.env.set("SUPABASE_URL", value);
  try {
    return fn();
  } finally {
    if (prev === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", prev);
  }
}

Deno.test("toPublicUrl: внутренний origin заменяется на публичный, путь и query целы", () => {
  const out = withInternal(
    "http://api-gw:8000",
    () => toPublicUrl("http://api-gw:8000/storage/v1/object/sign/b/p.pdf?token=abc"),
  );
  assertEquals(out, `${SWARM_PUBLIC_URL}/storage/v1/object/sign/b/p.pdf?token=abc`);
});

Deno.test("toPublicUrl: слэш в конце SUPABASE_URL не мешает", () => {
  const out = withInternal("http://api-gw:8000/", () => toPublicUrl("http://api-gw:8000/storage/v1/x"));
  assertEquals(out, `${SWARM_PUBLIC_URL}/storage/v1/x`);
});

Deno.test("toPublicUrl: уже публичный адрес не меняется", () => {
  const url = `${SWARM_PUBLIC_URL}/storage/v1/object/sign/b/p.pdf?token=abc`;
  assertEquals(withInternal("http://api-gw:8000", () => toPublicUrl(url)), url);
});

Deno.test("toPublicUrl: чужой хост с похожим началом не трогается", () => {
  const url = "http://api-gw:8000.evil.example/x";
  assertEquals(withInternal("http://api-gw:8000", () => toPublicUrl(url)), url);
});

Deno.test("toPublicUrl: без SUPABASE_URL возвращает как есть", () => {
  assertEquals(withInternal(undefined, () => toPublicUrl("http://api-gw:8000/x")), "http://api-gw:8000/x");
});
