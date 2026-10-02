// Реестр источников «Анализа рынка» — docs/market/SOURCES.md собирается отсюда из конфигов стран
// и описаний адаптеров, руками файл не правится. Обновить:
//   deno run -A scripts/market/sources-doc.ts > docs/market/SOURCES.md
// Тест sources-doc.test.ts падает, если документ отстал от конфигов.
import { ADAPTERS } from "./adapters/index.ts";
import { COUNTRIES } from "./countries/index.ts";
import type { CountryConfig } from "./countries/types.ts";

const FEED: Record<string, string> = {
  locations: "Точки",
  financials: "Выручки юрлиц",
  dodo: "Продажи Dodo",
  prices: "Цены",
  facts: "Факты рынка",
  editorial: "Ручная часть",
};
const MODE: Record<string, string> = {
  auto: "авто",
  manual: "вручную",
  blocked: "заблокирован",
};
const CADENCE: Record<string, string> = {
  weekly: "раз в неделю",
  monthly: "раз в месяц",
  yearly: "раз в год",
  manual: "по запросу",
};
const NAMES: Record<string, string> = {
  HR: "Хорватия",
  RO: "Румыния",
  EE: "Эстония",
  RS: "Сербия",
  SI: "Словения",
  BG: "Болгария",
  ME: "Черногория",
};

const cell = (s: string | undefined | null) =>
  (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ") || "—";

function country(c: CountryConfig): string {
  const out = [`## ${c.country} — ${NAMES[c.country] ?? c.country}`, ""];
  out.push(
    "| Что | Откуда | Что именно | Как | Частота | Сверено |",
    "|---|---|---|---|---|---|",
  );
  for (const s of c.sources) {
    const a = ADAPTERS[s.adapter];
    const what = [s.chain ? `сеть ${s.chain}` : null, s.note ?? a?.about.what]
      .filter(Boolean).join(": ");
    const how = s.adapter === "manual"
      ? MODE[s.mode]
      : `${MODE[s.mode]}, \`${s.adapter}\``;
    out.push(
      `| ${FEED[s.feeds] ?? s.feeds} | ${
        cell((s.url ?? a?.about.url)?.replace("<код страны>", c.dodoCode))
      } | ${cell(what)}${s.reason ? ` (${cell(s.reason)})` : ""} | ${how} | ${
        CADENCE[s.cadence]
      } | ${cell(s.checked)} |`,
    );
  }
  out.push(
    "",
    "Сети (теги OSM — по ним ищет `osm-overpass`; пусто — сети в OSM нет, точки из других источников):",
    "",
  );
  out.push("| Ключ | Сеть | Сегмент | Теги brand в OSM |", "|---|---|---|---|");
  for (const ch of c.chains) {
    out.push(
      `| \`${ch.key}\` | ${cell(ch.name)} | ${ch.segment}${
        ch.bakery ? ", пекарня" : ""
      } | ${cell(ch.osmBrands?.join(", "))} |`,
    );
  }
  if (c.companies.length) {
    out.push(
      "",
      "Юрлица операторов (по рег. номеру их ищут адаптеры реестров):",
      "",
      "| Сеть | Юрлицо | Рег. номер |",
      "|---|---|---|",
    );
    for (const co of c.companies) {
      out.push(`| ${cell(co.chain)} | ${cell(co.name)} | ${co.regId} |`);
    }
  }
  return out.join("\n");
}

export function renderSources(): string {
  const head = [
    "<!-- Генерируется: deno run -A scripts/market/sources-doc.ts > docs/market/SOURCES.md. Руками не править — правится конфиг страны (scripts/market/countries/<CC>.ts) или описание адаптера (about). -->",
    "# Реестр источников «Анализа рынка»",
    "",
    "Что, откуда и как часто собирается по каждой стране. Строки «авто» гоняет сборщик по расписанию (`scripts/market/run.ts`), строки «вручную» — ручная заливка снимком; у них в колонке «Сверено» — дата, когда человек последний раз проверял, что источник жив и формат не поменялся. Как добавить страну — [README](README.md).",
  ];
  return [head.join("\n"), ...Object.values(COUNTRIES).map(country)].join(
    "\n\n",
  ) + "\n";
}

if (import.meta.main) {
  Deno.stdout.writeSync(new TextEncoder().encode(renderSources()));
}
