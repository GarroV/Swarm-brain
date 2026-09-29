"use client";
import { useEffect, useState, type ReactNode } from "react";
import { fetchAutojoin, fetchIntegrations, fetchMcpSetup, fetchRecorderSetup } from "@/lib/api";
import { buildConnectors, connectorsSummary, type ConnectorId, type ConnectorsInput } from "@/lib/connectors";
import { SectionLabel } from "@/components/roy/ui";
import { useDt } from "@/components/roy/nav";
import type { Me } from "@/types";
import { ConnectorTile } from "./ConnectorTile";
import { AutojoinToggle } from "./AutojoinToggle";

const TITLE: Record<ConnectorId, [string, string]> = {
  calendar: ["Google-календарь", "Google Calendar"],
  recorder: ["bumblebee — запись встреч (Mac)", "bumblebee — meeting recorder (Mac)"],
  bot: ["Бот встреч", "Meeting bot"],
  telegram: ["Telegram", "Telegram"],
  granola: ["Granola", "Granola"],
  claude: ["Claude Desktop", "Claude Desktop"],
};

/**
 * Сетка подключений в профиле. Три запроса вместо девяти раскрытий: до 04.09.2026 статус каждого
 * сервиса жил внутри своей свёрнутой секции, и увидеть картину целиком было нельзя.
 * `fetchIntegrations` попутно перестал дублироваться — Granola и календарь брали его по разу каждый.
 */
// Панель бота секция рисует сама: переключатель меняет статус карточки, а состояние живёт здесь.
type PanelId = Exclude<ConnectorId, "bot">;

export function ConnectorsSection({ me, panels, dense = false }: { me: Me; panels: Record<PanelId, ReactNode>; dense?: boolean }) {
  const dt = useDt();
  // Храним сырой вход, а не готовый список: переключатель бота меняет одно поле, порядок пересчитывается.
  const [input, setInput] = useState<ConnectorsInput | null>(null);
  const [open, setOpen] = useState<ConnectorId | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchIntegrations().catch(() => []),
      fetchRecorderSetup().catch(() => ({ active: false, expiresAt: null })),
      fetchMcpSetup().catch(() => ({ active: false, expiresAt: null })),
      // В демо бот не ходит — карточки нет (botAutojoin: undefined).
      me.is_demo ? Promise.resolve(undefined) : fetchAutojoin().catch(() => false),
    ]).then(([integrations, recorder, mcp, botAutojoin]) => {
      if (!alive) return;
      setInput({
        services: integrations.map((i) => i.service),
        recorder: { active: recorder.active, expiresAt: recorder.expiresAt },
        mcp: { active: mcp.active, expiresAt: mcp.expiresAt },
        // Синтетическая личность (веб-вход по e-mail без Telegram) — отрицательный id,
        // см. auth-resolve. Для человека это и значит «Telegram не привязан».
        telegramLinked: me.telegram_id > 0,
        botAutojoin,
        now: new Date(),
      });
    });
    return () => { alive = false; };
  }, [me.telegram_id, me.is_demo]);

  if (!input) return <p className="text-sm text-muted-foreground">{dt("Загрузка…", "Loading…")}</p>;

  const list = buildConnectors(input);
  const hasCalendar = input.services.includes("google_calendar");
  const setBotAutojoin = (on: boolean) => setInput((cur) => (cur ? { ...cur, botAutojoin: on } : cur));
  const { connected, total, attention } = connectorsSummary(list);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        {/* В бенто заголовок даёт плитка «Интеграции» — второй не нужен. */}
        {dense ? <span /> : <SectionLabel>{dt("Подключения", "Connections")}</SectionLabel>}
        <span className="text-ink-mute" style={{ fontSize: 11 }}>
          {dt(`${connected} из ${total}`, `${connected} of ${total}`)}
          {attention > 0 && <span className="text-accent-ink"> · {attention} {dt("требуют внимания", "need attention")}</span>}
        </span>
      </div>

      <div className={dense ? "grid grid-cols-6 gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-3"}>
        {list.map((c) => (
          <ConnectorTile key={c.id} c={c} dense={dense} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
        ))}
      </div>

      {open && (
        <div className="rounded-[10px] border border-accent-line bg-surface px-3 py-3">
          <p className="mb-2 text-ink" style={{ fontSize: 13, fontWeight: 500 }}>{dt(...TITLE[open])}</p>
          {open === "bot" ? <BotPanel hasCalendar={hasCalendar} onChange={setBotAutojoin} /> : panels[open]}
        </div>
      )}
    </section>
  );
}

/** Бот ходит по календарю: без подключённого Google-календаря включать нечего — говорим, что подключить. */
function BotPanel({ hasCalendar, onChange }: { hasCalendar: boolean; onChange: (on: boolean) => void }) {
  const dt = useDt();
  if (!hasCalendar) {
    return (
      <p className="text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt(
          "Бот приходит на встречи из Google-календаря — сначала подключите «Календарь».",
          "The bot joins meetings from Google Calendar — connect Calendar first.",
        )}
      </p>
    );
  }
  return <AutojoinToggle bare onChange={onChange} />;
}
