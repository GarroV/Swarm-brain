// Определения инструментов MCP — только данные, без обработчиков и клиента базы: тест аннотаций и tools/list
// грузят их, не втягивая в покрытие модули с логикой. Обработчики — в inspections.ts.

const ME = { type: "number", description: "Your Telegram user ID — scopes the result to your workspace" };

export const INSPECTION_TOOL_DEFINITIONS = [
  {
    name: "get_inspections",
    description:
      "Standards inspections of pizzerias (live from Decimus): date, pizzeria, score %, grade, change vs the previous " +
      "inspection of the same pizzeria, inspection id. Newest first. Default window: last 90 days. " +
      "Only countries of your workspace. Use get_inspection with the id for zones and violations.",
    inputSchema: {
      type: "object",
      properties: {
        country: { type: "string", description: "Country code, e.g. RS, BG (optional)" },
        from: { type: "string", description: "Window start, YYYY-MM-DD (default: 90 days ago)" },
        to: { type: "string", description: "Window end, YYYY-MM-DD (default: today)" },
        unit: { type: "string", description: "Part of the pizzeria name, case-insensitive (optional)" },
        requesting_user_id: ME,
      },
      required: ["requesting_user_id"],
    },
  },
  {
    name: "get_inspection",
    description:
      "One inspection in full: score and grade, deductions, change vs the previous one, zones with percentages, " +
      "violations (item code and title, class, zone, wording, repeat flag) and a link to the report in Decimus.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Inspection uuid from get_inspections" },
        requesting_user_id: ME,
      },
      required: ["id", "requesting_user_id"],
    },
  },
];
