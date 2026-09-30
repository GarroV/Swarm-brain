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
// Что даёт интеграция — одной строкой над её настройками в правой колонке десктопа.
const HINT: Record<ConnectorId, [string, string]> = {
  calendar: ["Встречи получают название и участников; бот и bumblebee знают, куда идти.", "Meetings get a title and attendees; the bot and bumblebee know where to go."],
  recorder: ["Записывает встречи на вашем Mac.", "Records meetings on your Mac."],
  bot: ["Сам приходит на ваши встречи Google Meet и записывает их.", "Joins your Google Meet meetings on its own and records them."],
  telegram: ["Уведомления и быстрый вопрос к базе.", "Notifications and a quick question to the base."],
  granola: ["Заметки Granola попадают в базу.", "Granola notes land in the base."],
  claude: ["База Swarm прямо в Claude Desktop.", "The Swarm base right inside Claude Desktop."],
};

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

  const panelOf = (id: ConnectorId) =>
    id === "bot" ? <BotPanel hasCalendar={hasCalendar} onChange={setBotAutojoin} /> : panels[id];
  const toggle = (id: ConnectorId) => setOpen(open === id ? null : id);

  const counter = (
    <span className="text-ink-mute" style={{ fontSize: 11 }}>
      {dt(`${connected} из ${total}`, `${connected} of ${total}`)}
      {attention > 0 && <span className="text-accent-ink"> · {attention} {dt("требуют внимания", "need attention")}</span>}
    </span>
  );

  // Десктоп (бенто настроек): плитки слева, справа — колонка с подсказкой и настройками выбранной
  // (владелец 30.09.2026: «сделай плиточный дизайн и меню подсказка с настройками справа»).
  // Панель не выталкивает плитки вниз и не заставляет искать, что раскрылось.
  if (dense) {
    return (
      <section className="grid gap-3" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px" }}>
        <div className="flex flex-col gap-2">
          <div className="flex justify-end">{counter}</div>
          <div className="grid grid-cols-3 gap-2">
            {list.map((c) => (
              <ConnectorTile key={c.id} c={c} open={open === c.id} onToggle={() => toggle(c.id)} />
            ))}
          </div>
        </div>
        <aside aria-live="polite"
          className={`rounded-[10px] border px-3.5 py-3 ${open ? "border-accent-line bg-surface" : "border-dashed border-line bg-surface-2"}`}>
          {open ? (
            <>
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="text-ink" style={{ fontSize: 13.5, fontWeight: 600 }}>{dt(...TITLE[open])}</p>
                <button type="button" onClick={() => setOpen(null)} className="shrink-0 text-ink-mute hover:text-ink" style={{ fontSize: 12 }}>
                  {dt("Закрыть", "Close")}
                </button>
              </div>
              <p className="mb-3 text-ink-soft" style={{ fontSize: 12 }}>{dt(...HINT[open])}</p>
              {panelOf(open)}
            </>
          ) : (
            <div className="flex h-full flex-col justify-center gap-1.5 text-center">
              <p className="text-ink" style={{ fontSize: 13, fontWeight: 500 }}>{dt("Настройки интеграции", "Integration settings")}</p>
              <p className="text-ink-soft" style={{ fontSize: 12 }}>
                {dt("Выберите плитку слева — здесь появится, что она даёт и как её настроить.",
                  "Pick a tile on the left — what it does and how to set it up appears here.")}
              </p>
            </div>
          )}
        </aside>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <SectionLabel>{dt("Подключения", "Connections")}</SectionLabel>
        {counter}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {list.map((c) => (
          <ConnectorTile key={c.id} c={c} open={open === c.id} onToggle={() => toggle(c.id)} />
        ))}
      </div>

      {open && (
        <div className="rounded-[10px] border border-accent-line bg-surface px-3 py-3">
          <p className="mb-2 text-ink" style={{ fontSize: 13, fontWeight: 500 }}>{dt(...TITLE[open])}</p>
          {panelOf(open)}
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
