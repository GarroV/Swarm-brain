// Модель плиток подключений в профиле сотрудника: из сырых ответов сервера собирает список
// коннекторов с состоянием и порядком показа. Чистая логика — вся вёрстка в components/profile/.
//
// Зачем модель отдельно от экрана: до 04.09.2026 статус каждого сервиса был виден ТОЛЬКО внутри
// раскрытой секции-аккордеона, и чтобы понять, что подключено, приходилось раскрывать все девять
// по очереди. Компоновка плитками (решение владельца, docs/decisions/2026-09-04-profile-connectors.md)
// требует знать все состояния разом — здесь они и считаются.

/** Сколько дней до истечения токена считаются «скоро протухнет». */
const EXPIRING_DAYS = 14;

export type ConnectorId = "calendar" | "recorder" | "telegram" | "granola" | "claude";

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
  now: Date;
};

// Базовый порядок = важность сервиса для работы продукта: без календаря рекордер слеп,
// без рекордера нет встреч, без Telegram не доходят уведомления.
const BASE_ORDER: ConnectorId[] = ["calendar", "recorder", "telegram", "granola", "claude"];

// Внимание — вперёд: сломанное, затем скоро сломающееся, затем неподключённое, затем рабочее.
const STATE_ORDER: Record<ConnectorState, number> = { expired: 0, expiring: 1, off: 2, connected: 3 };

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
    telegram: { id: "telegram", state: input.telegramLinked ? "connected" : "off", expiresAt: null },
    granola: { id: "granola", state: has("granola") ? "connected" : "off", expiresAt: null },
    claude: { id: "claude", state: tokenState(input.mcp, input.now), expiresAt: input.mcp.expiresAt },
  };

  return BASE_ORDER.map((id) => byId[id]).sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      BASE_ORDER.indexOf(a.id) - BASE_ORDER.indexOf(b.id),
  );
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
