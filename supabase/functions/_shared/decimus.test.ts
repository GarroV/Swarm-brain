// Клиент Децимуса против локального поддельного сервера: токен уходит в заголовке, пустые параметры
// пропускаются, не-2xx — ошибка со статусом, без настройки — DecimusNotConfigured.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { decimusGet, DecimusHttpError, DecimusNotConfigured, decimusPageUrl } from "./decimus.ts";

Deno.test("decimusGet: токен, параметры, 404 как DecimusHttpError, без env — NotConfigured", async () => {
  const seen: { auth: string | null; search: string }[] = [];
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    const u = new URL(req.url);
    seen.push({ auth: req.headers.get("authorization"), search: u.search });
    return u.pathname === "/missing" ? new Response("nope", { status: 404 }) : Response.json({ ok: true });
  });
  const keep = [Deno.env.get("DECIMUS_API_URL"), Deno.env.get("DECIMUS_API_TOKEN")];
  try {
    Deno.env.delete("DECIMUS_API_URL");
    Deno.env.delete("DECIMUS_API_TOKEN");
    await assertRejects(() => decimusGet("/x"), DecimusNotConfigured);
    assertEquals(decimusPageUrl("/registry/1"), null);

    Deno.env.set("DECIMUS_API_URL", `http://127.0.0.1:${server.addr.port}`);
    Deno.env.set("DECIMUS_API_TOKEN", "tok");
    assertEquals(await decimusGet("/x", { countries: "RS,HR", from: null, to: undefined, on: "2026-10-01" }), {
      ok: true,
    });
    assertEquals(seen[0], { auth: "Bearer tok", search: "?countries=RS%2CHR&on=2026-10-01" });
    const e = await assertRejects(() => decimusGet("/missing"), DecimusHttpError);
    assertEquals(e.status, 404);
    assertEquals(decimusPageUrl("/registry/1"), `http://127.0.0.1:${server.addr.port}/registry/1`);
    assertEquals(decimusPageUrl("registry/1"), null);
  } finally {
    await server.shutdown();
    for (const [i, k] of ["DECIMUS_API_URL", "DECIMUS_API_TOKEN"].entries()) {
      if (keep[i] === undefined) Deno.env.delete(k);
      else Deno.env.set(k, keep[i]!);
    }
  }
});
