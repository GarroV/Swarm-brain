// meeting-dedup — единый кросс-источниковый дедуп встреч (Granola / рекордер / Read.ai / др.).
//
// Зачем: одна и та же встреча попадает в базу повторно — у каждого участника Granola свой
// note_id, рекордер и Granola могут принести ту же встречу из разных источников, повторный
// импорт/паблиш плодит дубли. Точечные механизмы (granola_note_id, meeting_id, race-guard на
// entry_id) ловят только дубли ВНУТРИ одного источника и не видят мульти-участничьи/кросс-
// источниковые. Этот хелпер — общий слой ПОВЕРХ них.
//
// Сигнал дубля (проверен на реальных prod-данных): та же дата + СИЛЬНОЕ пересечение участников
// + близкое время. Калибровка важна — на реальных данных нашёлся ложный дубль: 1-1
// «Maria / Aleksandra» (08:00, 2 чел.) и большая «CVM IMF» (08:15, 14 чел.) делят одного
// человека (Aleksandra) → по «overlap≥1 + ±15мин» склеились бы, хотя это РАЗНЫЕ встречи.
// Поэтому:
//   • overlap ≥ 2 И overlap ≥ половины меньшего списка участников — настоящие дубли Granola
//     несут ИДЕНТИЧНЫЙ список (один календарный инвайт у всех участников), ложные — делят 1–2;
//   • время ±5 минут (а не ±15): заметки одного события у Granola имеют ОДИН scheduled_start_time
//     (Δ=0), 5 минут — лишь запас на рекордер (started_at ≈ запланированного) и округление.
// «1-1» в 09:00 и в 10:00 с тем же человеком — РАЗНЫЕ встречи (время разводит). Точный хэш
// набора участников НЕ годится: у разных участников списки различаются → нужен overlap, не равенство.
//
// Уклон в ТОЧНОСТЬ, а не полноту: лучше пропустить дубль (его видно и можно убрать), чем по ошибке
// проглотить настоящую новую встречу (это потеря данных).
//
// Без новых колонок: кандидаты берём по entry_date (он индексирован — idx_entries_date), время
// и участников парсим из их content ("Дата: …, HH:MM" + "Участники: …") и из metadata.attendees
// (рекордер кладёт структурно). Работает и против уже существующих записей — бэкфилл не нужен.

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOLERANCE_MIN = 5;
const MAX_CANDIDATES = 40;

export type MeetingAttendee = { name?: string; email?: string };

