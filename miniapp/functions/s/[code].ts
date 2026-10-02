import { swarmApiUrl } from "../_lib/api-url";

// Cloudflare Pages Function: GET /s/<code> — переход по короткой ссылке («Полезности»).
// Спрашивает адрес у публичного маршрута swarm-api (`/public/s/<code>`, он же считает клик)
// и отвечает 302. Именно 302, а не 301: постоянную переадресацию браузер кэширует навсегда,
// и тогда ни счётчик, ни снятие ссылки уже не действуют.
// Ссылки нет или сбой — короткая страница на двух языках: открывает её посторонний человек
// из SMS, ему нужен понятный ответ, а не пустой экран или вход в Swarm.
type Env = { SWARM_API_URL?: string };
type Ctx = { request: Request; env: Env; params: { code?: string | string[] } };

const CODE_RE = /^[A-Za-z0-9]{4,16}$/;
const NO_STORE = { "Cache-Control": "no-store" };

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const raw = ctx.params.code;
  const code = Array.isArray(raw) ? raw[0] : raw ?? "";
  if (!CODE_RE.test(code)) return notFound();

  let res: Response;
  try {
    res = await fetch(`${swarmApiUrl(ctx.env)}/public/s/${code}`);
  } catch (e) {
    console.error("short link: swarm-api недоступен", e);
    return failure();
  }
  if (res.status === 404) return notFound();
  if (!res.ok) {
    console.error("short link: swarm-api ответил", res.status);
    return failure();
  }
  const body = await res.json().catch(() => null) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : "";
  // Адрес проверен при создании; повторная проверка схемы — страховка от ручной правки в базе.
  if (!/^https?:\/\//i.test(url)) return failure();
  return new Response(null, { status: 302, headers: { Location: url, ...NO_STORE, "Referrer-Policy": "no-referrer" } });
}

function notFound(): Response {
  return page(404, "Link not found", "Ссылка не найдена", "The link may have been removed or mistyped.", "Возможно, её удалили или в адресе опечатка.");
}

function failure(): Response {
  return page(502, "Something went wrong", "Что-то пошло не так", "Please try again in a minute.", "Попробуйте ещё раз через минуту.");
}

function page(status: number, titleEn: string, titleRu: string, textEn: string, textRu: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titleEn}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f6f4;color:#1c1c1a;padding:16px;box-sizing:border-box}@media (prefers-color-scheme:dark){body{background:#151514;color:#eceae4}p{opacity:.75}}main{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px}</style></head><body><main><h1>${titleEn}</h1><p>${textEn}</p><h1 lang="ru">${titleRu}</h1><p lang="ru">${textRu}</p></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
}
