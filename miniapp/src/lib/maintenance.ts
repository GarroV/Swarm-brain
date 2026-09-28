// Заморозка системы на время работ — состояние и чистая логика, без React, чтобы гоняться
// `deno test` вместе с остальными тестами веба.
//
// Зачем режим нужен рядом с плашкой «скоро обновление» (deployNotice.ts): плашка
// ПРЕДУПРЕЖДАЕТ, но ничего не запрещает. Для крупного переезда этого мало — человек правит
// данные ровно тогда, когда меняется схема или уезжает новый веб. Заморозка показывает
// честную заглушку и не принимает изменений; сервер в это время отвечает 503 + Retry-After.
//
// Срок живёт В ДАННЫХ: и сервер, и клиент считают режим погасшим после `until`. Клиент
// проверяет срок сам, потому что ответ мог осесть в кэше вкладки, а скрипт — упасть на
// середине и не снять флаг.

export type Maintenance = {
  /** Когда режим гаснет сам (ISO). */
  until: string;
  /** Текст для людей — оба языка приезжают с сервера, экран берёт нужный. */
  message_en: string;
  message_ru: string;
  /** Этот человек проходит сквозь заморозку (владелец): ему показываем полоску, а не заглушку. */
  bypass?: boolean;
};

/** Ответ публичного статуса `GET /maintenance`: либо режим, либо честное «нет». */
export type MaintenanceResponse =
  | ({ maintenance: true } & Maintenance)
  | { maintenance: false };

export function isMaintenanceActive(
  m: Maintenance | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!m?.until) return false;
  const t = new Date(m.until).getTime();
  return !Number.isNaN(t) && t > now.getTime();
}

/** Разбирает ответ сервера. Всё, что не похоже на активный режим, читается как «работаем». */
export function parseMaintenanceResponse(
  body: unknown,
  now: Date = new Date(),
): Maintenance | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.maintenance !== true) return null;
  const m: Maintenance = {
    until: typeof b.until === "string" ? b.until : "",
    message_en: typeof b.message_en === "string" ? b.message_en : "",
    message_ru: typeof b.message_ru === "string" ? b.message_ru : "",
    bypass: b.bypass === true,
  };
  return isMaintenanceActive(m, now) ? m : null;
}

/** Сколько ждать до конца работ, целыми минутами (0 — «вот-вот»). */
export function minutesLeft(m: Maintenance, now: Date = new Date()): number {
  const left = new Date(m.until).getTime() - now.getTime();
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

// ── Оповещение экрана ────────────────────────────────────────────────────────
// Заморозку узнают двумя путями: опросом публичного статуса и по ответу 503 на любой запрос.
// Второй путь важнее: человек узнаёт о работах ровно в тот момент, когда попытался что-то
// изменить, а не через интервал опроса.

let current: Maintenance | null = null;
const listeners = new Set<(m: Maintenance | null) => void>();

export function lastMaintenance(): Maintenance | null {
  return current;
}

export function publishMaintenance(m: Maintenance | null): void {
  current = m;
  listeners.forEach((fn) => fn(m));
}

export function subscribeMaintenance(
  fn: (m: Maintenance | null) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── Объявление о заморозке: плашка и колокольчик (issue #609) ─────────────────
// Одно нажатие кнопки даёт «предупредить → заморозить → снять». Людям до начала показываем
// КОГДА и НА СКОЛЬКО — в местном времени смотрящего, а не в UTC сервера.

/** Содержимое уведомления «плановые работы» — кладёт SQL-функция maintenance_announce. */
export type MaintenanceNotice = {
  starts_at?: string;
  until?: string;
  message_en?: string;
  message_ru?: string;
  /** Работы сняли раньше срока или отменили плановые. */
  cancelled_at?: string;
};

export type FreezeWindow = {
  /** «23:30» в местном времени. */
  start: string;
  end: string;
  /** Длительность целыми минутами. */
  minutes: number;
  phase: "planned" | "running" | "over" | "cancelled";
};

/** Окно работ для подписи. null — данных нет или они битые: подпись не рисуем, мусор не показываем. */
export function freezeWindow(
  n: MaintenanceNotice | null | undefined,
  locale: string,
  now: Date = new Date(),
): FreezeWindow | null {
  const s = n?.starts_at ? new Date(n.starts_at).getTime() : NaN;
  const u = n?.until ? new Date(n.until).getTime() : NaN;
  if (Number.isNaN(s) || Number.isNaN(u) || u <= s) return null;
  const clock = (t: number) =>
    new Date(t).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const t = now.getTime();
  const phase = n?.cancelled_at
    ? "cancelled"
    : t < s
    ? "planned"
    : t < u
    ? "running"
    : "over";
  return { start: clock(s), end: clock(u), minutes: Math.round((u - s) / 60_000), phase };
}
