import { signJWT } from "../../_lib/jwt";

// Cloudflare Pages Function: GET /api/auth/demo?key=<DEMO_ACCESS_KEY>
// Demo-вход по ссылке с ключом — выдаёт сессию зашитого demo-юзера (не Google-логин).
// Заказчик открывает ссылку → httpOnly cookie с JWT → попадает в demo-воркспейс.
//
// Ссылка ПУБЛИЧНАЯ НАМЕРЕННО (решение 27.10.2026, issue #604): она лежит в README, чтобы любой
// мог зайти в витрину за десять секунд. DEMO_ACCESS_KEY здесь — не секрет, а адрес входа и
// отсекатель случайных переходов; модель угроз такая: КАЖДЫЙ, у кого есть ссылка, — демо-юзер.
// Поэтому всё, что демо-сессия может изменить, видно любому, а всё, что стоит денег, ей закрыто.
//
// Изоляция «нет дыр в рабочие» и «нет трат» держится НЕ здесь, а в swarm-api (барьер isDemo):
// эта сессия форсится в group_id='demo', не админ, не минтит токены, не подключает интеграции и
// не вызывает модель (docs/decisions/2026-10-27-demo-no-model.md). Здесь — только выдача сессии.
// Тот же id, что DEMO_USER_ID в supabase/functions/_shared/demo-session.ts (сборки разные).
export const DEMO_USER_ID = 900000001;
const SESSION_MAX_AGE = 7 * 86400;

type Env = { WEB_JWT_SECRET: string; DEMO_ACCESS_KEY: string };
type Ctx = { request: Request; env: Env };

// Демо встраивается в <iframe> витрины garrov.github.io. Там кука обязана быть
// Partitioned (CHIPS): она ложится в отдельную «коробку» под сайтом витрины и
// (1) не затирает настоящую сессию человека на swarm-brain.pages.dev — без этого одно
// открытие витрины подменяло рабочий вход на демо (30.09.2026, у владельца);
// (2) работает и там, где сторонние куки запрещены — без неё iframe выпадал на /login,
// и вход оттуда вёл в прод. Открытое вкладкой демо — явное «войти в демо»: обычная кука.
export function demoSessionCookie(jwt: string, fetchDest: string | null): string {
  const base = `roj_session=${jwt}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_MAX_AGE}`;
  return fetchDest === "iframe" ? `${base}; Partitioned` : base;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  if (!env.WEB_JWT_SECRET || !env.DEMO_ACCESS_KEY) {
    return new Response("Demo not configured", { status: 500 });
  }
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  // Ключ высокоэнтропийный и всё равно публичный (README): сравнение отсекает случайные переходы, а не защищает данные.
  if (!key || key !== env.DEMO_ACCESS_KEY) {
    return new Response("Forbidden", { status: 403 });
  }

  const jwt = await signJWT({ telegram_id: DEMO_USER_ID }, env.WEB_JWT_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      // SameSite=None: кросс-сайт iframe иначе не получит сессию. Безопасно: demo-сессия
      // изолирована в swarm-api. Реальный логин (google/callback.ts) остаётся Lax.
      "Set-Cookie": demoSessionCookie(jwt, request.headers.get("Sec-Fetch-Dest")),
    },
  });
}
