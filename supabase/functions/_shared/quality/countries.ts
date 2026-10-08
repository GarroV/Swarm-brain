// Страна в листе «Качество по пиццериям» → код ISO. Лист пишет страну по-английски, иногда с
// флагом («🇳🇬 Nigeria»), а объединённая ячейка приезжает в CSV с переводами строк вокруг имени.
// Словарь — общий `_shared/countries.ts`; здесь только снятие флага и написания из выгрузок
// рейтинга, которых в общем словаре нет (перенесено из Децимуса, src/ratings/countries.py).
import { normalizeCountry } from "../countries.ts";

const EXTRA: Record<string, string> = {
  "turkiye": "TR",
  "türkiye": "TR",
  "белоруссия": "BY",
  "kyrgyz republic": "KG",
};

// Флаг — пара региональных символов (категория So), эмодзи — So с селектором варианта U+FE0F
// и склейкой U+200D (Cf).
const EMOJI = /[\p{So}\p{Cf}️]/gu;

export function qualityCountryCode(raw: string): string | null {
  const key = raw.replace(EMOJI, "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();
  if (!key) return null;
  return EXTRA[key] ?? normalizeCountry(key);
}
