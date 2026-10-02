// Подсказка рынков для экрана вычитки встречи (issue #73).
//
// Зачем: раньше рынок записи выставлял ТОЛЬКО авто-классификатор, молча, в момент публикации —
// человек его не видел и не мог поправить. Отсюда перетег дайджеста чужими странами
// (docs/BACKLOG.md, «страны»): встреча про Венгрию приезжала в раздел Сербии. Теперь рынок
// ставит человек, а система лишь ПОДСКАЗЫВАЕТ — и подсказка обязана быть высокоточной:
// режим мягкий (публикация проходит с тем, что в чипах), поэтому пере-предложенное уедет
// в базу как есть. Лучше не предложить ничего, чем предложить лишнее.
//
// Приоритет сигналов (первый сработавший побеждает, они НЕ складываются):
//   1. Название встречи — «Dodo Pizza Bulgaria», «Wolt Bulgaria with …». У рекордера так
//      названо большинство встреч, и это прямое указание рынка, а не упоминание.
//   2. Пересечение рынков участников (user_profiles.markets). Пересечение, а не объединение:
//      общий рынок у всех = про него и встреча; у объединения на HQ-созвоне пол-Балкан.
//   3. Тезисы через обычный классификатор (COUNTRY_PROMPT_RULE) — слабейший сигнал, он же
//      исторический источник перетега, поэтому только когда первых двух нет.
// Ничего не сработало → пусто: это «Общее», а не повод угадать рынок.
import { ALIASES, detectAliasCountries, normalizeCountries } from "./countries.ts";
import { specificCountries } from "./meta-extract.ts";

export type MarketSource = "title" | "participants" | "notes";
export interface MarketSuggestion {
  markets: string[];
  source: MarketSource | null;
}

export interface MarketSignals {
  title: string | null;
  /** Рынки каждого участника, у кого они заданы в профиле (по одному массиву на человека). */
  participantMarkets: string[][];
  /** Что вернул классификатор по тезисам (может быть в любом виде: ISO, «Bulgaria», «Хорватия»). */
  notesMarkets: string[];
}

// Автоматика предлагает МАКСИМУМ ОДИН рынок — тот же порог, что у applyGeneralSentinel
// (ровно 1 рынок → тег; 0 или ≥2 → General; решение владельца 2026-08-06, переподтверждено
// 2026-08-28). Раньше здесь стояло 2, и комментарий рядом врал про «тот же порог»: подсказка
// легально предлагала ДВА рынка, публикация писала их как есть — кросс-маркетная встреча
// получала два страновых тега и всплывала в дайджесте обеих стран (issue #167, живой случай
// 26.08: «IT+BD» уехала с ['RS','BG']). Два кандидата = кросс-маркет: предлагать нечего.
const MAX_SUGGESTED = 1;

/** Все страны, названные в заголовке встречи прямо. Одна — рынок встречи; несколько —
 *  кросс-маркет. Одно правило для подсказки на вычитке и для контекста рекордера. */
export function titleCountries(title: string | null | undefined): string[] {
  return title ? detectAliasCountries(title, ALIASES) : [];
}

export function pickSuggestedMarkets(signals: MarketSignals): MarketSuggestion {
  // Две и больше страны в названии («Сербия и Хорватия») = кросс-маркет: предлагать нечего,
  // и к участникам за догадкой не идём — название уже ответило. Раньше брали первое самое
  // длинное совпадение, и такая встреча молча становилась HR (issue #449).
  const fromTitle = titleCountries(signals.title);
  if (fromTitle.length === 1) return { markets: fromTitle, source: "title" };
  if (fromTitle.length > 1) return { markets: [], source: null };

  const lists = signals.participantMarkets
    .map((m) => normalizeCountries(specificCountries(m)))
    .filter((m) => m.length > 0);
  if (lists.length > 0) {
    const shared = lists.reduce((acc, list) => acc.filter((c) => list.includes(c)));
    if (shared.length > 0 && shared.length <= MAX_SUGGESTED) {
      return { markets: shared, source: "participants" };
    }
  }

  const fromNotes = normalizeCountries(specificCountries(signals.notesMarkets));
  if (fromNotes.length > 0 && fromNotes.length <= MAX_SUGGESTED) {
    return { markets: fromNotes, source: "notes" };
  }

  return { markets: [], source: null };
}
