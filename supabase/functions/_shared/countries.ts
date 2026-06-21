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
};

export function normalizeCountry(raw: string): string | null {
  const trimmed = raw.trim();
  if (COUNTRY_NAMES[trimmed.toUpperCase()]) return trimmed.toUpperCase();
  return ALIASES[trimmed.toLowerCase()] ?? null;
}

export function normalizeCountries(raw: string[]): string[] {
  return [...new Set(raw.map(normalizeCountry).filter((c): c is string => c !== null))];
}

// ── Правила промпта-классификатора (DRY) ───────────────────────────────────────
// Один источник для всех GPT write-путей (swarm-bot, swarm-mcp, swarm-api). Раньше
// промпт дублировался в 5+ местах и расходился, из-за чего баг (страна-галлюцинация,
// note→meeting) жил везде. Важно: НЕ якорить примеры на одну страну (модель тянула
// незнакомый город на «знакомую» Сербию) и звать с temperature 0 + JSON-режимом.

export const COUNTRY_PROMPT_RULE =
  "countries — страны/рынки, ЯВНО упомянутые в тексте, короткими английскими названиями " +
  "(Serbia, Spain, Bulgaria, Moldova, Croatia, Slovenia, …). Город указывает на свою страну: " +
  "Сабадель/Барселона → Spain, Белград → Serbia, Варна → Bulgaria. Если страна/рынок в тексте явно " +
  "не названы — пустой массив []. НЕ угадывай страну и НЕ подставляй её по умолчанию.";

export const ENTRY_TYPE_PROMPT_RULE =
  'entry_type — "meeting" ТОЛЬКО если текст это расшифровка/тезисы реального созвона ' +
  "(участники, реплики, ход обсуждения встречи). Заметка, ссылка, документ, список, данные, " +
  'инструкция — это "note", даже если в тексте упоминается встреча.';
