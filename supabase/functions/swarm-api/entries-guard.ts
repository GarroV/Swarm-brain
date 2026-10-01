import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canActOnMeeting, type MeetingAction } from "../_shared/entries/meeting-rights.ts";
import { canMutateEntry, canViewEntry, entryVisibilityOr } from "../_shared/entries/access.ts";
import { onlyLiveEntries } from "../_shared/entries/live.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

// Колонки записи, которые уезжают в браузер. Ровно поля EntryRow + updated_at — и НИКОГДА
// не `*`: у entries есть embedding vector(1536) (~18.5 кБ текстом на строку) и fts tsvector
// (~7.8 кБ), которых нет ни в EntryRow, ни в клиентском типе Entry. Сервер их только ПИШЕТ
// (пересчитывает через OpenAI / генерирует база) и ни в одной точке не читает, поэтому в
// ответе они чистый балласт: на списке встреч это давало 6 МБ из 10 (issue #102), на одной
// записи — 26 кБ на каждое открытие.
export const ENTRY_COLUMNS =
  "id,content,summary,added_by,source,metadata,countries,entry_type,entry_date,group_id,is_private,owner_id,shared_with,created_at,updated_at";

/**
 * То же, что ENTRY_COLUMNS, но для СПИСКОВ: вместо полных content/summary берутся
 * generated-колонки с превью, под теми же именами (PostgREST-алиас `имя:колонка`).
 *
 * Зачем отдельный набор (issue #490): выбирать полный транскрипт, чтобы показать из него
 * 400 символов, стоит 654 мс базы на 283 встречах — против 15 мс, когда режет SQL. Форма
 * ответа при этом не меняется: клиент по-прежнему видит `content`, `summary` и `truncated`.
 *
 * Где НЕ применять: одиночный доступ (GET /:id) и очередь вычитки — там текст нужен целиком.
 */
export const ENTRY_LIST_COLUMNS =
  "id,content:content_preview,summary:summary_preview,list_truncated,added_by,source,metadata,countries,entry_type,entry_date,group_id,is_private,owner_id,shared_with,created_at,updated_at";

export type EntryRow = {
  id: string;
  content: string;
  summary: string | null;
  added_by: string;
  source: string;
  metadata: Record<string, unknown>;
  countries: string[];
  entry_type: string;
  entry_date: string | null;
  group_id: string | null;
  is_private: boolean;
  owner_id: number | null;
  /** С кем разделена личная запись (встреча 1-1, #641). У общей пусто. */
  shared_with: number[];
  created_at: string;
};

// ── Error ─────────────────────────────────────────────────────────────────────

