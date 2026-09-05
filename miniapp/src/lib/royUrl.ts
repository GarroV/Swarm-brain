// Навигация ↔ адресная строка (issue #31). ЧИСТЫЕ функции: ни window, ни history —
// чтобы правило можно было проверить тестом, а не кликами.
//
// Зачем. Веб живёт на одном роуте `/`, навигация — состояние в RoyApp (tab + stack).
// Приложение делалось как Telegram Mini App, где URL не виден и шарить его бессмысленно;
// вход из Telegram отключён ~15.07.2026, все ходят браузером — и цена стала реальной:
// нельзя дать коллеге ссылку на задачу, «назад» уводит с сайта, средний клик не работает.
//
// Что кладём в адрес: ТАБ и ВЕРХНИЙ экран стека. Не весь стек — намеренно: ссылка должна
// читаться человеком («вот эта задача»), а стек в продукте мелкий (0–1 экран). Глубина
// живёт в памяти сессии и в sessionStorage, как и раньше.
import type { RoyRoute, RoyTab } from "./royRoute.ts";

export const ROY_TABS_ALL = ["search", "task", "projects", "book", "cal", "more"] as const;

export type RoyUrlState = { tab: RoyTab | null; route: RoyRoute | null };

/** Экраны, которым для открытия обязателен id: без него роут бесполезен и ведёт в белый экран. */
const NEEDS_ID = new Set(["record", "taskDetail", "meetingDetail", "meetingReview", "project"]);

/** Экраны без параметров — их можно открыть по одному имени. */
const NO_PARAMS = new Set(["newEntry", "ask", "base", "settings", "team", "admin", "more", "map"]);

function isTab(v: string | null): v is RoyTab {
  return !!v && (ROY_TABS_ALL as readonly string[]).includes(v);
}

/**
 * Состояние навигации → строка запроса (без ведущего «?»). Пустая строка = корень.
 *
 * Вычитка встречи сериализуется в НАСЛЕДУЕМЫЙ `?meeting=<id>`, а не в `view=meetingReview`:
 * этот адрес уже рассылают уведомления «тезисы готовы» и лаунч установленного PWA
 * (lib/single-tab.ts). Один формат вместо двух — иначе старые ссылки и новые разошлись бы.
 */
export function stateToQuery(tab: RoyTab, route: RoyRoute | null): string {
  const p = new URLSearchParams();
  if (route?.view === "meetingReview" && route.params?.id) {
    p.set("meeting", route.params.id);
    return p.toString();
  }
  if (tab !== "search") p.set("tab", tab);
  if (route) {
    p.set("view", route.view);
    const params = (route as { params?: { id?: string; query?: string; mode?: string } }).params;
    if (params?.id) p.set("id", params.id);
    if (params?.query) p.set("q", params.query);
    if (params?.mode) p.set("mode", params.mode);
  }
  return p.toString();
}

/**
 * Строка запроса → состояние навигации. `null` в поле = «в адресе не задано».
 *
 * Невалидное молча игнорируем, а не падаем: адрес правит кто угодно, и чужая опечатка не
 * повод показать белый экран. Роут без обязательного id — тот же случай.
 */
export function queryToState(search: string): RoyUrlState {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return { tab: null, route: null };
  }

  const legacyMeeting = p.get("meeting");
  if (legacyMeeting) {
    return { tab: "cal", route: { view: "meetingReview", params: { id: legacyMeeting } } };
  }

  const tabRaw = p.get("tab");
  const tab = isTab(tabRaw) ? tabRaw : null;

  const view = p.get("view");
  if (!view) return { tab, route: null };

  const id = p.get("id");
  const q = p.get("q");
  const mode = p.get("mode");

  if (NEEDS_ID.has(view)) {
    if (!id) return { tab, route: null };
    return { tab, route: { view, params: { id } } as RoyRoute };
  }
  if (view === "answer") {
    if (!q) return { tab, route: null };
    return { tab, route: { view: "answer", params: { query: q } } };
  }
  if (view === "newTask") {
    return { tab, route: id ? { view: "newTask", params: { id } } : { view: "newTask" } };
  }
  if (view === "meetAdmin") {
    return { tab, route: mode === "review" || mode === "all" ? { view: "meetAdmin", params: { mode } } : { view: "meetAdmin" } };
  }
  if (NO_PARAMS.has(view)) return { tab, route: { view } as RoyRoute };
  return { tab, route: null };
}

/** Полный путь для history.pushState: всегда абсолютный, чтобы не зависеть от текущего адреса. */
export function stateToPath(tab: RoyTab, route: RoyRoute | null, pathname = "/"): string {
  const qs = stateToQuery(tab, route);
  return qs ? `${pathname}?${qs}` : pathname;
}
