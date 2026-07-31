export const COUNTRY_NAMES: Record<string, string> = {
  RS: "Сербия",
  HR: "Хорватия",
  SI: "Словения",
  ME: "Черногория",
  BG: "Болгария",
  ES: "Испания",
  RO: "Румыния",
  PL: "Польша",
  EE: "Эстония",
  LT: "Литва",
  CY: "Кипр",
  HU: "Венгрия",
  MD: "Молдова",
  BY: "Беларусь",
  TR: "Турция",
  AZ: "Азербайджан",
  AM: "Армения",
  GE: "Грузия",
  TJ: "Таджикистан",
  KG: "Кыргызстан",
  MN: "Монголия",
  NG: "Нигерия",
  MX: "Мексика",
  ID: "Бали/Индонезия",
  RU: "Россия",
  UA: "Украина",
  KZ: "Казахстан",
  UZ: "Узбекистан",
  AE: "ОАЭ",
  IN: "Индия",
  CH: "Швейцария",
};

const ALIASES: Record<string, string> = {
  "сербия": "RS", "serbia": "RS",
  "хорватия": "HR", "croatia": "HR",
  "словения": "SI", "slovenia": "SI",
  "черногория": "ME", "montenegro": "ME",
  "болгария": "BG", "bulgaria": "BG",
  "испания": "ES", "spain": "ES", "(испания)": "ES",
  "румыния": "RO", "romania": "RO",
  "польша": "PL", "poland": "PL",
  "эстония": "EE", "estonia": "EE",
  "литва": "LT", "lithuania": "LT",
  "кипр": "CY", "cyprus": "CY",
  "венгрия": "HU", "hungary": "HU",
  "молдова": "MD", "moldova": "MD",
  "беларусь": "BY", "belarus": "BY",
  "турция": "TR", "turkey": "TR",
  "азербайджан": "AZ", "azerbaijan": "AZ",
  "армения": "AM", "armenia": "AM",
  "грузия": "GE", "georgia": "GE",
  "таджикистан": "TJ", "tajikistan": "TJ",
  "кыргызстан": "KG", "kyrgyzstan": "KG",
  "монголия": "MN", "mongolia": "MN",
  "нигерия": "NG", "nigeria": "NG",
  "мексика": "MX", "mexico": "MX",
  "бали": "ID", "bali": "ID", "индонезия": "ID", "indonesia": "ID",
  "россия": "RU", "russia": "RU",
  "украина": "UA", "ukraine": "UA",
  "казахстан": "KZ", "kazakhstan": "KZ",
  "узбекистан": "UZ", "uzbekistan": "UZ",
  "оаэ": "AE", "uae": "AE", "эмираты": "AE", "united arab emirates": "AE",
  "индия": "IN", "india": "IN",
  "швейцария": "CH", "switzerland": "CH",
};

export function normalizeCountry(raw: string): string | null {
  const trimmed = raw.trim();
  if (COUNTRY_NAMES[trimmed.toUpperCase()]) return trimmed.toUpperCase();
  return ALIASES[trimmed.toLowerCase()] ?? null;
}

export function normalizeCountries(raw: string[]): string[] {
  return [...new Set(raw.map(normalizeCountry).filter((c): c is string => c !== null))];
}

// Детект страны в свободном тексте запроса → ISO (первое/самое длинное совпадение) или null.
// Тот же словарь, что при ингесте → термин в запросе («Болгария»/«Bulgaria») маппится в тот же
// тег, что стоит на записях. Используется поиском для буста по стране (см. match_entries_hybrid).
// Русские названия СКЛОНЯЮТСЯ (Сербия → Сербии/Сербией/Сербию), а точное сравнение их не ловило
// → страна в запросе не детектилась → фильтр/буст по стране молчал на нормальных запросах
// («дай встречу с Сербией»). Поэтому кириллический алиас матчим по СТЕМУ (без финальной гласной) +
// падежное окончание из ЗАКРЫТОГО набора: ловит все склонения, но «индикатор»/«грузить» НЕ ловятся
// (их хвост — не падежное окончание). Латиница не склоняется → префикс (serbia→serbian). Стем ≥4.
const RU_CASE_END = "(?:ами|ями|ей|ой|ом|ем|ах|ях|ам|ям|ов|а|я|ы|и|е|у|ю)?";
const RU_VOWEL_END = /[аеёиоуыэюя]$/;
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function queryCountryRegex(alias: string): RegExp {
  if (/[а-яё]/.test(alias)) {
    const stem = RU_VOWEL_END.test(alias) ? alias.slice(0, -1) : alias;
    // Короткий стем (<4) склоняем не пытаемся — риск ложных совпадений; точное сравнение с границами.
    if (stem.length >= 4) {
      return new RegExp(`(?<![\\p{L}])${escapeRe(stem)}${RU_CASE_END}(?![\\p{L}])`, "iu");
    }
    return new RegExp(`(?<![\\p{L}])${escapeRe(alias)}(?![\\p{L}])`, "iu");
  }
  // латиница: префикс (serbia → serbian/serbias), левая граница по букве
  return new RegExp(`(?<![\\p{L}])${escapeRe(alias)}[a-z]*`, "iu");
}