export class EntryAccessError extends Error {
  constructor(public readonly status: 404 | 403, message: string) {
    super(message);
    this.name = "EntryAccessError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch a single entry with both security layers enforced:
 *
 *   Layer 1 — workspace isolation:  entry.group_id must match groupId
 *   Layer 2 — visibility:           private entries are invisible to non-owners
 *   Layer 3 — ownership (opt-in):   only the owner can mutate (DELETE / PATCH)
 *
 * Throws EntryAccessError(404) if the entry doesn't exist or access is denied.
 * Throws EntryAccessError(403) if requireOwner=true and the caller is not the owner.
 *
 * Both 404 cases are intentionally indistinguishable to callers — leaking
 * "entry exists but is private" would be a privacy violation.
 */
export async function getEntrySecure(
  supabase: SupabaseClient,
  id: string,
  {
    groupId,
    telegramId,
    requireOwner = false,
  }: { groupId: string; telegramId: number; requireOwner?: boolean },
): Promise<EntryRow> {
  const { data } = await onlyLiveEntries(
    supabase
      .from("entries")
      .select(ENTRY_COLUMNS),
  )
    .eq("id", id)
    .maybeSingle();

  // Layer 1: workspace isolation — ВСЕГДА (кросс-воркспейс доступа нет).
  if (!data || data.group_id !== groupId) {
    throw new EntryAccessError(404, "Not found");
  }

  // Приватность — БЕЗ admin-байпаса (решение владельца 2026-08-07): личная запись видна
  // ТОЛЬКО владельцу, даже админу/руководителю. Оверсайт-исключение оставлено лишь для ЗАДАЧ
  // (см. canViewTask в swarm-api), не для записей/встреч.
  // Layer 2: visibility — личную видят владелец и те, с кем она разделена (1-1, #641).
  if (!canViewEntry(data, telegramId)) {
    throw new EntryAccessError(404, "Not found");
  }

  // Layer 3: ownership — for mutations (DELETE / PATCH)
  if (requireOwner && !canMutateEntry(data, telegramId)) {
    throw new EntryAccessError(403, "Forbidden");
  }

  return data as EntryRow;
}

/**
 * Встреча-запись для действия над ней — с правами встречи, а не записи.
 *
 * Правило — `_shared/entries/meeting-rights.ts` (решение владельца 30.09.2026): общую встречу
 * правят владелец, участники (по e-mail из `metadata.attendees`) и админ, удаляют — владелец
 * и админ; личную — только владелец, без обхода для админа.
 *
 * Коды — как у getEntrySecure: 404, если встречи нет, она в чужом воркспейсе или невидима
 * (неотличимо); 403, если видна, но действие не разрешено.
 */
export async function getMeetingSecure(
  supabase: SupabaseClient,
  id: string,
  {
    groupId,
    telegramId,
    email,
    isAdmin = false,
    action,
  }: {
    groupId: string;
    telegramId: number;
    email?: string | null;
    isAdmin?: boolean;
    action: MeetingAction;
  },
): Promise<EntryRow> {
  // Видимость и воркспейс — общим гардом (он же даёт неотличимый 404).
  const entry = await getEntrySecure(supabase, id, { groupId, telegramId });
  const viewer = { id: telegramId, email, isAdmin };
  if (!canActOnMeeting(entry, viewer, action)) {
    throw new EntryAccessError(403, "Forbidden");
  }
  return entry;
}

/**
 * Start a list query against entries with both security filters pre-applied.
 *
 * ALWAYS use this instead of a direct select on the entries table
 * in list endpoints — it bakes in workspace isolation + visibility filter
 * + the archive filter (archived entries are invisible everywhere, #569).
 *
 * Usage:
 *   const { data } = await buildEntriesQuery(supabase, "id, content, summary", { groupId, telegramId })
 *     .order("created_at", { ascending: false })
 *     .limit(50);
 */
export function buildEntriesQuery(
  supabase: SupabaseClient,
  select: string,
  { groupId, telegramId }: { groupId: string; telegramId: number },
  // `count: "exact"` — чтобы списочный ответ мог честно сказать, что он обрезан (issue #112).
  // Считает ТОТ ЖЕ запрос, без второго round-trip: PostgREST возвращает число рядом с данными.
  opts?: { count?: "exact" },
) {
  return onlyLiveEntries(
    supabase
      .from("entries")
      .select(select, opts?.count ? { count: opts.count } : undefined),
  )
    .eq("group_id", groupId)
    .or(entryVisibilityOr(telegramId));
}

/**
 * Очередь ВЫЧИТКИ (несогласованные встречи) — отдельное правило видимости.
 *
 * Обычный `buildEntriesQuery` пускает всё, что «не приватное». Для несогласованной встречи это
 * неверно: `read-ai-webhook` создаёт её без `is_private` и без `owner_id` (дефолт колонки —
 * `false`, владелец пустой), поэтому она проходила фильтр У КАЖДОГО и висела в очереди всего
 * воркспейса — согласовать или удалить её мог человек, которого на встрече не было (issue #66).
 *
 * Правило (решение владельца 2026-08-22): «не должно быть ничьих — вся информация принадлежит
 * кому-то; если встреча была общая, показывать на вычитке всем участникам, сохранит тот, кто
 * успеет». Значит причастность = владелец записи ЛИБО участник встречи.
 *
 * Участие определяем по e-mail в `metadata.attendees` — это надёжный ключ, в отличие от имён:
 * на проде сматчились 27 встреч из 27, у которых участники вообще заполнены. Регистр в данных
 * нижний (проверено), поэтому e-mail нормализуем к нижнему и сравниваем containment'ом.
 *
 * Нет e-mail у пользователя → остаётся только владение (fail-closed): лучше не показать свою
 * встречу, чем показать чужую.
 */
export function buildReviewQueueQuery(
  supabase: SupabaseClient,
  select: string,
  { groupId, telegramId, email }: {
    groupId: string;
    telegramId: number;
    email?: string | null;
  },
) {
  const mine = `owner_id.eq.${telegramId}`;
  const clean = (email ?? "").trim().toLowerCase();
  // PostgREST: containment по jsonb-массиву объектов. Кавычки внутри значения экранируем, а
  // сам e-mail пропускаем через простую валидацию — в фильтр не должно попасть ничего, кроме
  // адреса (запятая или скобка сломали бы разбор всего условия .or()).
  const safeEmail = /^[^\s,()"']+@[^\s,()"']+$/.test(clean) ? clean : "";
  const cond = safeEmail ? `${mine},metadata->attendees.cs.[{"email":"${safeEmail}"}]` : mine;
  return onlyLiveEntries(
    supabase
      .from("entries")
      .select(select),
  )
    .eq("group_id", groupId)
    .or(cond);
}
