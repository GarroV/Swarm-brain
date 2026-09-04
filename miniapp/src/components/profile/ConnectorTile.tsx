"use client";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import type { Connector, ConnectorId, ConnectorState } from "@/lib/connectors";

const ICON: Record<ConnectorId, RoyIconName> = {
  calendar: "cal",
  recorder: "mic",
  telegram: "tg",
  granola: "note",
  claude: "spark",
};

// Короткое имя — плитка узкая; полное живёт в заголовке раскрытой панели (ConnectorsSection).
const TITLE: Record<ConnectorId, string> = {
  calendar: "Календарь",
  recorder: "bumblebee",
  telegram: "Telegram",
  granola: "Granola",
  claude: "Claude Desktop",
};

// Внешний вид несёт СМЫСЛ, а не украшает: то, что требует действия, получает акцентную подложку
// и рамку, рабочее — остаётся тихим. Однородная сетка одинаковых карточек прятала бы ровно ту
// информацию, ради которой экран переделан.
const SKIN: Record<ConnectorState, string> = {
  expired: "border-accent-line bg-accent-soft",
  expiring: "border-accent-line bg-surface",
  off: "border-line bg-surface",
  connected: "border-line bg-surface",
};

const DOT: Record<ConnectorState, string> = {
  expired: "bg-status-prog",
  expiring: "bg-status-prog",
  off: "bg-line-2",
  connected: "bg-status-done",
};

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ConnectorTile({ c, open, onToggle }: { c: Connector; open: boolean; onToggle: () => void }) {
  const dt = useDt();

  // «Не привязан» вместо «не подключён» — Telegram не подключают, к нему привязывают личность.
  const status =
    c.state === "connected" ? dt("Подключён", "Connected")
    : c.state === "expired" ? dt("Токен истёк", "Token expired")
    : c.state === "expiring" ? dt(`Токен до ${shortDate(c.expiresAt)}`, `Token until ${shortDate(c.expiresAt)}`)
    : c.id === "telegram" ? dt("Не привязан", "Not linked")
    : dt("Не подключён", "Not connected");

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`flex w-full flex-col gap-2 rounded-[14px] border px-3 py-3 text-left transition-colors hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line dark:backdrop-blur-sm ${SKIN[c.state]} ${open ? "border-accent-line" : ""}`}
    >
      <span className="flex items-center justify-between">
        <RoyIcon name={ICON[c.id]} className={c.state === "expired" ? "text-accent-ink" : "text-ink-soft"} />
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[c.state]}`} aria-hidden />
      </span>
      <span className="text-ink" style={{ fontSize: 13, fontWeight: 500 }}>{TITLE[c.id]}</span>
      <span
        className={c.state === "expired" ? "text-accent-ink" : "text-ink-mute"}
        style={{ fontSize: 11 }}
      >
        {status}
      </span>
    </button>
  );
}
