// Присутствие (#751) — чистая логика пульса: какой раздел открыт и когда слать. Без React и
// без window: её гоняют тесты, а компонент PresencePulse только передаёт сюда адрес и время.
//
// На экран ничего не выводится: данные видит только админ через GET /presence.
import { queryToState } from "@/lib/royUrl";

/** Пульс видимой вкладки. */
export const PRESENCE_PULSE_MS = 30_000;
/** Был ввод за последнюю минуту — человек «активен», иначе вкладка просто открыта. */
export const PRESENCE_ACTIVE_WINDOW_MS = 60_000;
/** Как часто сверяем раздел локально (без сети): смена уходит на сервер сразу. */
export const PRESENCE_CHECK_MS = 2_000;
const SECTION_MAX = 40;

// Имена для журнала — человеческие, а не внутренние ключи табов (task → tasks, cal → meetings).
const TAB_NAMES: Record<string, string> = {
  search: "home",
  task: "tasks",
  projects: "projects",
  sprints: "sprints",
  market: "market",
  book: "base",
  cal: "meetings",
  more: "more",
};
const LENSES = new Set(["mine", "team", "all", "staff"]);
const LISTS = new Set(["today", "upcoming", "all", "recurring", "done"]);

/** Вкладка доски задач из сохранённого вида (localStorage «roy_tasks_view»): «mine/today». */
function tasksBoardSuffix(savedView: string | null): string {
  if (!savedView) return "";
  try {
    const v = JSON.parse(savedView) as { lens?: unknown; activeList?: unknown; allStaff?: unknown };
    // «Все сотрудники» включает только админ; сервер это и так проверит, здесь — только подпись.
    const lens = v.allStaff === true ? "staff" : v.lens;
    const parts = [
      typeof lens === "string" && LENSES.has(lens) ? lens : null,
      typeof v.activeList === "string" && LISTS.has(v.activeList) ? v.activeList : null,
    ].filter(Boolean);
    return parts.length ? `/${parts.join("/")}` : "";
  } catch {
    return "";
  }
}

/**
 * Адрес страницы → раздел для журнала. null — пульс не нужен (страница входа).
 * Формат: «таб[/экран]», для доски задач — «tasks/линза/список».
 */
export function presenceSection(
  pathname: string,
  search: string,
  savedTasksView: string | null,
): string | null {
  if (pathname.startsWith("/login")) return null;
  if (pathname.startsWith("/live")) return "live";
  const { tab, route } = queryToState(search);
  const base = TAB_NAMES[tab ?? "search"] ?? "home";
  let section = base;
  if (route) section = `${base}/${route.view.toLowerCase()}`;
  else if (base === "tasks") section = base + tasksBoardSuffix(savedTasksView);
  return section.slice(0, SECTION_MAX);
}

export type PulseMemo = { section: string; active: boolean; at: number } | null;

/**
 * Слать ли пульс сейчас (видимая вкладка). Сразу — на смене раздела и на возвращении к вводу
 * после простоя; иначе — раз в PRESENCE_PULSE_MS.
 */
export function shouldPulse(last: PulseMemo, section: string, active: boolean, now: number): boolean {
  if (!last) return true;
  if (last.section !== section) return true;
  if (active && !last.active) return true;
  return now - last.at >= PRESENCE_PULSE_MS;
}

export function isActive(lastInputAt: number, now: number): boolean {
  return now - lastInputAt < PRESENCE_ACTIVE_WINDOW_MS;
}
