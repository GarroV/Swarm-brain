import { dictionaries } from "./catalog.generated";
import { createDictionaryRuntime } from "./runtime";
export { legacyTranslation } from "./runtime";

/** Generated locale discovery adds a dictionary without changing providers or routes. */
export const getDictionaryTranslator = createDictionaryRuntime(dictionaries);
