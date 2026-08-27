// Справка бота + мастер настройки. Веб-приложение называется Swarm Brain.
//
// Структура /help:
//   1. Обзор «что умеет» (возможности + мысль «одна общая база, три двери: бот / веб / Claude»).
//   2. Блок «Как подключить» + inline-кнопка «⚙️ Настроить систему» (callback_data=guide_open).
//
// Мастер настройки — САМОРЕДАКТИРУЕМОЕ сообщение (editMessageText по callback):
//   guide_open  → прислать НОВОЕ сообщение-меню (guideMenu)
//   guide_menu  → перерисовать текущее сообщение обратно в меню («← К шагам»)
//   guide_s1/2/3→ перерисовать текущее сообщение в детали шага
// Порядок шагов строго: Claude Desktop (MCP) → рекордер → Google-авторизация.
// Привязка Google-календаря — только в вебе Swarm Brain → Настройки (команды бота нет).

const WEB_URL = "https://swarm-brain.pages.dev";

// ── Справка: обзор возможностей + вход в мастер настройки ──────────────────────
export function getHelpText(): string {
  return (
    "<b>Swarm Brain — справка</b>\n\n" +

    `Командная база знаний, встречи и задачи. База <b>одна</b>, а входов три: этот бот, <a href="${WEB_URL}">веб-приложение</a> и Claude Desktop. ` +
    "Что создал в одном — видно в остальных: задачи, встречи и знания общие для всей команды.\n\n" +

    "<b>📥 База знаний</b>\n" +
    "Печатаешь текст — бот <b>ищет по базе</b> (или /ask [вопрос]). Сохранить: перешли сообщение · пришли 📎 файл (PDF/Excel/TXT/CSV) · 🎤 голос · 🖼 фото · 🔗 ссылку, либо «сохрани: …» / /add [текст]. /status — статистика.\n\n" +

    "<b>🎙 Встречи</b>\n" +
    "Прилетают автоматически (Read.ai · Granola · bumblebee) → /meetings — вычитка и подтверждение тезисов.\n\n" +

    "<b>✅ Задачи</b>\n" +
    "/tasks — активные · /tasks [имя или страна] — фильтр · /addtask — создать. Те же задачи видны в вебе и в Claude.\n\n" +

    "<b>👥 Команда</b>\n" +
    "/users — список · /users add @username · /users remove @username.\n\n" +

    "<b>📓 Granola</b>\n" +
    "Заметки подтягиваются раз в час → /meetings. Подключить: /connect granola <code>&lt;API-ключ&gt;</code> (Granola → Settings → API Key) · вручную /granola · отключить /disconnect granola.\n\n" +

    "<b>🛠 Сервис</b>\n" +
    "/feedback — фидбек · /reset — сброс · /help — справка.\n\n" +

    "━━━━━━━━━━━━━━━\n\n" +

    "🔌 <b>Как подключить</b>\n" +
    "Swarm Brain можно открыть в вебе и в Claude Desktop, а встречи — писать через bumblebee на Mac. " +
    "Чтобы всё это заработало, нужна разовая настройка: 3 шага (Claude · bumblebee · Google). Жми кнопку ниже 👇"
  );
}

// Inline-клавиатура под справкой: единственная кнопка открывает мастер настройки.
export function helpKeyboard(): unknown[][] {
  return [[{ text: "⚙️ Настроить систему", callback_data: "guide_open" }]];
}

// ── Мастер настройки: меню + 3 шага ───────────────────────────────────────────

const GUIDE_MENU_TEXT =
  "⚙️ <b>Настройка системы — 3 шага</b>\n\n" +
  "Swarm Brain работает через веб-приложение, Claude Desktop и bumblebee — запись встреч на Mac. " +
  "Выбери шаг (лучше по порядку) — инструкция откроется прямо здесь.";

const GUIDE_STEPS: readonly string[] = [
  // 1️⃣ Claude Desktop (MCP)
  "<b>1️⃣ Claude Desktop (MCP) — ИИ-ассистент над базой знаний</b>\n" +
  "<i>Что даёт:</i> Claude на твоём Mac ищет по встречам, задачам и документам и отвечает по делу.\n\n" +
  "• /setup → бот пришлёт <b>одну строку</b> <code>curl … | bash</code> для Терминала (только macOS). Скрипт сам поставит и настроит Claude Desktop и перезапустит его.\n" +
  "• Открыть Терминал: ⌘+Пробел → «Терминал» → Enter → вставь строку (⌘V) → Enter.\n" +
  "• Затем в Claude: Projects → New Project → в поле Instructions вставь текст из /claude (в нём уже вшит твой Telegram ID).\n\n" +
  "⚠️ Токен в строке — личный и <b>бессрочный</b>, никому не пересылай.\n" +
  "Вручную: /connect_claude · /mytoken (есть активный — бот предупредит) · /claude · /revoketoken — отозвать.",

  // 2️⃣ bumblebee — запись встреч (Mac)
  "<b>2️⃣ bumblebee (Mac) — пишет звук созвона, сервер делает расшифровку и тезисы</b>\n" +
  "<i>Что даёт:</i> не нужно конспектировать — готовая встреча сама приходит с тезисами.\n\n" +
  "• /recordertoken → бот пришлёт <b>одну строку</b> <code>curl … | bash</code> для Терминала (вставь как в шаге 1). Скрипт поставит приложение в /Applications и откроет его.\n" +
  "• Выдай разрешение: System Settings → Privacy → «Screen &amp; System Audio Recording» → включи bumblebee → ⌘Q и открой заново.\n" +
  "• Живёт в меню-баре. Готовая встреча → появляется в /meetings.\n\n" +
  "⚠️ Токен bumblebee <b>отдельный</b> (на год), /mytoken его не трогает · отозвать: /revokerecordertoken.\n" +
  "⚠️ Нужна привязка Google-календаря (шаг 3) — без неё bumblebee не видит встреч и не предложит запись сам.",

  // 3️⃣ Google-авторизация
  "<b>3️⃣ Google-авторизация (Google-календарь)</b>\n" +
  "<i>Что даёт:</i> bumblebee видит встречи заранее и сам предлагает запись; тезисы получают название встречи и участников.\n\n" +
  `• Только в вебе (команды бота нет): открой <a href="${WEB_URL}">Swarm Brain</a> → Настройки → Google-календарь → «Подключить».\n` +
  "• Доступ только на чтение событий (read-only).\n\n" +
  "✅ После трёх шагов встречи прилетают сами → /meetings — вычитка и подтверждение тезисов.",
];

// Меню мастера: три кнопки-шага (перерисовывают ЭТО ЖЕ сообщение).
export function guideMenu(): { text: string; keyboard: unknown[][] } {
  return {
    text: GUIDE_MENU_TEXT,
    keyboard: [
      [{ text: "1️⃣ Claude Desktop (MCP)", callback_data: "guide_s1" }],
      [{ text: "2️⃣ bumblebee — встречи (Mac)", callback_data: "guide_s2" }],
      [{ text: "3️⃣ Google-календарь", callback_data: "guide_s3" }],
    ],
  };
}

// Экран шага: текст шага + «← К шагам» (callback_data=guide_menu возвращает в меню).
export function guideStep(step: 1 | 2 | 3): { text: string; keyboard: unknown[][] } {
  return {
    text: GUIDE_STEPS[step - 1],
    keyboard: [[{ text: "← К шагам", callback_data: "guide_menu" }]],
  };
}
