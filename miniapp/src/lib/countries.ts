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
