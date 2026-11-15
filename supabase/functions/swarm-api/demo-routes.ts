// Маршруты, открытые демо-сессии, — одно место на весь swarm-api.
//
// Демо — витрина по секретной ссылке: общий вход, синтетическое пространство `demo`. Ей открыто
// только то, что нужно показать продукт: задачи, проекты, спринты, встречи, заметки, поиск, лента.
// Всё, чего здесь нет, демо получает отказом 403 `demo_not_allowed` — в том числе любой новый
// маршрут, пока его сюда явно не добавили. Порядок в index.ts: сначала заготовленные ответы и
// отказы модели (demo-questions.ts), затем этот список, затем обычная маршрутизация.
//
// Точечные проверки `isDemo` внутри обработчиков остаются вторым замком; решение «пускать ли
// демо на маршрут» принимается здесь.

import { apiErr } from "./http.ts";
import { type DemoModelContext, handleDemoModelRoute } from "./demo-questions.ts";

type Rule = { methods: "*" | ReadonlyArray<string>; path: RegExp };

const ANY = "*" as const;
const GET = ["GET"] as const;

/** Белый список демо: метод + шаблон пути (routePath без префикса функции). */
export const DEMO_ALLOWED_ROUTES: ReadonlyArray<Rule> = [
  // Профиль, настройки и служебное.
  { methods: ANY, path: /^\/me$/ },
  { methods: GET, path: /^\/me\/passkeys$/ },
  { methods: GET, path: /^\/(?:config|maintenance)$/ },
  { methods: ["POST"], path: /^\/auth\/revoke-sessions$/ },
  // Экран «Подключения» показывает статусы; выдача ключей и подключение — не демо.
  { methods: GET, path: /^\/(?:integrations|recorder\/setup|mcp\/setup|mcp\/instructions)$/ },
  { methods: GET, path: /^\/granola\/notes$/ },
  // Люди и присутствие.
  { methods: ANY, path: /^\/(?:users|people|stats\/people|presence|presence\/strip)$/ },
  { methods: ANY, path: /^\/notifications(?:\/read)?$/ },
  { methods: ANY, path: /^\/(?:feedback|calendar\/today)$/ },
  // Ответы и поиск (заготовленные в демо — demo-questions.ts).
  { methods: ANY, path: /^\/(?:ask|search|search\/quick|digest|demo\/questions)$/ },
  // Задачи (кроме голосового ввода рекордера), метки, архив, файлы, комментарии.
  { methods: ANY, path: /^\/tasks(?:$|\/(?!voice(?:\/|$)).+)/ },
  { methods: ANY, path: /^\/task-labels(?:\/[^/]+)?$/ },
  // Проекты, пространства, спринты.
  { methods: ANY, path: /^\/(?:projects|sprints|sprint-cycles)(?:\/.*)?$/ },
  { methods: ANY, path: /^\/sprint-tasks\/.+$/ },
  { methods: GET, path: /^\/spaces\/[^/]+\/journal$/ },
  // Заметки и файлы.
  { methods: ANY, path: /^\/entries(?:\/.*)?$/ },
  { methods: GET, path: /^\/file\/.+$/ },
  // Встречи (запись из браузера в демо закрыта, видна только «активной записи нет»).
  { methods: ANY, path: /^\/meetings(?:$|\/(?!record(?:\/|$)).+)/ },
  { methods: GET, path: /^\/meetings\/record\/active$/ },
  { methods: ANY, path: /^\/agent-meetings(?:\/.*)?$/ },
  // Главная: стикеры, короткие ссылки (запись в них демо и так запрещена), качество, рынок.
  { methods: ANY, path: /^\/stickers(?:\/.*)?$/ },
  { methods: ANY, path: /^\/short-links(?:\/[^/]+)?$/ },
  { methods: GET, path: /^\/quality(?:\/maps|\/aggregators)?$/ },
  { methods: GET, path: /^\/inspections(?:\/[^/]+)?$/ },
  { methods: ANY, path: /^\/market\/.+$/ },
];

/** Пускать ли демо-сессию на маршрут. Всё, чего нет в DEMO_ALLOWED_ROUTES, — нет. */
export function demoRouteAllowed(method: string, routePath: string): boolean {
  const m = method.toUpperCase();
  return DEMO_ALLOWED_ROUTES.some((r) => (r.methods === ANY || r.methods.includes(m)) && r.path.test(routePath));
}

/**
 * Вход демо-сессии в роутер: маршруты модели — заготовленный ответ или отказ (demo-questions.ts),
 * маршрут вне белого списка — 403 demo_not_allowed; null — пускать дальше.
 */
export async function demoGate(ctx: DemoModelContext, req: Request, routePath: string): Promise<Response | null> {
  const modelResp = await handleDemoModelRoute(ctx, req, routePath);
  if (modelResp) return modelResp;
  if (demoRouteAllowed(req.method, routePath)) return null;
  return apiErr(403, "Not available in the demo", ctx.origin, "demo_not_allowed");
}
