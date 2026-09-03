// Контекст созвона для панели заметок рекордера (issue #226): «что было в прошлый раз».
//
// Решения владельца 03.09.2026:
//   • «эта сторона = эта страна» — прошлое ищем по рынку встречи, а не по участникам;
//   • «тезисы последней встречи» — одна последняя запись, не подборка;
//   • задачи и тезисы — РАЗНЫЕ вещи и не соприкасаются (владелец, уточнение того же дня):
//     тезисы берутся у последней встречи, а задачи — у СТОРОНЫ (страны) текущего созвона.
//     Привязка задач к той найденной встрече была моей ошибкой: секция задач не должна
//     зависеть от того, какая запись нашлась для тезисов;
//   • «функционал нужен именно к регулярным встречам» — созвон с Болгарией → тезисы
//     прошлого созвона с Болгарией, чтобы по ним пройтись.
//
// Здесь только ЧИСТАЯ логика: выбор страны и нарезка превью. Запросы к базе — в
// functions/meeting-context. LLM тут нет и не нужен: тезисы и задачи уже в базе.
import { pickSuggestedMarkets } from "./market-suggest.ts";

export const PREVIEW_LIMITS = {
  /** Сколько заголовков разделов показать в свёрнутом виде. */
  sections: 4,
  /** Сколько первых пунктов показать. Панель узкая (312 pt) — больше не читается. */
  bullets: 3,
  /** Длина одного пункта в превью. Обрезаем по слову, а не по символу. */
  bulletChars: 90,
  /** Потолок полного текста в ответе. Тезисы на проде: в среднем 7 КБ, максимум 24 КБ. */
  fullChars: 20_000,
} as const;

export type TezisyPreview = {
  /** Заголовки разделов («### Тема») — оглавление встречи. */
  sections: string[];
  /** Первые пункты, уже обрезанные по длине. */
  bullets: string[];
  /** Сколько пунктов всего — чтобы подписать «12 пунктов», а не врать длиной превью. */
  totalBullets: number;
  /** Полный текст (для раскрытия), не длиннее fullChars. */
  fullText: string;
  /** Полный текст пришлось обрезать. Клиент обязан это показать (правило issue #112). */
  truncated: boolean;
};

/**
 * Страна («сторона») созвона. Приоритет сигналов — тот же, что у подсказки рынка на вычитке
 * (`pickSuggestedMarkets`): название встречи, затем общий рынок участников. Своей копии
 * правила здесь нет намеренно — иначе рекордер и веб начнут расходиться в том, что считают
 * рынком встречи.
 *
 * `null` — страну определить не удалось (или кандидатов больше одного = кросс-маркет).
 * Гадать нельзя: показать «прошлый созвон» не той страны хуже, чем не показать ничего.
 */
export function contextCountry(title: string | null, participantMarkets: string[][]): string | null {
  const { markets } = pickSuggestedMarkets({ title, participantMarkets, notesMarkets: [] });
  return markets.length === 1 ? markets[0] : null;
}

// Обрезка по слову: «…спрос выше мощ…» читается как сбой, поэтому режем по границе слова.
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

/**
 * Нарезка тезисов на превью для узкой панели. Тезисы — markdown вида
 * «### Тема» + «- пункт» (формат из `_shared/tezisy-prompt.ts`).
 *
 * Считает СЕРВЕР, а не клиент: гнать 24 КБ на macOS ради двух строк незачем, а клиент
 * без разметки всё равно не знает, где кончается пункт.
 */
export function tezisyPreview(markdown: string | null | undefined): TezisyPreview {
  const text = (markdown ?? "").trim();
  if (!text) return { sections: [], bullets: [], totalBullets: 0, fullText: "", truncated: false };

  const sections: string[] = [];
  const bullets: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s*/, "").trim();
      if (heading) sections.push(heading);
      continue;
    }
    // Дефис и звёздочка — оба написания встречаются в живых тезисах.
    if (line.startsWith("- ") || line.startsWith("* ")) {
      bullets.push(line.slice(2).trim());
      continue;
    }
    // Текст без разметки — тоже содержание встречи (старые записи, ручные правки).
    // Терять его нельзя: иначе панель покажет «0 пунктов» при непустых тезисах.
    if (sections.length === 0 && bullets.length === 0) bullets.push(line);
  }

  return {
    sections: sections.slice(0, PREVIEW_LIMITS.sections),
    bullets: bullets.slice(0, PREVIEW_LIMITS.bullets).map((b) => clip(b, PREVIEW_LIMITS.bulletChars)),
    totalBullets: bullets.length,
    fullText: text.slice(0, PREVIEW_LIMITS.fullChars),
    truncated: text.length > PREVIEW_LIMITS.fullChars,
  };
}
