export function getHelpText(): string {
  return (
    "<b>Swarm Brain</b>\n\n" +
    "Просто пиши — бот сам поймёт что делать:\n" +
    "• Вопрос → найдёт ответ в базе знаний\n" +
    "• Информация/заметка → сохранит в базу\n\n" +
    "<b>Медиа (обрабатывается автоматически):</b>\n" +
    "🎤 Голосовые — транскрибация\n" +
    "📎 Файлы (PDF, Excel, TXT, CSV) — извлечение текста\n" +
    "🖼 Фото — описание через ИИ\n" +
    "🔗 Ссылки — загрузка содержимого\n\n" +
    "<b>Команды:</b>\n" +
    "/add [текст] — принудительно сохранить запись\n" +
    "/ask [вопрос] — принудительно спросить\n" +
    "/tasks — активные задачи команды\n" +
    "/meetings — список встреч и транскрипты\n" +
    "/status — состояние системы\n" +
    "/reset — сбросить состояние бота\n" +
    "/help — эта справка\n\n" +
    "<b>Управление командой:</b>\n" +
    "/users — список пользователей\n" +
    "/users add @username или [telegram_id]\n" +
    "/users remove @username или [telegram_id]\n" +
    "/users profile [telegram_id]\n\n" +
    "<b>Claude Desktop — подключение MCP:</b>\n" +
    "Settings → Developer → Add MCP Server\n" +
    "URL: <code>https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-mcp</code>"
  );
}