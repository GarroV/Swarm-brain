import en from "./mcp-oauth-en";
import ru from "./mcp-oauth-ru";

const locales = { en, ru };
export type McpOAuthLanguage = keyof typeof locales;
export function mcpOAuthMessages(language: string) {
  return locales[language as McpOAuthLanguage] ?? locales.en;
}
