// Статус интеграции с клиентом на машине человека (Claude Desktop, bumblebee): живой ли он.
// Чистая логика — вся вёрстка в SettingsScreen и profile/ConnectorTile.
//
// Зачем: до issue #921 карточка писала «Подключён», если у человека просто выпущен токен. После
// переезда сервера (13.10.2026) клиенты ходили на старый мёртвый адрес, а экран говорил «всё ок».
// Теперь сервер отдаёт lastSeenAt — когда клиент последний раз реально обращался.

/** Сколько дней молчания клиента считается «не отвечает». Рекордер ходит чаще Claude Desktop. */
export const STALE_DAYS = { recorder: 3, claude: 14 } as const;

/**
 * - off — токена нет;
 * - never — токен есть, клиент ни разу не обращался;
 * - stale — обращался, но давно (старше порога);
 * - alive — обращался недавно;
 * - unknown — сервер ещё не отдаёт lastSeenAt (веб раскатывается раньше API): не пугаем, ведём
 *   себя как до #921.
 */
export type IntegrationHealth = "off" | "never" | "stale" | "alive" | "unknown";

export function integrationHealth(input: {
  active: boolean;
  /** undefined — поля нет в ответе сервера; null — клиент ни разу не обращался. */
  lastSeenAt: string | null | undefined;
  staleDays: number;
  now: Date;
}): IntegrationHealth {
  if (!input.active) return "off";
  if (input.lastSeenAt === undefined) return "unknown";
  if (input.lastSeenAt === null) return "never";
  const seen = Date.parse(input.lastSeenAt);
  if (Number.isNaN(seen)) return "unknown";
  return input.now.getTime() - seen > input.staleDays * 86_400_000 ? "stale" : "alive";
}

type Dt = (ru: string, en: string) => string;

export type IntegrationStatusText = { label: string; hint: string | null };

/** Подписи для панели интеграции. `formatDate` — дата и время в языке интерфейса. */
export function integrationStatusText(
  health: IntegrationHealth,
  lastSeenAt: string | null | undefined,
  dt: Dt,
  formatDate: (iso: string) => string,
): IntegrationStatusText {
  const seen = lastSeenAt ? formatDate(lastSeenAt) : "";
  switch (health) {
    case "off":
      return { label: dt("Не подключён", "Not connected"), hint: null };
    case "never":
      return {
        label: dt("Не отвечает", "Not responding"),
        hint: dt(
          "Клиент ещё не обращался к серверу — перевыпусти команду установки и выполни её",
          "The client has not contacted the server yet — reissue the install command and run it",
        ),
      };
    case "stale":
      return {
        label: dt(`Не отвечает · последнее обращение ${seen}`, `Not responding · last seen ${seen}`),
        hint: dt(
          "Клиент давно не обращался к серверу — возможно, он ходит на старый адрес. Перевыпусти команду установки и выполни её",
          "The client has not contacted the server for a while — it may be using an old address. Reissue the install command and run it",
        ),
      };
    case "alive":
      return { label: dt(`Подключён · ${seen}`, `Connected · ${seen}`), hint: null };
    case "unknown":
      return { label: dt("Подключён", "Connected"), hint: null };
  }
}
