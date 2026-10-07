// Шаблон отчёта «Анализ рынка» по стране: разделы экрана сверху вниз, что их питает (сборщик
// сам или ручной ввод), форма каждого блока с примером. Отдаётся инструментом MCP
// market_template — по нему модель в Claude Desktop знает, что и в какой форме вносить.
// Тест template.test.ts держит шаблон в согласии с EDITORIAL_BLOCKS: блок без раздела или
// пример, который не проходит проверку, валят прогон.
// Линт просит короткое имя из карты импортов; см. пояснение в sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { allRows, must } from "./db.ts";
import type { EditorialBlock } from "./editorial.ts";

export type BlockSpec = { what: string; example: unknown };
export type Section = {
  id: string;
  title: string;
  /** Что приходит само: сборщики по расписанию. */
  auto: string;
  /** Чем вносить руками (инструменты MCP). */
  manual: string;
  blocks: Partial<Record<EditorialBlock, BlockSpec>>;
};

export const SECTIONS: readonly Section[] = [
  {
    id: "header",
    title: "Шапка и ключевые цифры",
    auto: "число точек, сетей, открытий — считается из карты; дата сборки — по последнему автосбору",
    manual: "market_set_block header / kpis",
    blocks: {
      header: {
        what: "заголовок отчёта: eyebrow, title, lede (2–3 предложения о рынке), sources (строка источников)",
        example: {
          eyebrow: "Рынок QSR",
          title: "Болгария",
          lede: "Рынок держат McDonald's и KFC…",
          sources: "OSM, Търговски регистър",
        },
      },
      kpis: {
        what: "до 4 плиток поверх вычисленных: value, label, note",
        example: [{ value: "€59 млн", label: "выручка McDonald's 2024", note: "Търговски регистър" }],
      },
    },
  },
  {
    id: "summary",
    title: "Сводка и подзаголовки",
    auto: "—",
    manual: "market_set_block summary / texts",
    blocks: {
      summary: {
        what: "карточки сводки: title, big (крупная цифра), text",
        example: [{ title: "Лидер", big: "39", text: "точек McDonald's, рост на 5 за год" }],
      },
      texts: {
        what: "подзаголовки разделов: { <раздел>: текст }",
        example: { map: "Сети стоят в Софии, Пловдиве и Варне", money: "Выручки по годовым отчётам" },
      },
    },
  },
  {
    id: "map",
    title: "Карта и реестр точек",
    auto: "OpenStreetMap еженедельно (новые и пропавшие точки), API Dodo (пиццерии Dodo)",
    manual: "market_upsert_chain — новая сеть; market_upsert_location — добавить, поправить, закрыть точку; " +
      "market_set_block map_presets",
    blocks: {
      map_presets: {
        what: "кнопки приближения карты: name, box [долгота0, широта0, долгота1, широта1]",
        example: [{ name: "София", box: [23.2, 42.6, 23.45, 42.75] }],
      },
    },
  },
  {
    id: "timeline",
    title: "Открытия, закрытия, динамика сетей",
    auto: "даты появления точек из OSM и API Dodo",
    manual: "market_upsert_location (opened / closed) или market_set_block location_dates / events / growth",
    blocks: {
      location_dates: {
        what: "уточнённые даты открытия: name (как у точки), opened, note",
        example: [{ name: "Dodo Pizza Mall Sofia", opened: "2023-04-12", note: "пресс-релиз" }],
      },
      events: {
        what: "события рынка: date, kind (open/close/entry/exit/deal), chain, text",
        example: [{ date: "2024-03", kind: "entry", chain: "popeyes", text: "Popeyes открыл первый ресторан" }],
      },
      growth: {
        what: "динамика сетей: keys (сети), notes { сеть: текст }, hist { сеть: { год: число точек } }",
        example: {
          keys: ["mcdonalds"],
          notes: { mcdonalds: "по сайту сети" },
          hist: { mcdonalds: { "2021": 35, "2025": 41 } },
        },
      },
    },
  },
  {
    id: "pizza",
    title: "Пицца-сети: таблица, Dodo, цены, оценки",
    auto: "продажи и заказы Dodo — публичный API еженедельно",
    manual: "market_set_price — цена позиции; market_set_block pizza_table / prices_cols / basket / ops_model / " +
      "ratings / dodo_monthly / dodo_ops",
    blocks: {
      pizza_table: {
        what:
          "таблица пицца-сетей: name, chain, units, entry (год входа), rev { период: € }, per { период: € на точку }, lfl, note",
        example: [{
          name: "Domino's",
          chain: "dominos",
          units: 12,
          entry: 2016,
          rev: { "2024": 9000000 },
          per: {},
          lfl: null,
          note: "",
        }],
      },
      prices_cols: {
        what: "колонки сравнения цен: title, chain, channel, cm (размер), exclude",
        example: [{ title: "Dodo", chain: "dodo", channel: "delivery", cm: 30 }],
      },
      basket: {
        what: "корзина: col (сеть), one, two, promo — цены в €",
        example: [{ col: "Dodo", one: 9.5, two: 17, promo: "2 по цене 1 во вторник" }],
      },
      ops_model: {
        what: "как работают сети: chains [ключи], rows [[подпись, значение по каждой сети…]]",
        example: { chains: ["dodo", "dominos"], rows: [["Своя доставка", "да", "да"]] },
      },
      ratings: {
        what: "оценки: chain, point, city, google (оценка), reviews (число отзывов), wolt",
        example: [{ chain: "dodo", point: "Dodo Lozenets", city: "София", google: 4.6, reviews: 812, wolt: 9.2 }],
      },
      dodo_monthly: {
        what: "продажи Dodo по месяцам из внутренней выгрузки: m (ГГГГ-ММ), usd, fx, eur, units, per",
        example: [{ m: "2025-09", usd: 120000, fx: 0.86, eur: 103200, units: 4, per: 25800 }],
      },
      dodo_ops: {
        what: "операции Dodo по каналам из выгрузки Dodo IS: m, u, rev, agg, din, own, o, oagg, odin, oown",
        example: [{
          m: "2025-09",
          u: 4,
          rev: 103200,
          agg: 30000,
          din: 20000,
          own: 53200,
          o: 5100,
          oagg: 1500,
          odin: 1100,
          oown: 2500,
        }],
      },
    },
  },
  {
    id: "delivery",
    title: "Доставка и факты рынка",
    auto: "—",
    manual: "market_set_block delivery_platforms / delivery_figures / market_facts",
    blocks: {
      delivery_platforms: {
        what: "платформы доставки: name, slot (цвет), note, years [{ year, revenue_eur }]",
        example: [{ name: "Glovo", slot: 1, note: "лидер", years: [{ year: 2024, revenue_eur: 40000000 }] }],
      },
      delivery_figures: {
        what: "плитки доставки: big, text",
        example: [{ big: "62%", text: "заказов через агрегаторы" }],
      },
      market_facts: {
        what: "факты рынка: big, text, source",
        example: [{ big: "€1,2 млрд", text: "оборот общепита 2024", source: "https://www.nsi.bg/…" }],
      },
    },
  },
  {
    id: "money",
    title: "Деньги: выручки операторов",
    auto: "реестры юрлиц, где они открыты бесплатно (Хорватия, Сербия, Словения…), раз в год",
    manual: "market_set_company_year — выручка юрлица за год; market_set_block money_rows — порядок строк",
    blocks: {
      money_rows: {
        what: "строки раздела: prefix (подпись), chains [ключи] или null, company (юрлицо)",
        example: [{ prefix: "Бургеры", chains: ["mcdonalds", "burgerking"] }],
      },
    },
  },
];

