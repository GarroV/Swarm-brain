import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Режим обслуживания («заморозка») — общий модуль для всех поверхностей.
//
// Зачем он нужен рядом с плашкой. Плашка (`scripts/deploy-notice.sh`) ПРЕДУПРЕЖДАЕТ о
// раскатке, но ничего не запрещает: человек продолжает править данные ровно в тот момент,
// когда меняется схема или уезжает новый веб. Для крупного переезда этого мало — нужен режим,
// который говорит людям «идут работы» и не принимает изменений, чтобы правка не ушла в никуда.
//
// Срок годности лежит В ДАННЫХ, а не в дисциплине. Забытая заморозка — это лежащий продукт,
// поэтому режим гаснет САМ по `until`, даже если скрипт упал, сессия оборвалась, а человек ушёл
// спать. Тот же приём, что у плашки, и ровно по той же причине.
//
// Ответ на заблокированное — 503 + `Retry-After`: единственная пара, которую браузеры,
// клиентские библиотеки и краулеры читают как «вернись позже», а не как «этого больше нет».
// Рекордер и боты на ней сами уходят в повтор, поэтому запись не теряется, а откладывается.

/** Ключ в `app_settings`, где лежит состояние. Рядом с `deploy_notice` — это соседние режимы. */
export const MAINTENANCE_KEY = "maintenance";

/** Сколько держать прочитанное состояние, не перечитывая базу. */
const CACHE_TTL_MS = 10_000;
/** Границы `Retry-After`: меньше — клиенты бьются в стену, больше — возвращаются слишком поздно. */
const RETRY_MIN_SEC = 30;
const RETRY_MAX_SEC = 3600;

export type MaintenanceState = {
  /** Когда режим гаснет сам. Обязателен — заморозка без срока и есть забытая заморозка. */
  until: string;
  /** Что показать людям. Двуязычно: продукт говорит по-английски и по-русски. */
  messageEn: string;
  messageRu: string;
  startedAt: string | null;
};

/**
 * Разбирает значение из `app_settings`. Невалидное считается «заморозки нет»: неразобранная
 * строка НЕ должна ронять продукт в вечное обслуживание — это отказ в сторону работающего.
 */
export function parseMaintenance(value: unknown): MaintenanceState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const until = typeof v.until === "string" ? v.until : null;
  if (!until || Number.isNaN(Date.parse(until))) return null;
  const str = (x: unknown, fallback: string) =>
    typeof x === "string" && x.trim() ? x : fallback;
  return {
    until,
    messageEn: str(
      v.message_en,
      "Swarm is being updated. Please come back shortly.",
    ),
    messageRu: str(
      v.message_ru,
      "Идёт обновление Swarm. Пожалуйста, зайдите чуть позже.",
    ),
    startedAt: typeof v.started_at === "string" ? v.started_at : null,
  };
}

/** Активна ли заморозка прямо сейчас (срок в данных, а не в дисциплине). */
export function isActive(state: MaintenanceState | null, now: Date): boolean {
  if (!state) return false;
  return Date.parse(state.until) > now.getTime();
}

export type Verdict =
  | { frozen: false }
  | { frozen: true; retryAfterSec: number; state: MaintenanceState };

/**
 * Решает, пускать ли запрос. Единственное место, где это решается, — остальные поверхности
 * зовут его, а не переписывают правило у себя.
 *
 * Правила и причины:
 *   • срок истёк → пускаем: режим гаснет сам;
 *   • владелец → пускаем всегда: он и катит, и проверяет результат, заперев себя снаружи
 *     он не сможет ни убедиться, что всё встало, ни снять режим через продукт;
 *   • чтение (GET/HEAD/OPTIONS) → пускаем: оно ничего не портит, а «белый экран вместо
 *     данных» пугает сильнее честной плашки;
 *   • всё остальное → 503, потому что изменение во время переезда либо потеряется, либо
 *     ляжет поверх мигрирующей схемы.
 */
export function maintenanceVerdict(args: {
  state: MaintenanceState | null;
  now: Date;
  method: string;
  isOwner: boolean;
}): Verdict {
  const { state, now, method, isOwner } = args;
  if (!isActive(state, now)) return { frozen: false };
  if (isOwner) return { frozen: false };
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return { frozen: false };
  const left = Math.ceil((Date.parse(state!.until) - now.getTime()) / 1000);
  return {
    frozen: true,
    retryAfterSec: Math.min(RETRY_MAX_SEC, Math.max(RETRY_MIN_SEC, left)),
    state: state!,
  };
}

/** Тело ответа и заглушки — одна форма для API и веба, чтобы тексты не разъезжались. */
export function maintenancePayload(state: MaintenanceState) {
  return {
    maintenance: true as const,
    until: state.until,
    message_en: state.messageEn,
    message_ru: state.messageRu,
  };
}

let cache: { at: number; state: MaintenanceState | null } | null = null;

/** Для тестов и для случая, когда режим только что сняли и ждать TTL незачем. */
export function resetMaintenanceCache(): void {
  cache = null;
}

/**
 * Читает состояние из `app_settings` с коротким кэшем: проверка висит на КАЖДОМ запросе, и
 * без кэша заморозка сама стала бы нагрузкой на базу. Ошибка чтения = «заморозки нет»:
 * недоступная настройка не должна запирать продукт.
 */
export async function readMaintenance(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<MaintenanceState | null> {
  if (cache && now.getTime() - cache.at < CACHE_TTL_MS) return cache.state;
  let state: MaintenanceState | null = null;
  try {
    const { data } = await supabase.from("app_settings").select("value").eq(
      "key",
      MAINTENANCE_KEY,
    ).maybeSingle();
    state = parseMaintenance(data?.value);
  } catch {
    state = null;
  }
  cache = { at: now.getTime(), state };
  return state;
}
