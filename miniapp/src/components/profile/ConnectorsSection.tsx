"use client";
import { useEffect, useState, type ReactNode } from "react";
import { fetchAutojoin, fetchIntegrations, fetchMcpSetup, fetchRecorderSetup, openGoogleConnect } from "@/lib/api";
import { buildConnectors, connectorsSummary, type ConnectorId, type ConnectorsInput } from "@/lib/connectors";
import { SectionLabel } from "@/components/roy/ui";
import { useDt } from "@/components/roy/nav";
import type { Me } from "@/types";
import { ConnectorTile } from "./ConnectorTile";
import { AutojoinToggle } from "./AutojoinToggle";

const TITLE: Record<ConnectorId, [string, string]> = {
  calendar: ["Google Календарь", "Google Calendar"],
  recorder: ["bumblebee — запись встреч (Mac)", "bumblebee — meeting recorder (Mac)"],
  bot: ["scriba", "scriba"],
  telegram: ["Telegram", "Telegram"],
  granola: ["Granola", "Granola"],
  claude: ["Claude Desktop", "Claude Desktop"],
};

// Правая колонка десктопа: что это и зачем — человеческим языком, для того, кто видит интеграцию
// впервые (владелец 30.09.2026: «информационный блок справа должен быть полезным и объясняющим»).
// Абзацы — массивом: каждый отвечает на один вопрос (что это → что будет → что важно знать).
const ABOUT: Record<ConnectorId, [string[], string[]]> = {
  bot: [
    [
      "scriba — наш бот для встреч в Google Meet и Контур.Толке. Он сам заходит на ваши встречи и записывает их, вам ничего не нужно запускать.",
      "Включите его — и он будет приходить на каждую встречу Meet или Толка из вашего календаря, на которую вы согласились. После встречи во «Встречах» появятся стенограмма и тезисы.",
      "В Толке встреча должна быть публичной: scriba входит по ссылке как гость, а в закрытую комнату гостя не пустят.",
      "Участники видят scriba в списке как отдельного гостя, в том числе внешние. Выключить можно в любой момент — подействует в течение минуты.",
    ],
    [
      "scriba is our meeting bot for Google Meet and Kontur.Talk. It joins your meetings on its own and records them — nothing to launch.",
      "Turn it on and it will join every Meet or Talk meeting from your calendar that you accepted. After the meeting, the transcript and notes appear in Meetings.",
      "In Kontur.Talk the meeting must be public: scriba joins by link as a guest, and a private room won't let guests in.",
      "Participants see scriba as a separate guest, external ones included. You can turn it off any time — it takes effect within a minute.",
    ],
  ],
  recorder: [
    [
      "bumblebee — программа для вашего Mac, которая записывает звонки: Zoom, Google Meet, Контур и другие.",
      "Когда начинается встреча, она предлагает записать её, а после звонка сама отправляет запись в Swarm — во «Встречах» появятся стенограмма и тезисы.",
      "Подходит для встреч, куда бота звать неудобно, и для звонков не в Meet.",
    ],
    [
      "bumblebee is a Mac app that records your calls: Zoom, Google Meet and others.",
      "When a meeting starts it offers to record it, and after the call it sends the recording to Swarm — the transcript and notes appear in Meetings.",
      "Good for meetings where a bot would be awkward, and for calls outside Meet.",
    ],
  ],
  granola: [
    [
      "Granola — приложение для заметок на встречах.",
      "Подключите его, и ваши заметки из Granola будут сами попадать в базу Swarm: их можно найти поиском и спросить о них.",
    ],
    [
      "Granola is a note-taking app for meetings.",
      "Connect it and your Granola notes will land in the Swarm base on their own — searchable and ready for questions.",
    ],
  ],
  calendar: [
    [
      "Swarm видит ваши встречи из Google Календаря: название, время и участников. Только читает — ничего в календаре не меняет.",
      "По календарю scriba знает, куда прийти, bumblebee — какую встречу он записывает, а у тезисов появляется правильное название и список участников.",
    ],
    [
      "Swarm sees your Google Calendar meetings: title, time and attendees. Read-only — it never changes your calendar.",
      "The calendar tells scriba where to go and bumblebee which meeting it records, and gives the notes the right title and attendee list.",
    ],
  ],
  telegram: [
    [
      "Бот Swarm в Telegram. Через него быстро добавить информацию в базу и быстро спросить о чём-то — не открывая сайт.",
      "Сюда же приходят уведомления: например, если запись встречи не получилась.",
    ],
    [
      "The Swarm bot in Telegram: quickly add something to the base or ask a question without opening the site.",
      "Notifications arrive here too — for example, when a meeting recording failed.",
    ],
  ],
  claude: [
    [
      "Подключите базу Swarm к Claude Desktop — и спрашивайте Claude о встречах, задачах и заметках команды прямо в чате.",
      "Claude видит только то, что видите вы в Swarm: чужие личные записи ему недоступны.",
    ],
    [
      "Connect the Swarm base to Claude Desktop and ask Claude about the team's meetings, tasks and notes right in the chat.",
      "Claude sees only what you see in Swarm: other people's private records stay private.",
    ],
  ],
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

  const panelOf = (id: ConnectorId) =>
    id === "bot"
      ? <BotPanel hasCalendar={hasCalendar} on={input.botAutojoin === true} onChange={setBotAutojoin} />
      : panels[id];
  const toggle = (id: ConnectorId) => setOpen(open === id ? null : id);
  // Справа всегда что-то выбрано: по умолчанию scriba, в демо (где его нет) — первая плитка.
  const selected: ConnectorId = open ?? (list.some((c) => c.id === "bot") ? "bot" : list[0].id);

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
              <ConnectorTile key={c.id} c={c} open={selected === c.id} onToggle={() => setOpen(c.id)} />
            ))}
          </div>
        </div>
        <aside aria-live="polite" className="rounded-[10px] border border-accent-line bg-surface px-4 py-3.5">
          <p className="mb-2 text-ink" style={{ fontSize: 15, fontWeight: 600 }}>{dt(...TITLE[selected])}</p>
          <div className="mb-3.5 flex flex-col gap-2 text-ink-soft" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            {ABOUT[selected][dt("ru", "en") === "ru" ? 0 : 1].map((para) => <p key={para}>{para}</p>)}
          </div>
          <div className="border-t border-line pt-3">{panelOf(selected)}</div>
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