/** Нормализация имени/почты участника для сравнения. */
export function normName(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Имена участников из массива {name?,email?} → нормализованный список без пустых. */
export function attendeeNames(attendees: MeetingAttendee[] | null | undefined): string[] {
  return (attendees ?? [])
    .map((a) => normName(a?.name || a?.email || ""))
    .filter(Boolean);
}

/** Минуты от полуночи из "HH:MM" или ISO-строки; null если не распознать. */
export function toMinutes(v: string | null | undefined): number | null {
  if (!v) return null;
  const hhmm = String(v).match(/\b(\d{1,2}):(\d{2})\b/);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  const dt = new Date(v);
  return isNaN(dt.getTime()) ? null : dt.getUTCHours() * 60 + dt.getUTCMinutes();
}

/** Парс времени (мин от полуночи) и участников из текста встречи: "Дата: …, HH:MM" + "Участники: a, b". */
export function parseMeetingContent(content: string | null | undefined): {
  minutes: number | null;
  attendees: string[];
} {
  const c = content ?? "";
  const dline = c.match(/Дата:[^\n]*?(\d{1,2}:\d{2})/);
  const aline = c.match(/Участники:\s*([^\n]+)/i);
  const attendees = aline ? aline[1].split(/[,;]/).map(normName).filter(Boolean) : [];
  return { minutes: dline ? toMinutes(dline[1]) : null, attendees };
}

export type DedupIncoming = {
  groupId: string;
  /** YYYY-MM-DD — день встречи (как в entries.entry_date). */
  entryDate: string | null;
  /** ISO-строка или "HH:MM" начала встречи; null если неизвестно. */
  startedAt?: string | null;
  /** Участники встречи (структурно из источника). */
  attendees: MeetingAttendee[];
  /**
   * Стабильный ключ идентичности встречи (meetings.identity_key: календарное событие + день).
   * Если задан И у входящей, И у кандидата (metadata.identity_key) — решает однозначно:
   * равны → одна встреча (дубль); различаются → РАЗНЫЕ встречи (не склеивать, даже при
   * полном совпадении состава). Без ключа хотя бы у одной стороны — эвристика по составу+времени.
   */
  identityKey?: string | null;
  /** Не считать дублем эту запись (например, при перепроверке самой себя). */
  excludeId?: string;
  /**
   * Кто спрашивает (telegram_id). Чужие ЛИЧНЫЕ встречи в кандидаты не попадают — фильтр здесь,
   * а не на совести вызывающего (issue #45: из четырёх мест фильтровало одно, остальные светили
   * заголовок/id чужой личной встречи и выбрасывали входящую как «дубль» невидимого).
   *
   * `undefined` — системный вызов без конкретного пользователя (вебхук): отбрасываются ВСЕ
   * приватные кандидаты. Fail-closed: лучше завести дубль общей встречи, чем потерять входящую
   * или подтвердить существование чужой личной.
   */
  viewerId?: number | null;
};

export type DedupMatch = {
  id: string;
  title: string;
  source: string;
  isPrivate: boolean;
  ownerId: number | null;
};

// Кандидат на дубль из БД (entries).
type Candidate = {
  id: string;
  content: string | null;
  source: string | null;
  is_private: boolean | null;
  owner_id: number | null;
  metadata: (Record<string, unknown> & { attendees?: MeetingAttendee[]; title?: string; identity_key?: string }) | null;
};

/**
 * Ищет уже существующую запись-встречу того же дня.
 * Сначала — гейт по identity_key (см. DedupIncoming.identityKey): если ключ есть у обеих сторон,
 * он решает однозначно (равны → дубль, различаются → разные встречи). Если ключа нет — эвристика:
 * пересечение участников + близкое время. Возвращает первое совпадение или null. Консервативен:
 * без даты или без участников у входящей — не дедупит (риск ложно склеить новую встречу выше риска дубля).
 */
export async function findDuplicateMeeting(
  supabase: SupabaseClient,
  inc: DedupIncoming,
): Promise<DedupMatch | null> {
  const incAtt = attendeeNames(inc.attendees);
  if (!inc.entryDate || incAtt.length === 0) return null;
  const incSet = new Set(incAtt);
  const incMin = toMinutes(inc.startedAt);
  const incKey = inc.identityKey || null;

  const { data, error } = await supabase
    .from("entries")
    .select("id, content, source, is_private, owner_id, metadata")
    .eq("entry_type", "meeting")
    .eq("group_id", inc.groupId)
    .eq("entry_date", inc.entryDate)
    .limit(MAX_CANDIDATES);
  if (error || !data) return null;

  // Чужое личное вообще не участвует в сопоставлении — ни как совпадение, ни как повод отбросить
  // входящую встречу. Отбор здесь, до всей логики матчинга: так его нельзя «забыть» в очередном
  // вызывающем, чем и был вызван issue #45.
  const visible = (data as Candidate[]).filter(
    (c) => !c.is_private || (inc.viewerId != null && c.owner_id === inc.viewerId),
  );

  const toMatch = (c: Candidate): DedupMatch => ({
    id: c.id,
    title: (c.metadata?.title as string) || "Встреча",
    source: c.source || "unknown",
    isPrivate: c.is_private ?? false,
    ownerId: c.owner_id ?? null,
  });

  for (const c of visible) {
    if (inc.excludeId && c.id === inc.excludeId) continue;

    // Гейт по identity_key — сильнейший сигнал для встреч с календарным событием (рекордер).
    // Тот же event в тот же день у двух рекордеров → ИДЕНТИЧНЫЙ ключ → одна встреча (дубль).
    // Разные события того же дня (даже с идентичным составом — регулярные командные созвоны)
    // → РАЗНЫЕ ключи → РАЗНЫЕ встречи, склеивать нельзя. Именно отсутствие этого гейта
    // схлопнуло 4 разные встречи IMF BD 23.07 в одну запись: у записей рекордера в content
    // нет строки "Дата: …, HH:MM", гейт по времени отваливался, и дедуп склеивал по одному
    // пересечению состава. Ключ есть только у обеих сторон — иначе падаем в эвристику ниже.
    const candKey = (c.metadata?.identity_key as string | undefined) || null;
    if (incKey && candKey) {
      if (incKey === candKey) return toMatch(c);
      continue;
    }

    const parsed = parseMeetingContent(c.content);
    const metaAtt = attendeeNames(c.metadata?.attendees);
    const candAtt = new Set([...parsed.attendees, ...metaAtt]);

    let overlap = 0;
    for (const a of incSet) if (candAtt.has(a)) overlap++;

    // Сильное пересечение: ≥2 человек И ≥ половины меньшего списка. Отсекает ложные дубли,
    // где разные встречи делят одного-двух человек; настоящие дубли несут идентичный состав.
    const small = Math.min(incSet.size, candAtt.size);
    const strong = overlap >= 2 && overlap >= Math.ceil(0.5 * small);
    if (!strong) continue;

    const candMin = parsed.minutes;
    if (incMin != null && candMin != null) {
      // Время известно у обоих: дубль только если близко по времени; иначе — другая встреча.
      if (Math.abs(incMin - candMin) <= TOLERANCE_MIN) return toMatch(c);
      continue;
    }
    // Время неизвестно хотя бы у одного — полагаемся на сильное совпадение состава.
    return toMatch(c);
  }
  return null;
}
