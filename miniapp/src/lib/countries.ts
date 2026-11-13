export const COUNTRY_NAMES: Record<string, string> = {
  RS: "Сербия",  HR: "Хорватия",  SI: "Словения",  ME: "Черногория",
  BG: "Болгария", ES: "Испания",   RO: "Румыния",   PL: "Польша",
  EE: "Эстония", LT: "Литва",     CY: "Кипр",      HU: "Венгрия",
  MD: "Молдова",  BY: "Беларусь",  TR: "Турция",    AZ: "Азербайджан",
  AM: "Армения",  GE: "Грузия",    TJ: "Таджикистан", KG: "Кыргызстан",
  MN: "Монголия", NG: "Нигерия",   MX: "Мексика",   ID: "Бали/Индонезия",
  RU: "Россия",   UA: "Украина",   KZ: "Казахстан",
};

export function countryName(code: string): string {
  // Нормализуем вход (ISO / русское / английское имя → ISO), затем берём русское имя.
  return COUNTRY_NAMES[countryCode(code)] ?? code;
}

// Обратный маппинг «русское имя → код» для легаси-записей, где хранится имя, а не код.
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
);

// Английские имена стран → ISO-код: часть записей приходит с англ. именем («Bulgaria»),
// которое иначе показывалось бы целиком («BULGARIA») вместо компактного кода.
const ENGLISH_TO_CODE: Record<string, string> = {
  serbia: "RS", croatia: "HR", slovenia: "SI", montenegro: "ME",
  bulgaria: "BG", spain: "ES", romania: "RO", poland: "PL",
  estonia: "EE", lithuania: "LT", cyprus: "CY", hungary: "HU",
  moldova: "MD", belarus: "BY", turkey: "TR", azerbaijan: "AZ",
  armenia: "AM", georgia: "GE", tajikistan: "TJ", kyrgyzstan: "KG",
  mongolia: "MN", nigeria: "NG", mexico: "MX", indonesia: "ID",
  russia: "RU", ukraine: "UA", kazakhstan: "KZ",
};

// Короткий ISO-код (alpha-2, uppercase) для компактного тега рынка. Значение уже код («GE»)
// → uppercase; русское имя («Грузия») или английское («Georgia») → код через обратный маппинг;
// незнакомое → как есть.
export function countryCode(value: string): string {
  const up = value.toUpperCase();
  if (COUNTRY_NAMES[up]) return up;
  const low = value.toLowerCase();
  return NAME_TO_CODE[low] ?? ENGLISH_TO_CODE[low] ?? value;
}

// Эмодзи-флаг из ISO alpha-2 (регионально-индикаторные символы). Незнакомый код → "".
export function countryFlag(value: string): string {
  const code = countryCode(value).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + code.charCodeAt(0) - 65, A + code.charCodeAt(1) - 65);
}

// ── Несколько стран у задачи (issue #1262) ───────────────────────────────────────────────
// У задачи список ISO-кодов `countries`; `country` — серверное зеркало первой страны. Строка,
// пришедшая без `countries` (кэш до раскатки, узкая проекция), читается по старому `country`.
export type CountriesCarrier = { countries?: readonly string[] | null; country?: string | null };

/** Строка стран («HU», «Сербия», «RS, HU» — так хранили и так присылает разбор встречи) → коды без повторов. */
export function parseCountryList(raw: string | null | undefined): string[] {
  const codes = (raw ?? "").split(/[,;/]/).map((x) => x.trim()).filter((x) => x && x !== "—").map(countryCode);
  return codes.filter((c, i) => codes.indexOf(c) === i);
}

/** Коды стран задачи. Пустой список `countries` — «без страны», а не повод лезть в `country`. */
export function taskCountryCodes(t: CountriesCarrier): string[] {
  return t.countries ? [...t.countries] : parseCountryList(t.country);
}

/** Коды через « · »; больше трёх — первые два и «+N»: «HU · RS +2». */
export function countriesLabel(codes: readonly string[], maxShown = 3): string {
  if (codes.length <= maxShown) return codes.join(" · ");
  return `${codes.slice(0, maxShown - 1).join(" · ")} +${codes.length - (maxShown - 1)}`;
}

/** Код добавить в список или убрать, если он там уже есть (регистр кода не важен). */
export function toggleCountry(codes: readonly string[], code: string): string[] {
  const norm = countryCode(code);
  return codes.some((c) => countryCode(c) === norm) ? codes.filter((c) => countryCode(c) !== norm) : [...codes, norm];
}

/** Подсказка/доступное имя: «HU, RS» → «Венгрия, Сербия». */
export function countriesTitle(codes: readonly string[]): string {
  return codes.map(countryName).join(", ");
}

/** Что слать и что писать в строку локально, когда список стран задачи поменялся. */
export function countriesPatch(codes: readonly string[]): { countries: string[]; country: string | null } {
  return { countries: [...codes], country: codes[0] ?? null };
}
