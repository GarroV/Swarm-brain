// Временный приёмник журнала проверочной страницы записи (public/rec-probe.html, задача
// «Запись встречи из браузера»). Только печатает присланный текст в журнал функции, который
// читается через `wrangler pages deployment tail`. Ничего не хранит. Удаляется вместе со страницей.
const MAX_BYTES = 32_000;

type Ctx = { request: Request };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const text = (await ctx.request.text()).slice(0, MAX_BYTES);
  console.log(`[rec-probe] ${text}`);
  return new Response(null, { status: 204 });
}
