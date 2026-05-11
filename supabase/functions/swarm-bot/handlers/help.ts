export function getHelpText(): string {
  const base =
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
    "/tasks — задачи\n" +
    "/status — состояние системы\n" +
    "/reindex — переиндексировать базу\n" +
    "/help — эта справка";

  return base +
    "\n\n<b>Управление пользователями:</b>\n/users list · /users add [id] · /users remove [id]\n/status · /reindex" +
    "\n\n<b>Claude Desktop — подключение:</b>\n" +
    "1. Settings → Developer → Add MCP Server\n" +
    "   Name: <code>swarm-brain</code>\n" +
    "   URL: <code>https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-mcp</code>\n" +
    "2. Projects → New Project → вставь инструкции из файла <code>SETUP_CLAUDE_DESKTOP.md</code>\n" +
    "3. Кидай транскрипты — Claude сохранит оригинал и сделает саммари автоматически";
}
