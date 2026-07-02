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
  return COUNTRY_NAMES[code] ?? code;
}

// Обратный маппинг «русское имя → код» для легаси-записей, где хранится имя, а не код.
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
);

// Короткий ISO-код (alpha-2, uppercase) для компактного тега рынка. Значение уже код («GE»)
// → uppercase; русское имя («Грузия») → код через обратный маппинг; незнакомое → как есть.
export function countryCode(value: string): string {
  const up = value.toUpperCase();
  if (COUNTRY_NAMES[up]) return up;
  return NAME_TO_CODE[value.toLowerCase()] ?? value;
}