const fmtExample = (v: unknown) => JSON.stringify(v);

/** Текст шаблона для агента: разделы, источники, блоки с примерами, общие правила. */
export function templateText(): string {
  const parts = SECTIONS.map((s) => {
    const blocks = Object.entries(s.blocks).map(([b, spec]) =>
      `  • ${b} — ${spec!.what}\n    пример: ${fmtExample(spec!.example)}`
    );
    return [`## ${s.title} [${s.id}]`, `Само: ${s.auto}`, `Руками: ${s.manual}`, ...blocks].join("\n");
  });
  return [
    "# Шаблон отчёта «Анализ рынка» по стране",
    "Правила: у каждой записи источник (ссылка на документ или «внутренняя выгрузка Dodo»); прибыль и убыток не вносятся; " +
    "деньги — в евро или в валюте с фиксированным курсом (BGN, HRK), пересчёт сделает Swarm. Блок market_set_block " +
    "заменяется целиком: сперва market_get, потом запись полного блока. Сборщики работают дальше и проверенное руками " +
    "не перетирают.",
    ...parts,
  ].join("\n\n");
}

// ── Что заполнено по стране ─────────────────────────────────────────────────

type SourceRow = { adapter: string; chain_key: string; feeds: string; mode: string; last_ok_at: string | null };

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "никогда");

