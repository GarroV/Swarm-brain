export const EMPLOYEE_REPORT_TOOL_DEFINITIONS = [{
  name: "get_employee_report",
  description:
    "Конфиденциальный отчёт по сотруднику или всем сотрудникам пространства за период. Только для администраторов. Возвращает ответ без сохранения в общую базу. Не публикуй и не сохраняй результат без явного запроса; сохранение допускается только с is_private=true.",
  inputSchema: {
    type: "object",
    properties: {
      date_from: { type: "string", description: "Первый день периода, YYYY-MM-DD (UTC)" },
      date_to: { type: "string", description: "Последний день включительно, YYYY-MM-DD (UTC); максимум 92 дня" },
      employee_id: {
        type: "number",
        description: "Внутренний ID из get_users; без него — все участники текущего пространства",
      },
    },
    required: ["date_from", "date_to"],
  },
}];
