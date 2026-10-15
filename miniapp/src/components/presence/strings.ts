// Тексты полоски присутствия (RU/EN). Общей системы i18n в вебе нет (язык — useLang/useDt в
// roy/nav.ts), поэтому словарь маленький и лежит рядом. Подписи разделов и состояний — в
// lib/presenceStrip.ts, потому что их гоняют тесты.
import type { Lang } from "@/lib/presenceStrip";

const STRINGS = {
  ru: { strip: "Кто сейчас в SWARM" },
  en: { strip: "Who is in SWARM right now" },
} as const;

export function stripLabel(lang: Lang): string {
  return STRINGS[lang].strip;
}
