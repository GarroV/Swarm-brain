// Очередь `telegram_outbox`: сообщения людям, рождённые в комендантский час (docs/decisions/
// 2026-10-13-notification-curfew.md), и их доставка утром. Решения здесь — «слать/ждать/сдаться»;
// запросы к базе вынесены в хранилище (OutboxStore), чтобы тест гонял ровно решения, без БД.
// Постановку в очередь делает _shared/notify-person.ts, разбор очереди — drainTelegramOutbox ниже
// (зовёт почасовой крон swarm-bot).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { inCurfew } from "./curfew.ts";

export const OUTBOX_TABLE = "telegram_outbox";
/** Потолок отправок за один тик: утром очередь одна, но бот не должен захлебнуться при сбое накопления. */
export const OUTBOX_MAX_PER_TICK = 200;
/** Пауза между отправками: ~25 сообщений в секунду — предел Telegram для рассылки в разные чаты (30/с). */
export const OUTBOX_SPACING_MS = 40;
/** После стольких неудач строка сдаётся (`archived_at`) и больше не берётся. */
export const OUTBOX_MAX_ATTEMPTS = 3;

export interface OutboxMessage {
  recipient_id: number;
  method: string;
  /** Тело запроса к Bot API целиком (chat_id, text, parse_mode, reply_markup…). */
  payload: Record<string, unknown>;
  kind: string;
}

export interface OutboxRow extends OutboxMessage {
  id: number;
  attempts: number;
}

export interface OutboxStore {
  enqueue(message: OutboxMessage): Promise<void>;
  /** Неотправленные и не сдавшиеся, старые первыми. */
  unsent(limit: number): Promise<OutboxRow[]>;
  markSent(id: number, nowIso: string): Promise<void>;
  /** Неудача: attempts+1 и причина; при `giveUp` строка уходит в архив. */
  markFailed(id: number, attempts: number, error: string, giveUp: boolean, nowIso: string): Promise<void>;
}

/** Отправка одного запроса Bot API. Обязана БРОСАТЬ, если Telegram сообщение не принял. */
export type TelegramCall = (method: string, payload: Record<string, unknown>) => Promise<void>;

function must(what: string, res: { error: { message: string } | null }): void {
  // Сбой записи в очередь — громко: молча потерянное «утреннее» сообщение не вернуть.
  if (res.error) throw new Error(`telegram-outbox: ${what}: ${res.error.message}`);
}

export function makeOutboxStore(supabase: SupabaseClient): OutboxStore {
  return {
    async enqueue(message) {
      must("enqueue", await supabase.from(OUTBOX_TABLE).insert(message));
    },
    async unsent(limit) {
      const res = await supabase
        .from(OUTBOX_TABLE)
        .select("id, recipient_id, method, payload, kind, attempts")
        .is("sent_at", null)
        .is("archived_at", null)
        .order("id", { ascending: true })
        .limit(limit);
      must("unsent", res);
      return (res.data ?? []) as OutboxRow[];
    },
    async markSent(id, nowIso) {
      must("markSent", await supabase.from(OUTBOX_TABLE).update({ sent_at: nowIso }).eq("id", id));
    },
    async markFailed(id, attempts, error, giveUp, nowIso) {
      const patch: Record<string, unknown> = { attempts, last_error: error.slice(0, 500) };
      if (giveUp) patch.archived_at = nowIso;
      must("markFailed", await supabase.from(OUTBOX_TABLE).update(patch).eq("id", id));
    },
  };
}

export interface DrainDeps {
  store: OutboxStore;
  send: TelegramCall;
  now?: Date;
  /** Подмена паузы для теста. */
  sleep?: (ms: number) => Promise<void>;
  limit?: number;
  spacingMs?: number;
}

export interface DrainResult {
  sent: number;
  failed: number;
  /** Из них сдавшихся (3-я неудача). */
  gaveUp: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Отправить накопленное за комендантский час. Внутри часа не делает ничего (тик ночью пуст).
 * Старые первыми, не больше `limit` за тик (остаток уйдёт следующим — крон почасовой). Неудачная
 * строка не блокирует остальных: attempts+1 и причина, на третьей неудаче — в архив. Строка,
 * отправленная в этом тике, помечается сразу, не пачкой в конце: оборвавшийся тик не пришлёт дубль.
 */
export async function drainTelegramOutbox(deps: DrainDeps): Promise<DrainResult> {
  const now = deps.now ?? new Date();
  const result: DrainResult = { sent: 0, failed: 0, gaveUp: 0 };
  if (inCurfew(now)) return result;

  const sleep = deps.sleep ?? realSleep;
  const spacingMs = deps.spacingMs ?? OUTBOX_SPACING_MS;
  const rows = await deps.store.unsent(deps.limit ?? OUTBOX_MAX_PER_TICK);
  for (const [i, row] of rows.entries()) {
    if (i > 0 && spacingMs > 0) await sleep(spacingMs);
    try {
      await deps.send(row.method, row.payload);
    } catch (e) {
      const attempts = row.attempts + 1;
      const giveUp = attempts >= OUTBOX_MAX_ATTEMPTS;
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[telegram-outbox] ${row.kind} → ${row.recipient_id} (попытка ${attempts}): ${reason}`);
      await deps.store.markFailed(row.id, attempts, reason, giveUp, now.toISOString());
      result.failed++;
      if (giveUp) result.gaveUp++;
      continue;
    }
    await deps.store.markSent(row.id, now.toISOString());
    result.sent++;
  }
  return result;
}