export async function countryStatus(sb: SupabaseClient, cc: string): Promise<string> {
  const country = cc.toUpperCase();
  const head = (table: string) => sb.from(table).select("*", { count: "exact", head: true }).eq("country", country);
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string) => {
    const { count, error } = await q;
    if (error) throw new Error(`${what}: ${error.message}`);
    return count ?? 0;
  };
  const [chains, locs, manualLocs, prices, cos] = await Promise.all([
    count(head("mkt_chains"), "chains"),
    count(head("mkt_locations").neq("status", "closed"), "locations"),
    count(head("mkt_locations").in("source_kind", ["manual", "snapshot"]), "manual locations"),
    count(head("mkt_prices"), "prices"),
    allRows<{ id: string }>(
      (a, b) => sb.from("mkt_companies").select("id").eq("country", country).range(a, b),
      "companies",
    ),
  ]);
  const ids = cos.map((c) => c.id);
  const years = ids.length
    ? (await must<{ company_id: string }[]>(
      sb.from("mkt_financials").select("company_id").in("company_id", ids).not("revenue_eur", "is", null),
      "financials",
    )).length
    : 0;
  const blocks = new Map(
    (await must<{ block: string; updated_at: string }[]>(
      sb.from("mkt_editorial").select("block, updated_at").eq("country", country),
      "editorial",
    )).map((b) => [b.block, b.updated_at]),
  );
  const sources = await must<SourceRow[]>(
    sb.from("mkt_sources").select("adapter, chain_key, feeds, mode, last_ok_at").eq("country", country),
    "sources",
  );
  const feed = (f: string) =>
    sources.filter((s) => s.feeds === f).map((s) =>
      `${s.mode === "auto" ? "само" : s.mode === "manual" ? "руками" : "закрыт"} ${s.adapter}${
        s.chain_key ? `/${s.chain_key}` : ""
      }: ${day(s.last_ok_at)}`
    ).join("; ") || "источников нет";

  const lines = [
    `# ${country}: что заполнено`,
    `Сети: ${chains}. Открытых точек: ${locs} (из них внесено руками или снимком: ${manualLocs}). Точки — ${
      feed("locations")
    }.`,
    `Деньги: юрлиц ${cos.length}, лет с выручкой ${years}. Выручки — ${feed("financials")}.`,
    `Цены: ${prices}. ${feed("prices")}. Dodo — ${feed("dodo")}.`,
  ];
  for (const s of SECTIONS) {
    const names = Object.keys(s.blocks);
    if (!names.length) continue;
    const marks = names.map((b) => blocks.has(b) ? `✓ ${b} (${day(blocks.get(b))})` : `— ${b}`);
    lines.push(`${s.title}: ${marks.join(", ")}`);
  }
  return lines.join("\n");
}