export function detectQueryCountry(text: string): string | null {
  const t = (text ?? "").toLowerCase();
  // Длинные алиасы первыми: «united arab emirates» раньше «uae»; «индонезия» раньше «индия».
  const aliases = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (queryCountryRegex(alias).test(t)) return ALIASES[alias];
  }
  return null;
}

// ── Правила промпта-классификатора (DRY) ───────────────────────────────────────
// Один источник для всех GPT write-путей (swarm-bot, swarm-mcp, swarm-api). Раньше
// промпт дублировался в 5+ местах и расходился, из-за чего баг (страна-галлюцинация,
// note→meeting) жил везде. Важно: НЕ якорить примеры на одну страну (модель тянула
// незнакомый город на «знакомую» Сербию) и звать с temperature 0 + JSON-режимом.

export const COUNTRY_PROMPT_RULE =
  "countries — страны/рынки, которые являются ПРЕДМЕТОМ записи (обсуждение, решения, новости, " +
  "проблемы ПО этому рынку), короткими английскими названиями (Serbia, Spain, Bulgaria, Moldova, " +
  "Croatia, Slovenia, Montenegro, …). Город указывает на свою страну: Сабадель/Барселона → Spain, " +
  "Белград → Serbia, Варна → Bulgaria, Подгорица/Бар/Будва → Montenegro. " +
  "СОСЕДНИЕ БАЛКАНСКИЕ РЫНКИ — РАЗНЫЕ СТРАНЫ, НЕ ПУТАЙ: Черногория (Montenegro) ≠ Сербия (Serbia) ≠ " +
  "Хорватия (Croatia) ≠ Словения (Slovenia). Если встреча про Черногорию — тег Montenegro, а НЕ Serbia; " +
  "не подставляй «знакомого соседа» вместо реального рынка. ВАЖНО: НЕ тегируй страну, которая лишь " +
  "упомянута вскользь или к которой относятся только участники/команда/ПОСТАВЩИК (напр. «сербский " +
  "производитель игровой», «поставщик из …», «карты как в России») — нужна суть про рынок, а не " +
  "упоминание. Если запись о СКВОЗНОЙ/общей теме (инструменты, ИТ, процессы, обучение, демо, " +
  "методология) и не привязана к конкретному рынку — пустой массив []. Если страна/рынок явно не " +
  "предмет — []. НЕ угадывай и НЕ подставляй страну по умолчанию. " +
  "1:1/личные синки и HQ/международные/региональные обзоры без привязки к ОДНОМУ рынку → [] " +
  "(станет тегом General). ПЕРЕЧИСЛЕНИЕ/сравнение/список стран в одном пункте (напр. allowlist " +
  "соседей «разрешены: Румыния, Сербия, Хорватия») — НЕ делает их предметом, НЕ тегируй их. " +
  "Максимум 1–2 рынка-предмета; насчитал больше — это кросс-маркет, верни [].";

export const ENTRY_TYPE_PROMPT_RULE =
  'entry_type — "meeting" ТОЛЬКО если текст это расшифровка/тезисы реального созвона ' +
  "(участники, реплики, ход обсуждения встречи). Заметка, ссылка, документ, список, данные, " +
  'инструкция — это "note", даже если в тексте упоминается встреча.';
