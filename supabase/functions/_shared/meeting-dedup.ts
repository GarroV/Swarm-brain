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
// Окно для сигнала «публикующий есть в участниках кандидата»: шире базового (рекордер стартует
// не ровно в :00), но заметно меньше, чем расстояние между разными встречами одного человека.
const ATTENDEE_TOLERANCE_MIN = 10;
const MAX_CANDIDATES = 40;

// Пространства имён identity_key. Ключ описывает НЕ встречу, а то, как её увидел клиент:
//   • calendar (`<event-id>:<дата>`) и комнаты (`meet:`/`kontur:`/…) — ОБЩИЕ у всех участников:
//     два рекордера одного события дают идентичный ключ, поэтому их сравнение осмысленно;
//   • `granola:<note_id>` и `manual:…` — ПЕРСОНАЛЬНЫЕ: у каждого участника свой, сравнивать
//     их бессмысленно (именно из-за этого модуль и написан).
// Гейт по ключу применяется ТОЛЬКО когда оба ключа из одной ОБЩЕЙ схемы. Раньше он срабатывал
// на любой паре непустых ключей и отключал кросс-источниковый дедуп целиком (issue #164):
// `granola:not_X` и `<event>@google.com:дата` не совпадут никогда, и функция уходила в continue
// до всякой эвристики. Так одна встреча «IT+BD» 26.08 легла в базу тремя записями.
const SHARED_KEY_SCHEMES = new Set(["meet", "kontur", "ktalk", "zoom", "teams", "webex"]);
const PERSONAL_KEY_SCHEMES = new Set(["granola", "manual", "readai"]);

/** Схема ключа: известный префикс до ':' либо "calendar" (`<event-id>:<дата>` — общий у всех). */
export function keyScheme(key: string): string {
  const i = key.indexOf(":");
  if (i > 0) {
    const p = key.slice(0, i).toLowerCase();
    if (SHARED_KEY_SCHEMES.has(p) || PERSONAL_KEY_SCHEMES.has(p)) return p;
  }
  return "calendar";
}

/** Ключи сравнимы, только если из одной ОБЩЕЙ (не персональной) схемы. */
export function comparableKeys(a: string, b: string): boolean {
  const sa = keyScheme(a);
  if (sa !== keyScheme(b)) return false;
  return !PERSONAL_KEY_SCHEMES.has(sa);
}

// Заголовок как сигнал идентичности. Нормализация — только буквы/цифры в нижнем регистре:
// «настоящий рабочий  мит!» === «Настоящий рабочий мит». Проверено на проде 2026-08-28:
// одноимённых РАЗНЫХ встреч в один день нет ни одной, поэтому окно времени сигналу не нужно
// (Granola подключается к созвону позже начала — разрыв доходил до 25 минут).
const GENERIC_TITLES = new Set([
  "встреча", "встречи", "созвон", "звонок", "meeting", "call", "newmeeting", "11", "1on1",
  "untitled", "безназвания", "конференция",
]);

