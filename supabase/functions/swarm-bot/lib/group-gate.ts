// Гейт групповых чатов: в группе/супергруппе бот реагирует ТОЛЬКО на явное обращение —
// команду ("/cmd", "/cmd@этот_бот") или @упоминание бота в тексте. Всё остальное
// (болтовня, медиа без текста, чужие "/cmd@другой_бот") молча игнорируется, иначе
// любое сообщение в группе (напр. группе фидбека) трактуется как запрос к базе.

export interface GroupGateVerdict {
  process: boolean;
  /** Текст для дальнейшего роутинга: @упоминание бота / @суффикс команды вырезаны. */
  text?: string;
}

// Telegram-username: 5-32 символа [A-Za-z0-9_] — безопасно вставлять в RegExp без экранирования.
const COMMAND_TARGET_RE = /^\/[a-zA-Z0-9_]+@([a-zA-Z0-9_]+)/;

export function gateGroupMessage(rawText: string | undefined, botUsername: string | null): GroupGateVerdict {
  const text = rawText?.trim();
  if (!text) return { process: false };

  if (text.startsWith("/")) {
    const target = text.match(COMMAND_TARGET_RE)?.[1];
    // Адресованное другому боту (или неизвестно, наш ли адресат) — не наше.
    if (target && (!botUsername || target.toLowerCase() !== botUsername.toLowerCase())) {
      return { process: false };
    }
    return { process: true, text: stripBotMention(text, botUsername) };
  }

  if (botUsername && mentionRe(botUsername).test(text)) {
    return { process: true, text: stripBotMention(text, botUsername) };
  }

  return { process: false };
}

function mentionRe(botUsername: string, flags = "i"): RegExp {
  return new RegExp(`@${botUsername}\\b`, flags);
}

function stripBotMention(text: string, botUsername: string | null): string {
  if (!botUsername) return text;
  return text.replace(mentionRe(botUsername, "gi"), " ").replace(/[ \t]+/g, " ").trim();
}
