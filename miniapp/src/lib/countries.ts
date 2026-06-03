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
