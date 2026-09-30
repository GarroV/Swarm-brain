// Модель плиток подключений в профиле сотрудника: из сырых ответов сервера собирает список
// коннекторов с состоянием и порядком показа. Чистая логика — вся вёрстка в components/profile/.
//
// Зачем модель отдельно от экрана: до 04.09.2026 статус каждого сервиса был виден ТОЛЬКО внутри
// раскрытой секции-аккордеона, и чтобы понять, что подключено, приходилось раскрывать все девять
// по очереди. Компоновка плитками (решение владельца, docs/decisions/2026-09-04-profile-connectors.md)
// требует знать все состояния разом — здесь они и считаются.

/** Сколько дней до истечения токена считаются «скоро протухнет». */
const EXPIRING_DAYS = 14;

export type ConnectorId = "calendar" | "recorder" | "bot" | "telegram" | "granola" | "claude";

/**
 * `expired` намеренно отделён от `off`: протухший токен требует ПЕРЕподключения, а не первого
 * подключения. Слив их в одно состояние, мы показываем человеку «подключи» там, где сервис уже
 * настроен и просто отвалился — урок issue #175.
 */
export type ConnectorState = "connected" | "expiring" | "expired" | "off";

export type Connector = {
  id: ConnectorId;
  state: ConnectorState;
  /** Срок действия токена, если сервис им живёт (рекордер, Claude Desktop). */
  expiresAt: string | null;
};

export type TokenStatus = { active: boolean; expiresAt: string | null };

export type ConnectorsInput = {
  /** Названия сервисов из fetchIntegrations(): "google_calendar", "granola". */
  services: string[];
  recorder: TokenStatus;
  mcp: TokenStatus;
  telegramLinked: boolean;
  /**
   * Автозапуск бота встреч (scriba_autojoin): включён → connected, выключен → off. Не передан
   * (демо) — карточки бота нет вовсе: в демо бот не ходит.
   */
  botAutojoin?: boolean;
  now: Date;
};

// Базовый порядок = важность сервиса для работы продукта: без календаря рекордер слеп,
// без рекордера нет встреч, без Telegram не доходят уведомления.
// Бот встреч — сразу за рекордером: это второй способ записать встречу.
const BASE_ORDER: ConnectorId[] = ["calendar", "recorder", "bot", "telegram", "granola", "claude"];


function tokenState({ active, expiresAt }: TokenStatus, now: Date): ConnectorState {
  if (!active) return "off";
  if (!expiresAt) return "connected";
  const left = Date.parse(expiresAt) - now.getTime();
  if (Number.isNaN(left)) return "connected";
  if (left <= 0) return "expired";
  return left <= EXPIRING_DAYS * 86_400_000 ? "expiring" : "connected";
}

export function buildConnectors(input: ConnectorsInput): Connector[] {
  const has = (service: string) => input.services.includes(service);

  const byId: Record<ConnectorId, Connector> = {
    calendar: { id: "calendar", state: has("google_calendar") ? "connected" : "off", expiresAt: null },
    recorder: { id: "recorder", state: tokenState(input.recorder, input.now), expiresAt: input.recorder.expiresAt },
    bot: { id: "bot", state: input.botAutojoin ? "connected" : "off", expiresAt: null },
    telegram: { id: "telegram", state: input.telegramLinked ? "connected" : "off", expiresAt: null },
    granola: { id: "granola", state: has("granola") ? "connected" : "off", expiresAt: null },
    claude: { id: "claude", state: tokenState(input.mcp, input.now), expiresAt: input.mcp.expiresAt },
  };

  const shown = input.botAutojoin === undefined ? BASE_ORDER.filter((id) => id !== "bot") : BASE_ORDER;
  // Порядок постоянный: плитка не прыгает, когда меняется её состояние (владелец 30.09.2026:
  // «почему карточки перемешиваются когда включаешь бота?»). Внимание несут подложка и точка.
  return shown.map((id) => byId[id]);
}

export type ConnectorsSummary = { connected: number; total: number; attention: number };

/** Сводка для шапки секции: «2 из 5 · ⚠ 1». */
export function connectorsSummary(list: Connector[]): ConnectorsSummary {
  return {
    connected: list.filter((c) => c.state === "connected").length,
    total: list.length,
    attention: list.filter((c) => c.state === "expired" || c.state === "expiring").length,
  };
}
