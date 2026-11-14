/** Dictionary validation is shared by generation, CI and the in-memory runtime. */
const variable = /\{\{([A-Za-z_][A-Za-z_0-9]*)\}\}/g;
const plural = /^(.*)_(zero|one|two|few|many|other)$/;
const own = (object, key) => Object.hasOwn(object, key);
const fail = (message) => { throw new Error(`i18n: ${message}`); };

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} text @returns {string[]} */
function variables(text) {
  const rest = text.replace(variable, "");
  if (rest.includes("{{") || rest.includes("}}")) fail("malformed placeholder");
  return [...new Set([...text.matchAll(variable)].map((match) => match[1]))].sort();
}

/** @param {Record<string, unknown>} messages @param {string} language */
function groups(messages, language) {
  /** @type {Record<string, {plural: boolean, forms: string[], variables: string[]}>} */
  const result = Object.create(null);
  for (const [key, text] of Object.entries(messages)) {
    if (!/^[a-z][A-Za-z0-9]*(?:[._][A-Za-z0-9]+)*$/.test(key)) fail(`invalid key ${key}`);
    if (typeof text !== "string" || !text.trim()) fail(`empty/non-string ${language}:${key}`);
    if (text.includes("$t(")) fail(`unsupported nesting syntax ${language}:${key}`);
    const match = key.match(plural), base = match?.[1] ?? key;
    const entry = result[base] ??= { plural: !!match, forms: [], variables: [] };
    if (entry.plural !== !!match) fail(`mixed plural/plain ${language}:${base}`);
    entry.forms.push(match?.[2] ?? "plain");
    const names = variables(text).filter((name) => !match || name !== "count");
    if (entry.forms.length > 1 && JSON.stringify(entry.variables) !== JSON.stringify(names)) {
      fail(`placeholder mismatch ${language}:${base}`);
    }
    entry.variables = names;
  }
  for (const [key, entry] of Object.entries(result)) {
    if (!entry.plural) continue;
    const required = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
    if (required.some((form) => !entry.forms.includes(form))) fail(`missing plural form ${language}:${key}`);
    if (entry.forms.some((form) => form !== "zero" && !required.includes(form))) fail(`invalid plural form ${language}:${key}`);
    entry.variables = [...new Set([...entry.variables, "count"])].sort();
  }
  return result;
}

/**
 * @param {unknown} catalog
 * @returns {Record<string, {plural: boolean, parameters: string[]}>}
 */
export function validateCatalog(catalog) {
  if (!object(catalog) || !own(catalog, "en") || !object(catalog.en)) fail("English catalog is required");
  const expected = groups(catalog.en, "en"), keys = Object.keys(expected).sort();
  if (!keys.length) fail("empty English catalog");
  for (const [language, messages] of Object.entries(catalog)) {
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) fail(`invalid language ${language}`);
    if (!object(messages)) fail(`invalid catalog ${language}`);
    const actual = groups(messages, language);
    if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(keys)) fail(`key mismatch ${language}`);
    for (const key of keys) {
      if (actual[key].plural !== expected[key].plural) fail(`plural mismatch ${language}:${key}`);
      if (JSON.stringify(actual[key].variables) !== JSON.stringify(expected[key].variables)) {
        fail(`placeholder mismatch ${language}:${key}`);
      }
    }
  }
  return Object.fromEntries(keys.map((key) => [key, { plural: expected[key].plural, parameters: expected[key].variables }]));
}
