"use client";
import { useEffect, useState, type ReactNode } from "react";
import { fetchIntegrations, fetchMcpSetup, fetchRecorderSetup } from "@/lib/api";
import { buildConnectors, connectorsSummary, type Connector, type ConnectorId } from "@/lib/connectors";
import { SectionLabel } from "@/components/roy/ui";
import { useDt } from "@/components/roy/nav";
import type { Me } from "@/types";
import { ConnectorTile } from "./ConnectorTile";

const TITLE: Record<ConnectorId, [string, string]> = {
  calendar: ["Google-календарь", "Google Calendar"],
  recorder: ["bumblebee — запись встреч (Mac)", "bumblebee — meeting recorder (Mac)"],
  telegram: ["Telegram", "Telegram"],
  granola: ["Granola", "Granola"],
  claude: ["Claude Desktop", "Claude Desktop"],
};

/**
 * Сетка подключений в профиле. Три запроса вместо девяти раскрытий: до 04.09.2026 статус каждого
 * сервиса жил внутри своей свёрнутой секции, и увидеть картину целиком было нельзя.
 * `fetchIntegrations` попутно перестал дублироваться — Granola и календарь брали его по разу каждый.
 */
export function ConnectorsSection({ me, panels }: { me: Me; panels: Record<ConnectorId, ReactNode> }) {
  const dt = useDt();
  const [list, setList] = useState<Connector[] | null>(null);
  const [open, setOpen] = useState<ConnectorId | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchIntegrations().catch(() => []),
      fetchRecorderSetup().catch(() => ({ active: false, expiresAt: null })),
      fetchMcpSetup().catch(() => ({ active: false, expiresAt: null })),
    ]).then(([integrations, recorder, mcp]) => {
      if (!alive) return;
      setList(buildConnectors({
        services: integrations.map((i) => i.service),
        recorder: { active: recorder.active, expiresAt: recorder.expiresAt },
        mcp: { active: mcp.active, expiresAt: mcp.expiresAt },
        // Синтетическая личность (веб-вход по e-mail без Telegram) — отрицательный id,
        // см. auth-resolve. Для человека это и значит «Telegram не привязан».
        telegramLinked: me.telegram_id > 0,
        now: new Date(),
      }));
    });
    return () => { alive = false; };
  }, [me.telegram_id]);

  if (!list) return <p className="text-sm text-muted-foreground">{dt("Загрузка…", "Loading…")}</p>;

  const { connected, total, attention } = connectorsSummary(list);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <SectionLabel>{dt("Подключения", "Connections")}</SectionLabel>
        <span className="text-ink-mute" style={{ fontSize: 11 }}>
          {dt(`${connected} из ${total}`, `${connected} of ${total}`)}
          {attention > 0 && <span className="text-accent-ink"> · {attention} {dt("требуют внимания", "need attention")}</span>}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {list.map((c) => (
          <ConnectorTile key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
        ))}
      </div>

      {open && (
        <div className="rounded-[14px] border border-accent-line bg-surface px-3 py-3 dark:backdrop-blur-sm">
          <p className="mb-2 text-ink" style={{ fontSize: 13, fontWeight: 500 }}>{dt(...TITLE[open])}</p>
          {panels[open]}
        </div>
      )}
    </section>
  );
}
