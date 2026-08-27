// Плашка «скоро обновление» — чистая логика без React, чтобы гоняться `deno test` вместе с
// остальными тестами веба (типы локальные, импортов нет).
//
// Зачем вообще: раскатка веба пересобирает Cloudflare Pages, после чего наш service worker
// сам перезагружает открытые страницы (`controllerchange` в ServiceWorkerRegister). Без
// предупреждения человек, который правит тезисы, получает перезагрузку под руками — ровно это
// и случилось бы 27.08.2026, если бы заливку сделали днём.
//
// Отсчёт в «мин» — намеренно: «через 12 мин» верно при любом числе, поэтому русская таблица
// падежей («минуту/минуты/минут») не нужна и не может разъехаться.

export type DeployNotice = {
  /** Когда начнётся раскатка (ISO). */
  at: string;
  /** Когда плашка гаснет САМА, даже если её никто не снял (ISO). */
  until: string;
  /** Нештатный текст-переопределение; обычно пусто — подпись строится из отсчёта. */
  ru?: string | null;
  en?: string | null;
};

export type NoticeView = {
  phase: "soon" | "now";
  /** Целые минуты до начала; в фазе «now» — 0. */
  minutes: number;
};

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Что показывать сейчас. null — не показывать ничего.
 *
 * `until` — страховка от зависшей плашки: сервер её тоже фильтрует, но клиент мог закешировать
 * ответ, а упавший на середине скрипт раскатки не успел бы снять флаг.
 */
export function noticeView(
  notice: DeployNotice | null | undefined,
  now: Date = new Date(),
): NoticeView | null {
  if (!notice) return null;
  const at = ms(notice.at);
  const until = ms(notice.until);
  if (at == null || until == null) return null;
  if (until <= at) return null; // бессмысленный интервал — молчим, а не показываем мусор

  const t = now.getTime();
  if (t >= until) return null;
  if (t >= at) return { phase: "now", minutes: 0 };

  // Округление ВВЕРХ: «через 0 мин» читалось бы как «уже идёт», хотя ещё нет.
  return { phase: "soon", minutes: Math.max(1, Math.ceil((at - t) / 60_000)) };
}

// ── стор объявления ──────────────────────────────────────────────────────────
// Объявление приезжает прицепом к ленте уведомлений, которую опрашивает колокольчик. Плашке
// СВОЙ поллинг не нужен: узнав `at`, она тикает отсчёт локально — поэтому колокольчик просто
// публикует то, что пришло, а плашка слушает. Второй опрос той же ручки был бы возвратом к
// проблеме, которую закрывал issue #103 (дубли запросов на маунтах).

type NoticeListener = (notice: DeployNotice | null) => void;

const listeners = new Set<NoticeListener>();
let current: DeployNotice | null = null;

/** Последнее известное объявление — для плашки, смонтированной ПОСЛЕ публикации. */
export function lastNotice(): DeployNotice | null {
  return current;
}

export function publishNotice(notice: DeployNotice | null): void {
  current = notice;
  listeners.forEach((l) => l(notice));
}

/** Возвращает функцию отписки: без неё размонтированная плашка продолжала бы получать вызовы. */
export function subscribeNotice(listener: NoticeListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
