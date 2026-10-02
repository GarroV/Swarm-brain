import { LEGACY_HOST, PRIMARY_HOST } from "../src/lib/prodHosts";

// Cloudflare Pages: перехватчик ВСЕХ запросов (в проекте нет _routes.json — функции видят и статику).
// Переезд на swarm-team.app (issue #753): прежний адрес отвечает 301 на тот же путь нового.
// Выключатель — переменная LEGACY_REDIRECT=on в дашборде Pages: включается в один заход со сменой
// домена у бота (BotFather /setdomain), без пересборки.
//   • только точный хост swarm-brain.pages.dev — превью веток (<хеш>.swarm-brain.pages.dev) живут;
//   • /api/* НЕ переадресуем: POST после 301 браузер превращает в GET, и открытая вкладка молча
//     потеряла бы сохранения. Такая вкладка дорабатывает до перезагрузки.
//   • /s/<code> переадресуется как всё остальное: разосланные короткие ссылки продолжают работать.
type Env = { LEGACY_REDIRECT?: string };
type Ctx = { request: Request; env: Env; next: () => Promise<Response> };

export function legacyRedirectTarget(requestUrl: string, enabled: boolean): string | null {
  if (!enabled) return null;
  const url = new URL(requestUrl);
  if (url.hostname !== LEGACY_HOST) return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  return `https://${PRIMARY_HOST}${url.pathname}${url.search}`;
}

export async function onRequest(ctx: Ctx): Promise<Response> {
  const target = legacyRedirectTarget(ctx.request.url, ctx.env.LEGACY_REDIRECT === "on");
  if (target) return new Response(null, { status: 301, headers: { Location: target } });
  return ctx.next();
}
