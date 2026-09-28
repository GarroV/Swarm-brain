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

/** `dense` — строка «пиктограмма · имя/статус · точка» для бенто настроек десктопа; без него — прежняя плитка (мобайл). */
export function ConnectorTile({ c, open, onToggle, dense = false }: { c: Connector; open: boolean; onToggle: () => void; dense?: boolean }) {
  const dt = useDt();

  // «Не привязан» вместо «не подключён» — Telegram не подключают, к нему привязывают личность.
  const status =
    c.state === "connected" ? dt("Подключён", "Connected")
    : c.state === "expired" ? dt("Токен истёк", "Token expired")
    : c.state === "expiring" ? dt(`Токен до ${shortDate(c.expiresAt)}`, `Token until ${shortDate(c.expiresAt)}`)
    : c.id === "telegram" ? dt("Не привязан", "Not linked")
    : dt("Не подключён", "Not connected");

  const iconTone = c.state === "expired" ? "text-accent-ink" : "text-ink-soft";
  const statusTone = c.state === "expired" ? "text-accent-ink" : "text-ink-mute";
  const frame = `w-full rounded-[10px] border text-left transition-colors hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line ${SKIN[c.state]} ${open ? "border-accent-line" : ""}`;

  if (dense) {
    return (
      <button type="button" onClick={onToggle} aria-expanded={open} className={`flex items-center gap-2 px-2.5 py-2 ${frame}`}>
        <RoyIcon name={ICON[c.id]} size={15} className={`shrink-0 ${iconTone}`} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ink" style={{ fontSize: 12.5, fontWeight: 500 }}>{TITLE[c.id]}</span>
          <span className={`truncate ${statusTone}`} style={{ fontSize: 10.5 }}>{status}</span>
        </span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[c.state]}`} aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`flex flex-col gap-2 px-3 py-3 ${frame}`}
    >
      <span className="flex items-center justify-between">
        <RoyIcon name={ICON[c.id]} className={iconTone} />
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[c.state]}`} aria-hidden />
      </span>
      <span className="text-ink" style={{ fontSize: 13, fontWeight: 500 }}>{TITLE[c.id]}</span>
      <span className={statusTone} style={{ fontSize: 11 }}>
        {status}
      </span>
    </button>
  );
}
