import { createInstance } from "i18next";
import { validateCatalog } from "./validation.mjs";

type Form = "zero" | "one" | "two" | "few" | "many" | "other";
type Base<K extends string> = K extends `${infer B}_${Form}` ? B : K;
type Keys<E> = Base<keyof E & string>;
type Text<E, K extends string> = E[Extract<keyof E, K | `${K}_${Form}`>] & string;
type Variables<S extends string> = S extends `${string}{{${infer P}}}${infer Rest}` ? P | Variables<Rest> : never;
type Names<E, K extends Keys<E>> = Variables<Text<E, K>> | (`${K}_other` extends keyof E ? "count" : never);
type Values<E, K extends Keys<E>> = { [P in Names<E, K>]: P extends "count" ? number : string | number };
type Arguments<E, K extends Keys<E>> = [Names<E, K>] extends [never]
  ? [values?: Record<string, never>]
  : [values: Values<E, K>];
export type DictionaryTranslator<E> = <K extends Keys<E>>(key: K, ...args: Arguments<E, K>) => string;

/** Each translator is fixed to its language; rendering never mutates global language. */
export function createDictionaryRuntime<const E extends Record<string, string>>(
  catalog: { en: E } & Record<string, Record<string, string>>,
) {
  const metadata = validateCatalog(catalog);
  const resources = Object.fromEntries(Object.entries(catalog).map(([language, translation]) => [language, { translation }]));
  const instance = createInstance();
  let initializationError: unknown;
  void instance.init({
    resources,
    lng: "en",
    fallbackLng: "en",
    defaultNS: "translation",
    initAsync: false,
    keySeparator: false,
    nsSeparator: false,
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false, skipOnVariables: true },
  }, (error) => { initializationError = error; });
  if (initializationError || !instance.isInitialized) throw new Error("i18n: synchronous initialization failed");
  const languages = new Map(Object.keys(catalog).map((language) => [language.toLowerCase(), language]));
  const cache = new Map<string, DictionaryTranslator<E>>();
  return (language: string): DictionaryTranslator<E> => {
    const normalized = language.toLowerCase();
    const resolved = languages.get(normalized) ?? languages.get(normalized.split("-")[0]) ?? "en";
    const previous = cache.get(resolved);
    if (previous) return previous;
    const fixed = instance.getFixedT(resolved, "translation");
    const translate = ((key: string, values: Record<string, unknown> = {}) => {
      if (!Object.hasOwn(metadata, key)) throw new Error(`i18n: unknown key ${key}`);
      const specification = metadata[key];
      const actual = Object.keys(values).sort();
      if (JSON.stringify(actual) !== JSON.stringify(specification.parameters)) throw new Error(`i18n: parameters ${key}`);
      for (const value of Object.values(values)) {
        if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) throw new Error(`i18n: invalid value ${key}`);
      }
      if (specification.plural && typeof values.count !== "number") throw new Error(`i18n: numeric count ${key}`);
      const result = fixed(key, { replace: values, ...(specification.plural ? { count: values.count as number } : {}) });
      if (typeof result !== "string") throw new Error(`i18n: non-string result ${key}`);
      return result;
    }) as DictionaryTranslator<E>;
    cache.set(resolved, translate);
    return translate;
  };
}

/** Compatibility until a section is migrated; user-content interpolation stays in callers. */
export function legacyTranslation(language: string, ru: string, en: string): string {
  return language === "en" ? en : ru;
}
