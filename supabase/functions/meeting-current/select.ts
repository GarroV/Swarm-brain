// Выбор «текущего» события календаря среди перекрывающихся — Фаза A разрешения коллизий.
// Раньше был наивный `timed.find(start<=now<=end)` → детерминированно брал САМОЕ РАННЕЕ из
// перекрывающихся (напр. отклонённый олл-хендс вместо 1:1, где ты реально сидишь). Здесь —
// скоринг по сигналам, которые Google уже отдаёт: RSVP (accepted/tentative/declined), роль
// организатора, плотность окна. Отклонённые НЕ выкидываем жёстко (могут быть встречи, где ты
// declined, но присутствуешь) — только сильно депроритезируем. Cancelled/OOO(free)/all-day — прочь.
//
// Фаза B (near-deterministic привязка по ссылке комнаты, которую рекордер уже знает) — отдельно,
// поверх этого: room-match будет коротко замыкать скоринг, когда ID конференц-ссылки совпал.

export interface GEvent {
  id: string;
  iCalUID?: string;
  summary?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  transparency?: string; // "opaque" (занят) | "transparent" (свободен / OOO)
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  organizer?: { self?: boolean; email?: string };
  creator?: { self?: boolean };
  attendees?: Array<
    {
      displayName?: string;
      email?: string;
      self?: boolean;
      responseStatus?: string;
    }
  >;
}

// Балл события: выше = вероятнее «та самая» встреча. Сигналы язык-независимы и не требуют доп. API.
export function eventScore(e: GEvent): number {
  let s = 0;
  const self = (e.attendees ?? []).find((a) => a.self);
  switch (self?.responseStatus) {
    case "accepted":
      s += 3;
      break;
    case "tentative":
      s += 1;
      break;
    case "declined":
      s -= 3;
      break;
      // needsAction / нет attendees → 0 (нейтрально: часто ходишь без RSVP)
  }
  if (e.organizer?.self || e.creator?.self) s += 2;
  return s;
}

function startMs(e: GEvent): number {
  return Date.parse(e.start!.dateTime!);
}
function durationMs(e: GEvent): number {
  return Date.parse(e.end!.dateTime!) - startMs(e);
}

// Сортировка «лучший первым»: балл ↓, затем плотнее окно (короче) ↑, затем позже начатое ↑
// (только что присоединился), затем стабильный тай-брейк по id.
function betterFirst(a: GEvent, b: GEvent): number {
  const sd = eventScore(b) - eventScore(a);
  if (sd) return sd;
  const dd = durationMs(a) - durationMs(b);
  if (dd) return dd;
  const st = startMs(b) - startMs(a);
  if (st) return st;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Кандидаты — только реальные тайм-события (не all-day), не отменённые, не «свободен/OOO».
function isCandidate(e: GEvent): boolean {
  return !!(e.start?.dateTime && e.end?.dateTime) &&
    e.status !== "cancelled" &&
    e.transparency !== "transparent";
}

// Текущие события списком (D027): все ИДУЩИЕ сейчас — лучшее первым (по скорингу); идущих нет —
// все предстоящие в окне, ближайшее первым (для упреждающего «через N мин»). `keep` отсекает
// неподходящие ДО деления на идущие и предстоящие: идущий слот без ссылки не должен заслонять
// созвон, который начнётся через три минуты (D026).
export function currentEvents(
  items: GEvent[],
  nowMs: number,
  keep: (e: GEvent) => boolean = () => true,
): GEvent[] {
  const cand = items.filter((e) => isCandidate(e) && keep(e));
  const ongoing = cand.filter((e) => startMs(e) <= nowMs && nowMs <= Date.parse(e.end!.dateTime!));
  if (ongoing.length) return ongoing.slice().sort(betterFirst);
  return cand
    .filter((e) => startMs(e) > nowMs)
    .sort((a, b) => startMs(a) - startMs(b) || betterFirst(a, b));
}

// Одно событие — первое из списка: лучшее из идущих, иначе ближайшее предстоящее. null — пусто.
export function pickCurrentEvent(
  items: GEvent[],
  nowMs: number,
): GEvent | null {
  return currentEvents(items, nowMs)[0] ?? null;
}
