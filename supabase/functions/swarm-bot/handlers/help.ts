// Справка бота. Главный экран — компактный (повседневное). Детальные настройки (рекордер,
// Granola, Claude Desktop, база, команда) спрятаны за inline-кнопки (callback help_<topic>) и
// открываются правкой того же сообщения на месте (editInlineMessage), с кнопкой «‹ Назад».
// Веб-приложение называется Swarm (не «Рой»).

const WEB_URL = "https://swarm-brain.pages.dev";

type Btn = { text: string; callback_data: string };

export function getHelpText(): string {
  return (
    "<b>Swarm — справка</b>\n\n" +
    `🌐 <b>Swarm</b> — веб-приложение: задачи, встречи, база знаний, поиск.\n` +
    `🔗 ${WEB_URL} — вход через Telegram, ставится как приложение (Dock / экран «Домой»).\n\n` +
    "<b>Бот на каждый день:</b>\n" +
    "• Пиши текст · 🎤 голос · 📎 файл · 🖼 фото · 🔗 ссылку — сохраню в базу (или отвечу на вопрос)\n" +
    "• /ask [вопрос] — спросить базу · /status — статистика\n" +
    "• /meetings — встречи на вычитку (Read.ai / Granola / рекордер прилетают сами)\n" +
    "• /tasks — задачи · /addtask — создать\n\n" +
    "<i>Подключения и настройка — кнопками ниже 👇</i>\n" +
    "/feedback — фидбек · /reset — сброс"
  );
}

// Главное меню справки (inline). Рекордер — отдельной широкой строкой (главный сценарий).
export function helpKeyboard(): Btn[][] {
  return [
    [{ text: "🎙 Рекордер встреч (Mac)", callback_data: "help_recorder" }],
    [{ text: "📓 Granola", callback_data: "help_granola" }, { text: "🖥 Claude Desktop", callback_data: "help_mcp" }],
    [{ text: "📥 База знаний", callback_data: "help_kb" }, { text: "👥 Команда", callback_data: "help_team" }],
  ];
}

const BACK: Btn[] = [{ text: "‹ Назад к справке", callback_data: "help_main" }];

const TOPICS: Record<string, string> = {
  recorder:
    "<b>🎙 Рекордер встреч (Mac)</b>\n\n" +
    "Приложение в меню-баре пишет звук созвона → сервер делает расшифровку и тезисы → встреча появляется в /meetings (на вычитке).\n\n" +
    "<b>1. Установить</b>\n" +
    "/recordertoken → бот пришлёт команду <code>curl … | bash</code>. Вставь её в Терминал на Mac " +
    "(один раз молча скачаются Command Line Tools) → приложение встанет в /Applications с уже прописанным токеном. " +
    "В конце выдай разрешение на запись в System Settings.\n\n" +
    "<b>2. Привязать Google-календарь</b> (обязательно)\n" +
    "Открой <b>Swarm → Настройки → Google Calendar → Подключить</b>. Без этого рекордер не видит встреч " +
    "и не предложит запись автоматически.\n\n" +
    "Токен рекордера отдельный (живёт год) — /mytoken для Claude Desktop его не трогает. Отозвать: /revokerecordertoken",
  granola:
    "<b>📓 Granola</b>\n\n" +
    "Встречи из Granola подтягиваются автоматически раз в час → сразу в /meetings.\n\n" +
    "Подключить: <code>/connect granola &lt;API-ключ&gt;</code> (Granola → Settings → API Key)\n" +
    "Отключить: /disconnect granola\n" +
    "Вручную: /granola — загрузить встречи за выбранный период",
  mcp:
    "<b>🖥 Claude Desktop (MCP)</b>\n\n" +
    "Доступ к базе знаний и задачам прямо из Claude Desktop.\n\n" +
    "Авто-настройка (macOS): /setup → бот пришлёт одну команду для Терминала — поставит и настроит всё сама.\n" +
    "Вручную: /connect_claude — как подключить · /mytoken — токен · /claude — инструкции с твоим Telegram ID",
  kb:
    "<b>📥 База знаний</b>\n\n" +
    "Просто пиши боту — он сам поймёт: вопрос или заметка.\n" +
    "🎤 Голосовое — транскрибация + сохранение\n" +
    "📎 Файл (PDF, Excel, TXT, CSV) — извлечение текста\n" +
    "🖼 Фото — описание через ИИ\n" +
    "🔗 Ссылка — содержимое страницы\n\n" +
    "/add [текст] — сохранить принудительно · /ask [вопрос] — спросить базу · /status — статистика",
  team:
    "<b>👥 Команда</b>\n\n" +
    "/users — список пользователей и профили\n" +
    "/users add @username (или telegram_id)\n" +
    "/users remove @username (или telegram_id)",
};

// Текст + клавиатура для подменю справки. null — неизвестный топик.
export function getHelpTopic(topic: string): { text: string; keyboard: Btn[][] } | null {
  const text = TOPICS[topic];
  return text ? { text, keyboard: [BACK] } : null;
}
