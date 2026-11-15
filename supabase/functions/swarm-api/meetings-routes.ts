import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEntriesQuery, buildReviewQueueQuery, ENTRY_COLUMNS, ENTRY_LIST_COLUMNS } from "./entries-guard.ts";
import {
  applyListFilters,
  applyMeetingsCursor,
  ENTRY_LIGHT_COLUMNS,
  hasListFilters,
  parseMeetingsListParams,
  toLightRow,
} from "./meetings-list.ts";
import { toListRow } from "./meetings-payload.ts";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";

export type MeetingAttributionRow = { id?: string; owner_id?: number | null; metadata?: unknown };
export type ImporterNames = <T extends MeetingAttributionRow>(
  rows: T[],
  fallback?: Map<string, number>,
) => Promise<Array<T & { importer_name: string | null }>>;
export type MeetingsRouteContext = {
  supabase: SupabaseClient;
  groupId: string;
  telegram_id: number;
  userEmail?: string | null;
  origin: string;
  withImporterNames: ImporterNames;
};

/** Existing list behavior and permissions; keyset is additive to legacy offset callers. */
export async function handleMeetingsList(url: URL, context: MeetingsRouteContext): Promise<Response> {
  const { supabase, groupId, telegram_id, userEmail, origin, withImporterNames } = context;

  const confirmedParam = url.searchParams.get("confirmed");
  // Лимит настраиваемый (?limit=), дефолт 500 — прежний хардкод 50 обрезал список «Все встречи»
  // (у команды уже 60+ встреч только за 2 недели). Потолок 2000 — защита от гигантского payload.
  // ?light=1 — лёгкие строки постранично (meetings-list.ts): по 50, ?offset=, фильтры
  // ?q= ?from= ?to= ?storage=. Без light=1 ответ прежний (бот/MCP/старые вкладки не задеты).
  const lp = parseMeetingsListParams(url.searchParams, { def: 500, max: 2000 });
  if (lp.cursorError) return apiErr(400, "Invalid meeting cursor", origin);
  const limit = lp.limit;
  // Несогласованные (очередь вычитки) — по причастности: владелец ИЛИ участник встречи.
  // Обычный фильтр видимости тут не годится: «ничья» неприватная встреча из read-ai висела
  // бы в очереди у всего воркспейса (issue #66). Согласованные — обычное правило.
  // Очередь вычитки (единицы строк) — без light текст нужен сразу и целиком (ENTRY_COLUMNS);
  // с light — лёгкие колонки, полный текст экран берёт по id.
  // Большой список — превью из базы (ENTRY_LIST_COLUMNS): 230 встреч × полный транскрипт =
  // ~10 МБ в браузер (issue #102), а выбирать полный текст ради 400 символов стоило 654 мс
  // базы против 15 мс (issue #490). Форму ответа приводит toListRow/toLightRow ниже.
  const isReviewQueue = confirmedParam === "false";
  const listColumns = lp.light ? ENTRY_LIGHT_COLUMNS : ENTRY_LIST_COLUMNS;
  const baseList = () =>
    buildEntriesQuery(supabase, listColumns, {
      groupId,
      telegramId: telegram_id,
    }, { count: "exact" })
      .eq("entry_type", "meeting");
  let q = (isReviewQueue
    ? buildReviewQueueQuery(supabase, lp.light ? ENTRY_LIGHT_COLUMNS : ENTRY_COLUMNS, {
      groupId,
      telegramId: telegram_id,
      email: userEmail,
    }).eq("entry_type", "meeting")
    : baseList())
    // id — tie-breaker: без него строки с одним created_at (импорт пачкой) могут поменяться
    // местами между страницами, и offset-пагинация теряет или дублирует встречи.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(lp.offset, lp.offset + limit - 1);
  if (confirmedParam === "true") {
    q = q.eq("metadata->>confirmed", "true");
  }
  if (confirmedParam === "false") {
    q = q.or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false");
  }
  // Фильтры экрана — только у списка согласованных; очередь вычитки (единицы строк)
  // клиент фильтрует сам.
  if (!isReviewQueue) q = applyListFilters(q, lp);
  q = applyMeetingsCursor(q, lp);
  const { data, error, count } = await q;
  if (error) return serverError(origin, "meetings list", error);
  const rows = (data ?? []) as unknown as Array<
    { id: string; owner_id?: number | null; metadata?: unknown }
  >;
  // «Кто записал» часто не продублирован в metadata записи, но есть в связанной строке meetings
  // (recorders — источник истины). Подтягиваем как фолбэк атрибуции для ВСЕХ встреч (прошлых и новых).
  const recMap = new Map<string, number>();
  if (rows.length) {
    const { data: mrows } = await supabase
      .from("meetings").select("entry_id, recorders")
      .in("entry_id", rows.map((r) => r.id));
    for (
      const m of (mrows ?? []) as Array<
        {
          entry_id: string | null;
          recorders: Array<{ telegram_id?: number | string }> | null;
        }
      >
    ) {
      const raw = m.recorders?.[0]?.telegram_id;
      const tg = typeof raw === "number" ? raw : (typeof raw === "string" && /^-?\d+$/.test(raw) ? Number(raw) : null);
      if (m.entry_id && tg !== null) recMap.set(m.entry_id, tg);
    }
  }
  const named = await withImporterNames(rows, recMap);
  // Сколько встреч подходит под фильтр БЕЗ лимита (issue #112). У очереди вычитки счёта нет:
  // buildReviewQueueQuery считает причастность в два запроса, и число там соврало бы.
  // Лёгкий режим: ещё и «сколько встреч всего БЕЗ фильтров экрана» — для «Показано N из M».
  // Фильтров нет — это тот же count; есть — лёгкий второй запрос на одну строку.
  let unfiltered = count;
  if (lp.light && !isReviewQueue && (hasListFilters(lp) || lp.cursor)) {
    let uq = baseList().order("created_at", { ascending: false }).limit(1);
    if (confirmedParam === "true") uq = uq.eq("metadata->>confirmed", "true");
    const { count: all, error: uErr } = await uq;
    if (uErr) return serverError(origin, "meetings list total", uErr);
    unfiltered = all;
  }
  const headers: Record<string, string> = { "X-Meeting-Keyset": "1" };
  if (count != null) headers["X-Total-Count"] = String(count);
  if (unfiltered != null) headers["X-Unfiltered-Count"] = String(unfiltered);
  const shape = lp.light ? toLightRow : (isReviewQueue ? (r: unknown) => r : toListRow);
  return json(
    (named as unknown[]).map((r) => (shape as (r: unknown) => unknown)(r)),
    200,
    origin,
    headers,
  );
}