/**
 * Бот ходит по календарю. Переключатель виден всегда: включивший бота до отключения календаря должен
 * мочь его выключить. Пока бот выключен и календаря нет — подсказка с кнопкой; у включённого о
 * календаре говорит живая проверка под переключателем (AutojoinToggle), а не наличие плитки.
 */
function BotPanel({ hasCalendar, on, onChange }: { hasCalendar: boolean; on: boolean; onChange: (on: boolean) => void }) {
  const dt = useDt();
  return (
    <div className="flex flex-col gap-2.5">
      {!hasCalendar && !on && (
        <div className="flex flex-col gap-2 text-ink-soft" style={{ fontSize: 12.5 }}>
          <p>
            {dt(
              "scriba узнаёт о встречах из Google Календаря — подключите его, иначе боту некуда будет прийти.",
              "scriba learns about meetings from Google Calendar — connect it, or the bot will have nowhere to go.",
            )}
          </p>
          <button
            type="button"
            onClick={() => void openGoogleConnect()}
            className="self-start rounded-full bg-primary px-3.5 py-1.5 font-semibold text-primary-foreground transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            style={{ fontSize: 12.5 }}
          >
            {dt("Подключить календарь", "Connect calendar")}
          </button>
        </div>
      )}
      <AutojoinToggle bare onChange={onChange} />
    </div>
  );
}
