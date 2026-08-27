// HTTP-хелперы swarm-api: CORS + JSON-ответы. Общий модуль, чтобы index.ts и
// доменные роут-модули (task-labels.ts и др.) отдавали идентичные заголовки без дублей.

const MINIAPP_ORIGIN = Deno.env.get("MINIAPP_ORIGIN") ?? "*";

export function corsHeaders(origin: string): Record<string, string> {
  const allowOrigin =
    MINIAPP_ORIGIN === "*" ? "*"
    : origin === MINIAPP_ORIGIN ? origin
    : MINIAPP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Без Expose-Headers браузер не отдаст JS ничего, кроме простых заголовков — на
    // cross-origin запросах X-Total-Count был бы виден в DevTools и невидим коду.
    "Access-Control-Expose-Headers": "X-Total-Count",
  };
}

// Cache-Control: no-store на КАЖДОМ ответе — это приватный API (чужие записи, задачи,
// тезисы). Без него ответ вправе осесть в промежуточном кэше и отдаться повторно/не тому
// (см. issue #71: service worker кэшировал /api/* и показывал данные «на шаг назад»).
export function json(data: unknown, status = 200, origin = "", extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
      ...(extra ?? {}),
    },
  });
}

export function apiErr(status: number, message: string, origin = ""): Response {
  return json({ error: message }, status, origin);
}

// ── Лимит списочных ответов ───────────────────────────────────────────────────

/**
 * Разбирает `?limit=` для списочных эндпоинтов: дефолт, если параметра нет или он мусор,
 * и жёсткий потолок, чтобы клиент не мог попросить мегабайты.
 *
 * Живёт здесь, а не инлайном в роутере, по двум причинам. Первая — это ровно то место, где
 * прячутся молчаливые дефекты: `parseInt("abc")` даёт NaN, `?limit=0` даёт 0, и список
 * приезжает пустым без всякой ошибки. Вторая — дефолт должен задавать КЛИЕНТ (swarm-api),
 * а не движок: `_shared/tasks/db.ts` ставит 200, и это правильно для бота (он печатает
 * список сообщением в чат), но для веба смертельно — веб фильтрует статусы и линзы НА
 * КЛИЕНТЕ, значит ему нужен полный набор. На проде задач было 188 из 200, и при переполнении
 * сортировка `due_date ASC nulls last` отрезала бы первыми задачи БЕЗ срока — их 67, и под
 * них на дашборде есть отдельная секция (issue #111).
 */
export function parseListLimit(param: string | null, { def, max }: { def: number; max: number }): number {
  const raw = param ? parseInt(param, 10) : NaN;
  const wanted = Number.isFinite(raw) && raw > 0 ? raw : def;
  return Math.min(wanted, max);
}
