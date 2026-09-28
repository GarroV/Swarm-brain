// Личность вызывающего в MCP берётся из токена коннектора (см. tools/call в index.ts:
// verified-токен перетирает любой requesting_user_id из аргументов). Поэтому агенту
// передавать её не нужно — а схемы инструментов исторически называли поле
// «Твой Telegram user ID — обязателен», и агент шёл искать номер, которого у него нет
// (issue #502). Схемы правятся здесь одним проходом, а не в 22 местах: новый инструмент
// с тем же полем получит верное описание автоматически.

/** Поля, которые сервер заполняет сам из токена. */
export const TOKEN_IDENTITY_FIELDS = ["requesting_user_id", "owner_telegram_id"] as const;

export const TOKEN_IDENTITY_DESCRIPTION =
  "Filled in automatically from your connector token — do not pass it. Use whoami to see who you are.";

// Схема описана широко: у полей бывают enum, items и прочее JSON Schema, их не трогаем.
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, object | undefined>;
    required?: string[];
  };
}

const isIdentityField = (field: string): boolean =>
  (TOKEN_IDENTITY_FIELDS as readonly string[]).includes(field);

/** Копия определения инструмента без требования передавать личность. Исходник не меняется. */
export function withTokenIdentity(tool: ToolDefinition): ToolDefinition {
  const props = tool.inputSchema.properties ?? {};
  const properties = Object.fromEntries(
    Object.entries(props).map(([key, prop]) =>
      isIdentityField(key) && prop ? [key, { ...prop, description: TOKEN_IDENTITY_DESCRIPTION }] : [key, prop]
    ),
  );
  const required = tool.inputSchema.required?.filter((field) => !isIdentityField(field));
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties,
      ...(required ? { required } : {}),
    },
  };
}