export function normTitle(t: string | null | undefined): string {
  return (t ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Заголовок ничего не опознаёт: пусто, дефолт клиента («Встреча») или слишком короткий. */
export function isGenericTitle(t: string | null | undefined): boolean {
  const n = normTitle(t);
  return n.length < 4 || GENERIC_TITLES.has(n);
}

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

/**
 * Минуты от полуночи (UTC) из даты-времени или из «HH:MM» в тексте; null если не распознать.
 *
 * Порядок разбора важен. Раньше сначала пробовался regex по «HH:MM», и на строке PostgREST
 * «2026-08-26T12:01:36+00:00» он хватал НЕ часы с минутами, а минуты с секундами: перед «12»
 * стоит буква T, границы слова там нет, поэтому первым совпадением становилось «01:36» → 96
 * вместо 721. Ошибка молчаливая (число правдоподобное), а на ней держатся все окна времени в
 * дедупе: сигнал состава ±5 минут сравнивал мусор с мусором. Поэтому дату-время разбираем
 * первым делом через Date, а regex оставляем для текста встречи («Дата: 19.06.2026, 09:00»).
 */
export function toMinutes(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v);
  if (/\d{4}-\d{2}-\d{2}/.test(s)) {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt.getUTCHours() * 60 + dt.getUTCMinutes();
  }
  const hhmm = s.match(/(\d{1,2}):(\d{2})/);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  const dt = new Date(s);
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
   * Название встречи. Второй по силе сигнал после общего ключа: у повторяющихся созвонов
   * («IT+BD», «CEE biweekly sync») все источники несут одно и то же название, а участников
   * Granola не отдаёт вовсе. Дефолтные названия («Встреча», «1-1») сигналом не считаются.
   */
  title?: string | null;
  /**
   * E-mail того, кто публикует. Единственный сигнал для записи из комнаты (Контур.Толк/Meet):
   * у неё нет ни названия, ни участников — но сам записавший есть в attendees календарной
   * записи той же встречи. Применяется только к безымянной входящей и в узком окне времени,
   * иначе склеили бы встречу, на которую человек лишь приглашён.
   */
  viewerEmail?: string | null;
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
  metadata: (Record<string, unknown> & { attendees?: MeetingAttendee[]; title?: string; identity_key?: string; meeting_id?: string }) | null;
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
  // Без даты сопоставлять нечего. Пустой список участников у входящей раньше означал выход в
  // первой же строке — а именно так приходят записи Granola и записи из комнаты (у них
  // attendees нет вовсе), то есть половина реальных дублей отбрасывалась до всякой проверки.
  // Теперь работают сигналы, не зависящие от состава (название, участие публикующего).
  if (!inc.entryDate) return null;
  if (incAtt.length === 0 && isGenericTitle(inc.title) && !inc.viewerEmail) return null;
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

  // Время кандидатов из meetings.started_at. Без этого запроса время записей РЕКОРДЕРА неизвестно:
  // строки «Дата: …, HH:MM» в их content нет (её пишет только бот-путь), а именно на времени
  // держатся окна всех сигналов состава. Один запрос на вызов; meeting_id-не-uuid (ULID из
  // бот-импорта Granola) отфильтрован — иначе PostgREST падает на приведении типа.
  const startedByEntry = new Map<string, string>();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const mids = visible
    .map((c) => (c.metadata?.meeting_id ?? "") as string)
    .filter((m) => uuidRe.test(m));
  if (mids.length > 0) {
    const { data: mrows } = await supabase.from("meetings").select("id, started_at").in("id", mids);
    const byId = new Map<string, string>();
    for (const m of (mrows ?? []) as Array<{ id: string; started_at: string | null }>) {
      if (m.started_at) byId.set(m.id, m.started_at);
    }
    for (const c of visible) {
      const mid = (c.metadata?.meeting_id ?? "") as string;
      const st = byId.get(mid);
      if (st) startedByEntry.set(c.id, st);
    }
  }

  const incTitleN = normTitle(inc.title);
  const incTitleUsable = !isGenericTitle(inc.title);
  const viewerEmail = (inc.viewerEmail ?? "").trim().toLowerCase();

  const toMatch = (c: Candidate): DedupMatch => ({
    id: c.id,
    title: (c.metadata?.title as string) || "Встреча",
    source: c.source || "unknown",
    isPrivate: c.is_private ?? false,
    ownerId: c.owner_id ?? null,
  });

  for (const c of visible) {
    if (inc.excludeId && c.id === inc.excludeId) continue;

    // Гейт по identity_key — сильнейший сигнал, но ТОЛЬКО для сравнимых ключей (одна общая
    // схема: два рекордера одного календарного события или одной комнаты). Тот же ключ → одна
    // встреча; разные ключи одной общей схемы → РАЗНЫЕ встречи, даже при идентичном составе
    // (регулярные командные созвоны — именно так слиплись 4 встречи IMF BD 23.07).
    // Ключи из разных пространств (`granola:` ↔ календарь ↔ `kontur:`) или из персональной
    // схемы гейтом НЕ разводятся: они не совпадут никогда и раньше глушили весь дедуп (#164).
    const candKey = (c.metadata?.identity_key as string | undefined) || null;
    if (incKey && candKey && comparableKeys(incKey, candKey)) {
      if (incKey === candKey) return toMatch(c);
      continue;
    }

    const parsed = parseMeetingContent(c.content);
    const metaAtt = attendeeNames(c.metadata?.attendees);
    const candAtt = new Set([...parsed.attendees, ...metaAtt]);
    const candMin = toMinutes(startedByEntry.get(c.id)) ?? parsed.minutes;
    const gap = incMin != null && candMin != null ? Math.abs(incMin - candMin) : null;

    // Сигнал 1 — сильное пересечение состава: ≥2 человек И ≥ половины меньшего списка. Отсекает
    // ложные дубли, где разные встречи делят одного-двух человек; настоящие дубли несут
    // идентичный состав. Время известно у обоих → требуем близости, иначе полагаемся на состав.
    let overlap = 0;
    for (const a of incSet) if (candAtt.has(a)) overlap++;
    const small = Math.min(incSet.size, candAtt.size);
    if (overlap >= 2 && overlap >= Math.ceil(0.5 * small)) {
      if (gap == null || gap <= TOLERANCE_MIN) return toMatch(c);
    }

    // Сигнал 2 — идентичное название в один день. Единственное, что есть у Granola-записей:
    // участников она не отдаёт, а название у повторяющихся созвонов совпадает дословно.
    // Окна времени нет намеренно: Granola подключается позже начала (на проде до 25 минут),
    // а одноимённых РАЗНЫХ встреч в один день на проде не нашлось ни одной. Дефолтные и
    // короткие названия («Встреча», «1-1») сигналом не считаются — они не опознают ничего.
    if (incTitleUsable && incTitleN === normTitle(c.metadata?.title as string | undefined)) {
      return toMatch(c);
    }

    // Сигнал 3 — запись из комнаты: ни названия, ни участников, но записавший есть в участниках
    // календарной записи той же встречи (живой случай 26.08: у коллеги события в календаре не
    // было, рекордер опознал только комнату Контур.Толк). Только для БЕЗЫМЯННОЙ входящей и
    // только в узком окне: иначе склеили бы встречу, на которую человек лишь приглашён, с той,
    // где он реально был. Требуем известное время у обеих сторон — «в тот же день» тут мало.
    if (!incTitleUsable && viewerEmail && gap != null && gap <= ATTENDEE_TOLERANCE_MIN) {
      const candEmails = ((c.metadata?.attendees ?? []) as MeetingAttendee[])
        .map((a) => (a?.email ?? "").trim().toLowerCase())
        .filter(Boolean);
      if (candEmails.includes(viewerEmail)) return toMatch(c);
    }
  }
  return null;
}
